// Resumen del portal para el dashboard de /portal-admin.
//
// Una sola lectura con agregados: el dashboard se abre mucho (es la pantalla de
// entrada) y no necesita traer el contenido entero, solo los números y el estado
// de publicación para saber qué falta por publicar.

import type { D1Database } from '@cloudflare/workers-types';

export interface ResumenPortal {
  noticias: { total: number; publicadas: number; borradores: number };
  galerias: { total: number; publicadas: number; borradores: number; fotos: number };
  /** Lo que hay elegido como destacado en la portada. */
  portada: { hero: number | null; noticias: number; galerias: number };
  /** Estado de la configuración del portal (nombre y publicación). */
  config: { nombre: string; publicada: boolean };
  /** Imágenes subidas al sitio (no los enlaces externos). */
  archivos: number;
}

const VACIO: ResumenPortal = {
  noticias: { total: 0, publicadas: 0, borradores: 0 },
  galerias: { total: 0, publicadas: 0, borradores: 0, fotos: 0 },
  portada: { hero: null, noticias: 0, galerias: 0 },
  config: { nombre: '', publicada: false },
  archivos: 0,
};

interface FilaResumen {
  noticias_total: number;
  noticias_pub: number;
  galerias_total: number;
  galerias_pub: number;
  fotos: number;
  portada_hero: number | null;
  portada_noticias: string | null;
  portada_galerias: string | null;
  config_nombre: string;
  config_status: string;
  archivos: number;
}

function cuantosIdsCrudos(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function resumenPortal(db: D1Database): Promise<ResumenPortal> {
  const fila = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM portal_noticias) AS noticias_total,
         (SELECT COUNT(*) FROM portal_noticias WHERE status = 'published') AS noticias_pub,
         (SELECT COUNT(*) FROM portal_galleries) AS galerias_total,
         (SELECT COUNT(*) FROM portal_galleries WHERE status = 'published') AS galerias_pub,
         (SELECT COUNT(*) FROM portal_gallery_images) AS fotos,
         (SELECT noticia_hero_id FROM portal_portada WHERE portada_id = 1) AS portada_hero,
         (SELECT noticias_destacadas FROM portal_portada WHERE portada_id = 1) AS portada_noticias,
         (SELECT galerias_destacadas FROM portal_portada WHERE portada_id = 1) AS portada_galerias,
         (SELECT nombre FROM portal_configuracion WHERE config_id = 1) AS config_nombre,
         (SELECT status FROM portal_configuracion WHERE config_id = 1) AS config_status,
         (SELECT COUNT(*) FROM portal_archivos) AS archivos`
    )
    .first<FilaResumen>();
  if (!fila) return { ...VACIO };

  const noticias = Number(fila.noticias_total ?? 0);
  const noticiasPub = Number(fila.noticias_pub ?? 0);
  const galerias = Number(fila.galerias_total ?? 0);
  const galeriasPub = Number(fila.galerias_pub ?? 0);
  return {
    noticias: { total: noticias, publicadas: noticiasPub, borradores: noticias - noticiasPub },
    galerias: { total: galerias, publicadas: galeriasPub, borradores: galerias - galeriasPub, fotos: Number(fila.fotos ?? 0) },
    portada: {
      hero: fila.portada_hero == null ? null : Number(fila.portada_hero),
      noticias: cuantosIdsCrudos(fila.portada_noticias),
      galerias: cuantosIdsCrudos(fila.portada_galerias),
    },
    config: { nombre: String(fila.config_nombre ?? ''), publicada: fila.config_status === 'published' },
    archivos: Number(fila.archivos ?? 0),
  };
}