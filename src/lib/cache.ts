// Caché de las páginas públicas.
//
// Por qué: Cloudflare D1 cobra por filas leídas y da 5 millones por día. Medido
// sobre la base real (44 equipos, 616 jugadores, 440 partidos), una visita que
// abre portada, posiciones, fixture y ficha de partido lee ~13.000 filas. Eso da
// para ~380 visitas por día: apenas. Un robot que recorre las fichas de los 44
// equipos y de los 440 partidos agota el día antes del mediodía, y cuando se
// agota el corte es DURO: todas las consultas empiezan a fallar y el sitio
// entero se cae con error 500.
//
// Qué hace esto: guarda el HTML de las páginas públicas durante un minuto. La
// segunda visita (que es la mayoría: robots, gente que vuelve, gente que navega
// entre páginas) no toca la base de datos. Con un 90% de aciertos el consumo real
// baja unas nueve veces: de ~380 a ~4.200 visitas por día con la misma cuota.
//
// Qué NO hace, a propósito:
//   · No cachea el panel ni el espacio del delegado (ahí van datos de sesión).
//   · No cachea la búsqueda interna: cada texto es distinto y los robots la
//     llenan de basura.
//   · No cachea la fecha en vivo: cambia cada 30 segundos y tiene que verse.
//   · No cachea nada que venga con cookie de sesión.
//
// El tiempo de vida sale de la variable CACHE_PUBLICA_TTL (en segundos). Con "0"
// la caché queda apagada: es lo que usan los tests para no ver contenido viejo.

/** Rutas que nunca se cachean, aunque sean públicas. */
const NUNCA = [/^\/buscar/, /^\/en-vivo/, /^\/api\//, /^\/admin/, /^\/delegado/];

/** ¿Esta ruta se puede guardar en caché? */
export function rutaCacheable(ruta: string): boolean {
  return !NUNCA.some((re) => re.test(ruta));
}

/** El nombre de las cookies de sesión del panel y del delegado. */
export function tieneSesion(cookie: string | null | undefined): boolean {
  return typeof cookie === 'string' && /zl_(admin|delegado)/.test(cookie);
}

/**
 * Un visitante con cookie no se cachea: la respuesta podría traer algo
 * personalizado y, además, una copia guardada podría filtrarse a otro.
 */
export function peticionCacheable(cookie: string | null | undefined, metodo: string, ruta: string): boolean {
  return metodo === 'GET' && !tieneSesion(cookie) && rutaCacheable(ruta);
}

/** Lee el TTL configurado. Si está en 0 o no existe, la caché está apagada. */
export function ttlSegundos(bruto: string | undefined): number {
  const n = Number(bruto ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3_600) : 0;
}

/** La caché de Cloudflare, o `undefined` si este entorno no la tiene. */
export function cacheDeCloudflare(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/* ------------------------------ Middleware ------------------------------ */

/** Lo mínimo del contexto que necesita este middleware. */
export interface ContextoCache {
  req: { url: string; method: string; path: string; header(name: string): string | undefined };
  /** Respuesta final. En Hono es `c.res`, y se reemplaza asignándola. */
  res?: Response;
}

/**
 * Middleware: sirve desde la caché si puede; si no, deja pasar la respuesta y la
 * guarda.
 *
 * Detalle de Hono que importa: si un middleware llama a `next()` y después
 * devuelve otra `Response`, Hono descarta la del middleware y se queda con la
 * del handler. Por eso el acierto se devuelve SIN llamar a `next()`, y el fallo
 * se resuelve sobre `c.res`.
 *
 * Ante cualquier problema (caché caído, respuesta no cacheable) sigue sirviendo
 * la página normal: la caché nunca puede tirar el sitio.
 */
export async function responderCacheado(
  c: ContextoCache,
  next: () => Promise<void>,
  ttl: number
): Promise<void> {
  const cookie = c.req.header('cookie');
  if (ttl === 0 || !peticionCacheable(cookie, c.req.method, c.req.path)) {
    await next();
    return;
  }
  const cache = cacheDeCloudflare();
  if (!cache) {
    await next();
    return;
  }

  const clave = new Request(c.req.url, { method: 'GET' });

  let guardada: Response | undefined | null;
  try {
    guardada = await cache.match(clave);
  } catch {
    guardada = null;
  }
  if (guardada) {
    const headers = new Headers(guardada.headers);
    headers.set('X-Zl-Cache', 'HIT');
    c.res = new Response(guardada.body, { status: guardada.status, statusText: guardada.statusText, headers });
    return;
  }

  await next();

  const respuesta = c.res;
  if (!respuesta || respuesta.status !== 200) return;
  // El clon se lleva UNA de las dos copias del cuerpo: una va a la caché (que la
  // consume) y la otra sigue siendo la que ve el visitante. Si se guarda el
  // mismo objeto que se devuelve, el segundo uso del cuerpo rompe la respuesta
  // con "Body has already been used".
  try {
    const paraGuardar = respuesta.clone();
    const headers = new Headers(respuesta.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.set('X-Zl-Cache', 'MISS');
    await cache.put(clave, new Response(paraGuardar.body, { status: respuesta.status, headers }));
  } catch {
    // Si no se puede guardar (por ejemplo, una respuesta con Set-Cookie), la
    // página se sigue mostrando igual.
  }
  // Se agrega la marca a la respuesta que ya va de camino: mutar las cabeceras
  // no vuelve a tocar el cuerpo.
  try {
    respuesta.headers.set('Cache-Control', `public, max-age=${ttl}`);
    respuesta.headers.set('X-Zl-Cache', 'MISS');
  } catch {
    // Algunas respuestas tienen cabeceras inmutables: no pasa nada.
  }
}
