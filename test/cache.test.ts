// La caché de páginas públicas decide si una visita toca la base de datos o no.
// Con el presupuesto de D1 (5 millones de filas leídas por día, corte duro a
// las 00:00 UTC) equivocarse acá es lo que tumba el sitio, así que las reglas se
// prueban una por una: qué entra, qué no, y qué pasa si la caché falla.

import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheDeCloudflare,
  peticionCacheable,
  responderCacheado,
  rutaCacheable,
  tieneSesion,
  ttlSegundos,
  type ContextoCache,
} from '../src/lib/cache.ts';

describe('cache: qué rutas se guardan', () => {
  it('las páginas públicas sí se cachean', () => {
    for (const ruta of ['/', '/posiciones', '/fixture', '/goleadores', '/equipos', '/equipos/deportivo', '/partido/12', '/historial', '/suspensiones']) {
      expect(rutaCacheable(ruta), `${ruta} debería cachearse`).toBe(true);
    }
  });

  it('el panel, el delegado, la búsqueda y el vivo nunca se cachean', () => {
    for (const ruta of ['/admin', '/admin/planilla', '/delegado', '/delegado/login', '/buscar', '/buscar?q=deportivo', '/en-vivo', '/api/vivo']) {
      expect(rutaCacheable(ruta), `${ruta} NO debería cachearse`).toBe(false);
    }
  });
});

describe('cache: quién puede servirse desde la caché', () => {
  it('un visitante anónimo que pide una página, sí', () => {
    expect(peticionCacheable(undefined, 'GET', '/')).toBe(true);
  });

  it('nadie con sesión del panel o del delegado', () => {
    expect(peticionCacheable('zl_admin=abc', 'GET', '/')).toBe(false);
    expect(peticionCacheable('otro=1; zl_delegado=xyz', 'GET', '/')).toBe(false);
  });

  it('solo GET: un POST nunca se cachea', () => {
    expect(peticionCacheable(undefined, 'POST', '/')).toBe(false);
  });

  it('reconoce la cookie de sesión', () => {
    expect(tieneSesion('zl_admin=1')).toBe(true);
    expect(tieneSesion('tema=dark')).toBe(false);
    expect(tieneSesion(undefined)).toBe(false);
  });
});

describe('cache: el tiempo de vida', () => {
  it('con 0 o sin configurar, la caché está apagada', () => {
    expect(ttlSegundos('0')).toBe(0);
    expect(ttlSegundos(undefined)).toBe(0);
    expect(ttlSegundos('no-es-un-numero')).toBe(0);
    expect(ttlSegundos('-5')).toBe(0);
  });

  it('un valor válido se usa, con un tope de una hora', () => {
    expect(ttlSegundos('60')).toBe(60);
    expect(ttlSegundos('99999')).toBe(3_600);
  });
});

