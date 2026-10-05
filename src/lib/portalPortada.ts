// Datos de la portada pública del sitio.
//
// Junta, ya filtrado por publicación, lo que se muestra en `/`: la
// configuración del portal, la noticia principal, las noticias destacadas, las
// últimas fotos, el complejo y la información del torneo. La lista de lo
// destacado la elige un usuario en /portal-admin/destacados; acá sólo se resuelve
// lo que está publicado (un borrador nunca llega a esta capa).

import type { D1Database } from '@cloudflare/workers-types';
import {
  obtenerGaleriaPublica,
  obtenerNoticiaPublica,
  obtenerPaginaPublica,
  type ComplejoData,
  type Noticia,
  type TorneoData,
} from './portalContent.ts';
import { completarGaleriasPublicas, type GaleriaConPortada } from './portalGalerias.ts';
import { CONFIG_ID, obtenerArchivoPorPadreYTipo, urlArchivo } from './portalArchivos.ts';
import { leerConfigPublica, leerPortada, type PortalConfig } from './portalConfig.ts';

export interface FotoPortada {
  id: number;
  gallery_id: number;
  url: string;
  caption: string;
}

export interface DatosPortada {
  /** Configuración publicada, o null si todavía no se publicó ninguna. */
  config: PortalConfig | null;
  /** Imágenes de identidad: fondo de la portada y logo. Vacías si no hay. */
  identidad: { hero: string; logo: string };
  /** Noticia principal de la portada, si se eligió y está publicada. */
  hero: Noticia | null;
  noticias: Noticia[];
  galerias: GaleriaConPortada[];
  fotos: FotoPortada[];
  complejo: ComplejoData | null;
  torneo: TorneoData | null;
}

/** Cuántas noticias y fotos entran en la portada. */
const MAX_NOTICIAS = 4;
const MAX_FOTOS = 8;
const MAX_GALERIAS = 3;

/** Últimas noticias publicadas (para cuando todavía no hay ninguna destacada). */
async function ultimasNoticias(db: D1Database, limite: number): Promise<Noticia[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM portal_noticias WHERE status = 'published'
       ORDER BY published_at DESC, id DESC LIMIT ?1`
    )
    .bind(limite)
    .all<Record<string, unknown>>();
  return (results ?? []).map((row) => ({
    id: Number(row['id']),
    titulo: String(row['titulo'] ?? ''),
    resumen: String(row['resumen'] ?? ''),
    contenido: String(row['contenido'] ?? ''),
    imagen: String(row['imagen'] ?? ''),
    status: 'published' as const,
    destacada: Number(row['destacada'] ?? 0) === 1,
    published_at: row['published_at'] == null ? null : String(row['published_at']),
    autor: String(row['autor'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  }));
}

/** Últimas fotos de galerías publicadas, en el orden en que se leyeron. */
async function ultimasFotos(db: D1Database, galerias: number[], limite: number): Promise<FotoPortada[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.gallery_id, i.url, i.caption
         FROM portal_gallery_images i
         JOIN portal_galleries g ON g.id = i.gallery_id
        WHERE g.status = 'published' AND i.url <> ''
        ORDER BY i.id DESC
        LIMIT ?1`
    )
    .bind(limite * 3)
    .all<{ id: number; gallery_id: number; url: string; caption: string }>();

  const todas = (results ?? []).map((r) => ({
    id: Number(r.id),
    gallery_id: Number(r.gallery_id),
    url: String(r.url),
    caption: String(r.caption ?? ''),
  }));
  if (galerias.length === 0) return todas.slice(0, limite);
  // Si hay galerías destacadas, la portada muestra fotos de esas galerías.
  const deDestacadas = todas.filter((f) => galerias.includes(f.gallery_id));
  return (deDestacadas.length > 0 ? deDestacadas : todas).slice(0, limite);
}

/**
 * Todo lo publicado que se muestra en `/`. Devuelve un objeto vacío (sin
 * listas) si todavía no hay nada cargado: la portada arma las secciones a
 * partir de lo que llega, así nunca muestra un bloque en blanco.
 */
export async function datosPortada(db: D1Database): Promise<DatosPortada> {
  const [config, portada, paginas] = await Promise.all([
    leerConfigPublica(db),
    leerPortada(db),
    Promise.all([obtenerPaginaPublica(db, 'complejo'), obtenerPaginaPublica(db, 'torneo')]),
  ]);

  const [hero, galeriasTodas] = await Promise.all([
    portada.noticia_hero_id != null ? obtenerNoticiaPublica(db, portada.noticia_hero_id) : Promise.resolve(null),
    completarGaleriasPublicas(db),
  ]);
  const porId = new Map(galeriasTodas.map((g) => [g.id, g]));

  // Noticias destacadas en el orden elegido; si no hay ninguna, las últimas.
  const destacadas: Noticia[] = [];
  for (const id of portada.noticias_destacadas) {
    const n = await obtenerNoticiaPublica(db, id);
    if (n && !destacadas.includes(n)) destacadas.push(n);
    if (destacadas.length >= MAX_NOTICIAS) break;
  }
  const noticias =
    destacadas.length > 0
      ? destacadas
      : hero
        ? [hero, ...(await ultimasNoticias(db, MAX_NOTICIAS + 1))].filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i).slice(0, MAX_NOTICIAS)
        : await ultimasNoticias(db, MAX_NOTICIAS);

  const galerias = portada.galerias_destacadas
    .map((id) => porId.get(id))
    .filter((g): g is GaleriaConPortada => g != null)
    .slice(0, MAX_GALERIAS);

  const fotos = await ultimasFotos(
    db,
    galerias.map((g) => g.id),
    MAX_FOTOS
  );

  const [complejo, torneo] = paginas;
  // Las imágenes de identidad sólo existen si la configuración está publicada.
  const identidad = config
    ? {
        hero: config.mostrar_hero ? urlArchivo(await obtenerArchivoPorPadreYTipo(db, 'config.hero', CONFIG_ID)) : '',
        logo: urlArchivo(await obtenerArchivoPorPadreYTipo(db, 'config.logo', CONFIG_ID)),
      }
    : { hero: '', logo: '' };

  return {
    config,
    identidad,
    hero,
    noticias,
    galerias,
    fotos,
    complejo: complejo ? (complejo.data as ComplejoData) : null,
    torneo: torneo ? (torneo.data as TorneoData) : null,
  };
}