// Imágenes públicas del portal.
//
// Ruta /i/{archivo_id}: entrega la imagen SOLO si el archivo está en la vista
// `portal_archivos_publicos`, que ya exige que su recurso padre esté publicado.
// Si la imagen es un enlace externo, redirige (302) a esa URL. Si está en R2, la
// sirve con caché larga. Si R2 no está disponible, responde 503 controlado.
//
// No duplica datos: cada archivo vive en portal_archivos (metadatos) y el
// recurso padre (noticia, galería, foto o página) decide si es público.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { archivoEsPublico, obtenerArchivoPorId } from '../lib/portalArchivos.ts';

type PortalImagenesEnv = { Bindings: Env; Variables: Record<string, never> };

export const portalImagenesRoutes = new Hono<PortalImagenesEnv>();

const NO_DISPONIBLE = (): Response =>
  new Response('Imagen no disponible en este momento.', {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });

// Se monta en `app.route('/i', portalImagenesRoutes)`, así que la ruta final es /i/:id.
portalImagenesRoutes.get('/:archivo_id', async (c) => {
  const archivoId = Number(c.req.param('archivo_id'));
  if (!Number.isInteger(archivoId) || archivoId <= 0) return c.notFound();

  const archivo = await obtenerArchivoPorId(c.env.DB, archivoId);
  if (!archivo) return c.notFound();
  // Borrador o padre sin publicar: 404 (no 403: no queremos confirmar que existe).
  if (!(await archivoEsPublico(c.env.DB, archivoId))) return c.notFound();

  // Imagen externa: mandamos al visitante a la URL original.
  if (archivo.url_externo) {
    const destino = esHttp(archivo.url_externo) ? archivo.url_externo : null;
    return destino ? c.redirect(destino, 302) : c.notFound();
  }

  // Imagen en R2: se sirve el objeto con caché larga (el nombre es único por
  // subida, así que la URL nunca cambia de contenido y no hace falta invalidar).
  if (archivo.key_r2) {
    const bucket = c.env.R2_PUBLIC_BUCKET;
    if (!bucket) return NO_DISPONIBLE();
    try {
      const objeto = await bucket.get(archivo.key_r2);
      if (!objeto) return c.notFound();
      const headers = new Headers();
      headers.set('Content-Type', objeto.httpMetadata?.contentType ?? archivo.mime);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(objeto.body, { status: 200, headers });
    } catch (e) {
      console.error('Error al leer imagen de R2:', e);
      return NO_DISPONIBLE();
    }
  }

  // Sin objeto en R2: si la url guardada es http(s), redirigimos.
  const directa = esHttp(archivo.url_publico) ? archivo.url_publico : null;
  return directa ? c.redirect(directa, 302) : c.notFound();
});

function esHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}