describe('cache: comportamiento real', () => {
  const contexto = (ruta: string, cookie?: string): ContextoCache => ({
    req: {
      url: `https://liga.example${ruta}`,
      method: 'GET',
      path: ruta,
      header: (n) => (n.toLowerCase() === 'cookie' ? cookie : undefined),
    },
  });

  /** Una caché de mentira que cuenta lo que se le guarda y lo que se le devuelve. */
  function cacheFalsa(): { cache: Cache; guardados: string[]; consultas: () => number } {
    const guardados: string[] = [];
    const memoria = new Map<string, Response>();
    let consultas = 0;
    return {
      guardados,
      consultas: () => consultas,
      cache: {
        async match(req: Request) {
          consultas++;
          return memoria.get(req.url) ?? undefined;
        },
        async put(req: Request, res: Response) {
          guardados.push(req.url);
          memoria.set(req.url, res);
        },
      } as unknown as Cache,
    };
  }

  const instalar = (c: Cache): void => {
    (globalThis as unknown as { caches: { default: Cache } }).caches = { default: c };
  };

  afterEach(() => {
    delete (globalThis as unknown as { caches?: unknown }).caches;
  });

  it('la segunda visita se sirve de la caché sin generar la página otra vez', async () => {
    const { cache, guardados } = cacheFalsa();
    instalar(cache);
    let llamadas = 0;
    const generar = async (c: ContextoCache): Promise<void> => {
      llamadas++;
      c.res = new Response('<html>hola</html>', { headers: { 'content-type': 'text/html' } });
    };
    const uno = contexto('/posiciones');
    await responderCacheado(uno, () => generar(uno), 60);
    const dos = contexto('/posiciones');
    await responderCacheado(dos, () => generar(dos), 60);

    expect(uno.res?.headers.get('X-Zl-Cache')).toBe('MISS');
    expect(dos.res?.headers.get('X-Zl-Cache')).toBe('HIT');
    expect(llamadas, 'la segunda visita no debería volver a generar la página').toBe(1);
    expect(guardados).toEqual(['https://liga.example/posiciones']);
    expect(await dos.res!.text()).toBe('<html>hola</html>');
  });

  it('con el TTL en 0, cada visita genera la página de nuevo', async () => {
    const { cache, guardados } = cacheFalsa();
    instalar(cache);
    let llamadas = 0;
    const generar = async (c: ContextoCache): Promise<void> => {
      llamadas++;
      c.res = new Response('x');
    };
    const a = contexto('/');
    await responderCacheado(a, () => generar(a), 0);
    const b = contexto('/');
    await responderCacheado(b, () => generar(b), 0);
    expect(llamadas).toBe(2);
    expect(guardados).toEqual([]);
  });

  it('nunca cachea a alguien con sesión, aunque se le insista', async () => {
    const { cache, guardados } = cacheFalsa();
    instalar(cache);
    let llamadas = 0;
    const generar = async (c: ContextoCache): Promise<void> => {
      llamadas++;
      c.res = new Response('privado');
    };
    const a = contexto('/', 'zl_admin=abc');
    await responderCacheado(a, () => generar(a), 60);
    const b = contexto('/', 'zl_admin=abc');
    await responderCacheado(b, () => generar(b), 60);
    expect(llamadas).toBe(2);
    expect(guardados).toEqual([]);
  });

  it('las rutas excluidas nunca se guardan, ni aunque se repitan', async () => {
    const { cache, guardados } = cacheFalsa();
    instalar(cache);
    let llamadas = 0;
    const generar = async (c: ContextoCache): Promise<void> => {
      llamadas++;
      c.res = new Response('buscador');
    };
    const a = contexto('/buscar');
    await responderCacheado(a, () => generar(a), 60);
    const b = contexto('/buscar');
    await responderCacheado(b, () => generar(b), 60);
    expect(llamadas).toBe(2);
    expect(guardados).toEqual([]);
  });

  it('una respuesta que no es 200 no se guarda (por ejemplo, un 404)', async () => {
    const { cache, guardados } = cacheFalsa();
    instalar(cache);
    const generar = async (c: ContextoCache): Promise<void> => {
      c.res = new Response('no existe', { status: 404 });
    };
    const a = contexto('/partido/999999');
    await responderCacheado(a, () => generar(a), 60);
    expect(a.res?.status).toBe(404);
    expect(guardados).toEqual([]);
  });

  it('si la caché falla al leer, el sitio sigue funcionando', async () => {
    instalar({
      async match(): Promise<Response> {
        throw new Error('caché caída');
      },
      async put(): Promise<void> {
        throw new Error('caché caída');
      },
    } as unknown as Cache);
    const generar = async (c: ContextoCache): Promise<void> => {
      c.res = new Response('igual funciona');
    };
    const a = contexto('/');
    await responderCacheado(a, () => generar(a), 60);
    expect(a.res?.status).toBe(200);
    expect(await a.res!.text()).toBe('igual funciona');
  });

  it('si el entorno no tiene caché (por ejemplo, en un test), genera normal', async () => {
    delete (globalThis as unknown as { caches?: unknown }).caches;
    expect(cacheDeCloudflare()).toBeUndefined();
    const generar = async (c: ContextoCache): Promise<void> => {
      c.res = new Response('sin caché');
    };
    const a = contexto('/');
    await responderCacheado(a, () => generar(a), 60);
    expect(a.res?.status).toBe(200);
  });
});
