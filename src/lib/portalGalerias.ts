// Datos agregados de las galerías para el listado público: cuántas fotos tiene
// cada una y qué imagen de portada mostrar (la portada cargada, o si no, la
// primera foto de la galería). Consulta agrupada: una sola fila leída por
// galería, no una por foto.

import type { Galeria } from './portalContent.ts';
import { listarGaleriasPublicadas } from './portalContent.ts';

export interface GaleriaConPortada extends Galeria {
  portadaEfectiva: string;
  total: number;
}

/**
 * Las galerías publicadas, completas con portada efectiva y conteo de fotos,
 * listas para el listado público.
 */
export async function completarGaleriasPublicas(db: D1Database): Promise<GaleriaConPortada[]> {
  const galerias = await listarGaleriasPublicadas(db);
  if (galerias.length === 0) return [];

  const { results } = await db
    .prepare(
      `SELECT g.id AS gid, COUNT(i.id) AS total,
              COALESCE(MIN(CASE WHEN i.orden > 0 THEN i.url END), MIN(i.url)) AS primera
       FROM portal_galleries g
       LEFT JOIN portal_gallery_images i ON i.gallery_id = g.id
       WHERE g.status = 'published'
       GROUP BY g.id`
    )
    .all<{ gid: number; total: number; primera: string | null }>();

  const porId = new Map<number, { total: number; primera: string | null }>();
  for (const row of results ?? []) porId.set(Number(row.gid), { total: Number(row.total), primera: row.primera });

  return galerias.map((g) => {
    const extra = porId.get(g.id);
    return {
      ...g,
      total: extra?.total ?? 0,
      portadaEfectiva: g.portada || extra?.primera || '',
    };
  });
}
