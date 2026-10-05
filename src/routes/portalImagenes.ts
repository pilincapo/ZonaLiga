// Imágenes públicas del portal.
//
// Ruta /i/{archivo_id}: entrega la imagen pública asociada a un archivo del
// portal SOLO si el recurso padre está publicado. Si la imagen es externa,
// redirige (302) a esa URL. Si la imagen está en R2, la sirve con cache headers.
// Si R2 no está disponible, responde 503 controlado.
//
// No duplica datos: cada archivo vive en portal_archivos (metadatos) y el
// recurso padre (noticia, galería, página) decide si es público.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { obtenerArchivoPorId } from '../lib/portalArchivos.ts';
import { obtenerNoticiaPublica, obtenerGaleriaPublica } from '../lib/portalContent.ts';

type PortalImagenesEnv = { Bindings: Env; Variables: Record<string, never> };

export const portalImagenesRoutes = new Hono<PortalImagenesEnv>();

/** ¿Está publicada la página de `portal_pages` con ese id? */
async function paginaPublica(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM portal_pages WHERE id = ?1 AND status = 'published'")
    .bind(id)
    .first<{ id: number }>();
  return row != null;
}

/**
 * El archivo solo se sirve si su padre está publicado. Si el padre no existe o
 * está en borrador, se responde 404 (no 403: no queremos confirmar que existe).
 */
async function padrePublicado(db: D1Database, tipo: string, padreId: number): Promise<boolean> {
  if (tipo.startsWith('noticia')) return (await obtenerNoticiaPublica(db, padreId)) != null;
  if (tipo.startsWith('galeria')) return (await obtenerGaleriaPublica(db, padreId)) != null;
  if (tipo.startsWith('complejo')) return paginaPublica(db, padreId);
  // Configuración (hero, logo): no tiene padre; depende de que esté marcada pública.
  return false;
}

// Se monta en `app.route('/i', portalImagenesRoutes)`, así que la ruta final es /i/:id.
portalImagenesRoutes.get('/:archivo_id', async (c) => {
  const archivoId = Number(c.req.param('archivo_id'));
  if (!Number.isInteger(archivoId) || archivoId <= 0) return c.notFound();

  const archivo = await obtenerArchivoPorId(c.env.DB, archivoId);
  if (!archivo) return c.notFound();
  if (!(await padrePublicado(c.env.DB, archivo.tipo, archivo.padre_id))) return c.notFound();

  // Imagen externa: mandamos al visitante a la URL original.
  if (archivo.url_externo) {
    const destino = esHttp(archivo.url_externo) ? archivo.url_externo : null;
    if (destino) return c.redirect(destino, 302);
    return c.notFound();
  }

  // Imagen en R2: se sirve el objeto con caché larga (el nombre es único por
  // subida, así que la URL nunca cambia de contenido y no hace falta invalidar).
  if (archivo.key_r2) {
    const bucket = c.env.R2_PUBLIC_BUCKET;
    if (!bucket) {
      // Sin bucket configurado: no se inventa nada, se dice que no está disponible.
      return new Response('Imagen no disponible en este momento.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
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
      return new Response('Imagen no disponible en este momento.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }

  // Sin key de R2 ni url externa: si la url pública es http(s), redirigimos.
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