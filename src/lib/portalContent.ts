// Contenido editorial del portal: noticias, galerías de fotos y páginas
// (complejo / información del torneo).
//
// Todo lo de acá es independiente del control competitivo: no lee ni escribe
// fixture, resultados ni posiciones. La regla de oro es que SOLO lo publicado
// se ve en el sitio: las consultas públicas filtran por status = 'published'
// en la base, no en la vista.
//
// Las imágenes son URLs (http/https), igual que logo_url de los equipos: sin
// binarios en D1 y sin servicios externos.

import { esc } from './html.ts';
import { leagueNow } from './live.ts';

export type EstadoContenido = 'draft' | 'published';

const ESTADOS: readonly EstadoContenido[] = ['draft', 'published'];

/* ============================== Tipos ============================== */

export interface Noticia {
  id: number;
  titulo: string;
  resumen: string;
  contenido: string;
  imagen: string;
  status: EstadoContenido;
  destacada: boolean;
  published_at: string | null;
  autor: string;
  created_at: string;
  updated_at: string;
}

export interface Galeria {
  id: number;
  titulo: string;
  descripcion: string;
  portada: string;
  fecha: string | null;
  status: EstadoContenido;
  created_at: string;
  updated_at: string;
}

export interface ImagenGaleria {
  id: number;
  gallery_id: number;
  url: string;
  caption: string;
  orden: number;
  /** Archivo de R2 que backs esta foto, si se subió en vez de enlazarse. */
  archivo_id: number | null;
}

/** Campos del Complejo (página 'complejo'). */
export interface ComplejoData {
  nombre: string;
  descripcion: string;
  direccion: string;
  telefono: string;
  whatsapp: string;
  horarios: string;
  como_llegar: string;
  info_util: string;
  imagen: string;
  /** Instalaciones: lista simple y extensible (nombre + detalle). */
  instalaciones: { nombre: string; detalle: string }[];
}

/** Campos de Información del torneo (página 'torneo'). Solo editorial. */
export interface TorneoData {
  presentacion: string;
  descripcion: string;
  dias_juego: string;
  horarios: string;
  info_equipos: string;
  contacto: string;
  /** Reglamento / documentos: lista de enlaces (título + URL). */
  documentos: { titulo: string; url: string }[];
  adicional: string;
}

export interface PaginaContenido {
  slug: 'complejo' | 'torneo';
  status: EstadoContenido;
  data: ComplejoData | TorneoData;
  updated_at: string;
}

/* ============================ Validación ============================ */

export type Resultado<T> = { ok: true; value: T } | { ok: false; error: string };

function texto(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * URL de imagen aceptada: vacía o http/https absoluto. Cualquier otra cosa
 * (javascript:, data:, texto raro) se rechaza en el servidor.
 */
export function validarUrlImagen(raw: unknown): Resultado<string> {
  const value = texto(raw, 2000);
  if (value === '') return { ok: true, value: '' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'La imagen tiene que ser un enlace que empiece con https:// (o vacío).' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'La imagen tiene que ser un enlace http o https.' };
  }
  return { ok: true, value };
}

/** Fecha opcional en formato YYYY-MM-DD (vacío = sin fecha). */
export function validarFecha(raw: unknown): Resultado<string | null> {
  const value = texto(raw, 10);
  if (value === '') return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    return { ok: false, error: 'La fecha tiene que tener el formato DÍA/MES/AÑO.' };
  }
  return { ok: true, value };
}

function estadoDe(raw: unknown): EstadoContenido {
  return ESTADOS.includes(raw as EstadoContenido) ? (raw as EstadoContenido) : 'draft';
}

export interface NoticiaInput {
  titulo: string;
  resumen: string;
  contenido: string;
  imagen: string;
  autor: string;
  published_at: string | null;
  destacada: boolean;
  status: EstadoContenido;
}

/** Valida el formulario de una noticia (alta o edición). */
export function validarNoticia(form: Record<string, unknown>): Resultado<NoticiaInput> {
  const titulo = texto(form['titulo'], 160);
  if (!titulo) return { ok: false, error: 'La noticia necesita un título.' };
  const imagen = validarUrlImagen(form['imagen']);
  if (!imagen.ok) return imagen;
  const fecha = validarFecha(form['published_at']);
  if (!fecha.ok) return fecha;
  return {
    ok: true,
    value: {
      titulo,
      resumen: texto(form['resumen'], 300),
      contenido: texto(form['contenido'], 20_000),
      imagen: imagen.value,
      autor: texto(form['autor'], 120),
      published_at: fecha.value,
      destacada: form['destacada'] === 'on' || form['destacada'] === '1' || form['destacada'] === 'true',
      status: estadoDe(form['status']),
    },
  };
}

export interface GaleriaInput {
  titulo: string;
  descripcion: string;
  portada: string;
  fecha: string | null;
  status: EstadoContenido;
}

export function validarGaleria(form: Record<string, unknown>): Resultado<GaleriaInput> {
  const titulo = texto(form['titulo'], 160);
  if (!titulo) return { ok: false, error: 'La galería necesita un título.' };
  const portada = validarUrlImagen(form['portada']);
  if (!portada.ok) return portada;
  const fecha = validarFecha(form['fecha']);
  if (!fecha.ok) return fecha;
  return {
    ok: true,
    value: {
      titulo,
      descripcion: texto(form['descripcion'], 600),
      portada: portada.value,
      fecha: fecha.value,
      status: estadoDe(form['status']),
    },
  };
}

/** Valida una imagen a agregar a una galería (URL + pie opcional). */
export function validarImagenGaleria(form: Record<string, unknown>): Resultado<{ url: string; caption: string }> {
  const url = validarUrlImagen(form['url']);
  if (!url.ok) return url;
  if (!url.value) return { ok: false, error: 'Pegá el enlace de la imagen.' };
  return { ok: true, value: { url: url.value, caption: texto(form['caption'], 200) } };
}

/** Estado de una página: draft salvo que diga explícitamente lo contrario. */
export function estadoPagina(form: Record<string, unknown>): EstadoContenido {
  return estadoDe(form['status']);
}

/* ====================== Páginas: leer/guardar ====================== */

const COMPLEJO_VACIO: ComplejoData = {
  nombre: '',
  descripcion: '',
  direccion: '',
  telefono: '',
  whatsapp: '',
  horarios: '',
  como_llegar: '',
  info_util: '',
  imagen: '',
  instalaciones: [],
};

const TORNEO_VACIO: TorneoData = {
  presentacion: '',
  descripcion: '',
  dias_juego: '',
  horarios: '',
  info_equipos: '',
  contacto: '',
  documentos: [],
  adicional: '',
};

function linea(raw: unknown, max: number): string {
  return texto(raw, max);
}

/**
 * Lee los campos del formulario del complejo. Las instalaciones llegan como
 * filas repetidas (nombre + detalle): simple, extensible y sin JS.
 */
export function leerComplejoForm(form: Record<string, unknown>): ComplejoData {
  const nombres = asArray(form['inst_nombre']);
  const detalles = asArray(form['inst_detalle']);
  const instalaciones: { nombre: string; detalle: string }[] = [];
  for (let i = 0; i < nombres.length; i++) {
    const nombre = linea(nombres[i], 120);
    if (!nombre) continue;
    instalaciones.push({ nombre, detalle: linea(detalles[i], 300) });
    if (instalaciones.length >= 50) break;
  }
  return {
    nombre: linea(form['nombre'], 160),
    descripcion: linea(form['descripcion'], 4000),
    direccion: linea(form['direccion'], 300),
    telefono: linea(form['telefono'], 60),
    whatsapp: linea(form['whatsapp'], 60),
    horarios: linea(form['horarios'], 1000),
    como_llegar: linea(form['como_llegar'], 2000),
    info_util: linea(form['info_util'], 4000),
    imagen: (validarUrlImagen(form['imagen']) as { value: string }).value || '',
    instalaciones,
  };
}

/** Lee los campos del formulario de información del torneo (solo editorial). */
export function leerTorneoForm(form: Record<string, unknown>): TorneoData {
  const titulos = asArray(form['doc_titulo']);
  const urls = asArray(form['doc_url']);
  const documentos: { titulo: string; url: string }[] = [];
  for (let i = 0; i < titulos.length; i++) {
    const titulo = linea(titulos[i], 160);
    const url = (validarUrlImagen(urls[i]) as { value: string }).value;
    if (!titulo || !url) continue;
    documentos.push({ titulo, url });
    if (documentos.length >= 30) break;
  }
  return {
    presentacion: linea(form['presentacion'], 4000),
    descripcion: linea(form['descripcion'], 8000),
    dias_juego: linea(form['dias_juego'], 1000),
    horarios: linea(form['horarios'], 1000),
    info_equipos: linea(form['info_equipos'], 4000),
    contacto: linea(form['contacto'], 600),
    documentos,
    adicional: linea(form['adicional'], 4000),
  };
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  return [raw];
}

/** Convierte el JSON guardado en el objeto de la página (tolerante a basura). */
export function parsePaginaData(slug: 'complejo' | 'torneo', json: string): ComplejoData | TorneoData {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (slug === 'complejo') {
    const base: ComplejoData = { ...COMPLEJO_VACIO, ...stripKnown(data, COMPLEJO_VACIO) };
    const inst = Array.isArray(data['instalaciones']) ? data['instalaciones'] : [];
    base.instalaciones = inst
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ nombre: linea(x['nombre'], 120), detalle: linea(x['detalle'], 300) }))
      .filter((x) => x.nombre !== '');
    return base;
  }
  const base: TorneoData = { ...TORNEO_VACIO, ...stripKnown(data, TORNEO_VACIO) };
  const docs = Array.isArray(data['documentos']) ? data['documentos'] : [];
  base.documentos = docs
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ titulo: linea(x['titulo'], 160), url: linea(x['url'], 2000) }))
    .filter((x) => x.titulo !== '' && x.url !== '');
  return base;
}

/** Copia solo las claves string del JSON guardado sobre el default. */
function stripKnown(data: Record<string, unknown>, base: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(base)) {
    const v = data[key];
    if (typeof v === 'string') out[key] = v.slice(0, 20_000);
  }
  return out;
}

/* ============================ Consultas ============================ */

function mapNoticia(row: Record<string, unknown>): Noticia {
  return {
    id: Number(row['id']),
    titulo: String(row['titulo'] ?? ''),
    resumen: String(row['resumen'] ?? ''),
    contenido: String(row['contenido'] ?? ''),
    imagen: String(row['imagen'] ?? ''),
    status: row['status'] === 'published' ? 'published' : 'draft',
    destacada: Number(row['destacada'] ?? 0) === 1,
    published_at: row['published_at'] == null ? null : String(row['published_at']),
    autor: String(row['autor'] ?? ''),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

/** Todas las noticias para el panel (más nuevas arriba). */
export async function listarNoticias(db: D1Database): Promise<Noticia[]> {
  const { results } = await db
    .prepare('SELECT * FROM portal_noticias ORDER BY id DESC')
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapNoticia);
}

/** Noticias PUBLICADAS para el sitio (la única consulta que ve el público). */
export async function listarNoticiasPublicadas(db: D1Database): Promise<Noticia[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM portal_noticias WHERE status = 'published'
       ORDER BY destacada DESC, published_at DESC, id DESC`
    )
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapNoticia);
}

export async function obtenerNoticia(db: D1Database, id: number): Promise<Noticia | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.prepare('SELECT * FROM portal_noticias WHERE id = ?1').bind(id).first<Record<string, unknown>>();
  return row ? mapNoticia(row) : null;
}

/** Una noticia solo si está publicada (la usan las rutas públicas). */
export async function obtenerNoticiaPublica(db: D1Database, id: number): Promise<Noticia | null> {
  const n = await obtenerNoticia(db, id);
  return n && n.status === 'published' ? n : null;
}

export async function crearNoticia(db: D1Database, input: NoticiaInput): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO portal_noticias (titulo, resumen, contenido, imagen, status, destacada, published_at, autor)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      input.titulo,
      input.resumen,
      input.contenido,
      input.imagen,
      input.status,
      input.destacada ? 1 : 0,
      input.status === 'published' ? input.published_at ?? hoy() : null,
      input.autor
    )
    .run();
  return Number(res.meta.last_row_id ?? 0);
}

export async function actualizarNoticia(db: D1Database, id: number, input: NoticiaInput): Promise<void> {
  await db
    .prepare(
      `UPDATE portal_noticias
       SET titulo = ?1, resumen = ?2, contenido = ?3, imagen = ?4, status = ?5,
           destacada = ?6, published_at = ?7, autor = ?8, updated_at = datetime('now')
       WHERE id = ?9`
    )
    .bind(
      input.titulo,
      input.resumen,
      input.contenido,
      input.imagen,
      input.status,
      input.destacada ? 1 : 0,
      input.status === 'published' ? input.published_at ?? hoy() : input.published_at,
      input.autor,
      id
    )
    .run();
}

/** Cambia el estado (publicar / despublicar) sin tocar el resto. */
export async function cambiarEstadoNoticia(db: D1Database, id: number, status: EstadoContenido): Promise<void> {
  await db
    .prepare(
      `UPDATE portal_noticias
       SET status = ?1,
           published_at = CASE WHEN ?1 = 'published' AND published_at IS NULL THEN ?2 ELSE published_at END,
           updated_at = datetime('now')
       WHERE id = ?3`
    )
    .bind(status, hoy(), id)
    .run();
}

export async function alternarDestacada(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE portal_noticias SET destacada = CASE destacada WHEN 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?1")
    .bind(id)
    .run();
}

export async function eliminarNoticia(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM portal_noticias WHERE id = ?1').bind(id).run();
}

/** Fecha de hoy (YYYY-MM-DD) según el reloj de la liga (hora de Argentina). */
export function hoy(): string {
  return leagueNow().date;
}

/* ------------------------------ Galerías ------------------------------ */

function mapGaleria(row: Record<string, unknown>): Galeria {
  return {
    id: Number(row['id']),
    titulo: String(row['titulo'] ?? ''),
    descripcion: String(row['descripcion'] ?? ''),
    portada: String(row['portada'] ?? ''),
    fecha: row['fecha'] == null ? null : String(row['fecha']),
    status: row['status'] === 'published' ? 'published' : 'draft',
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

export async function listarGalerias(db: D1Database): Promise<Galeria[]> {
  const { results } = await db.prepare('SELECT * FROM portal_galleries ORDER BY id DESC').all<Record<string, unknown>>();
  return (results ?? []).map(mapGaleria);
}

/** Galerías PUBLICADAS para el sitio. */
export async function listarGaleriasPublicadas(db: D1Database): Promise<Galeria[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM portal_galleries WHERE status = 'published'
       ORDER BY fecha IS NULL, fecha DESC, id DESC`
    )
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapGaleria);
}

export async function obtenerGaleria(db: D1Database, id: number): Promise<Galeria | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.prepare('SELECT * FROM portal_galleries WHERE id = ?1').bind(id).first<Record<string, unknown>>();
  return row ? mapGaleria(row) : null;
}

export async function obtenerGaleriaPublica(db: D1Database, id: number): Promise<Galeria | null> {
  const g = await obtenerGaleria(db, id);
  return g && g.status === 'published' ? g : null;
}

export async function crearGaleria(db: D1Database, input: GaleriaInput): Promise<number> {
  const res = await db
    .prepare(
      'INSERT INTO portal_galleries (titulo, descripcion, portada, fecha, status) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
    .bind(input.titulo, input.descripcion, input.portada, input.fecha, input.status)
    .run();
  return Number(res.meta.last_row_id ?? 0);
}

export async function actualizarGaleria(db: D1Database, id: number, input: GaleriaInput): Promise<void> {
  await db
    .prepare(
      `UPDATE portal_galleries SET titulo = ?1, descripcion = ?2, portada = ?3, fecha = ?4,
       status = ?5, updated_at = datetime('now') WHERE id = ?6`
    )
    .bind(input.titulo, input.descripcion, input.portada, input.fecha, input.status, id)
    .run();
}

export async function cambiarEstadoGaleria(db: D1Database, id: number, status: EstadoContenido): Promise<void> {
  await db
    .prepare("UPDATE portal_galleries SET status = ?1, updated_at = datetime('now') WHERE id = ?2")
    .bind(status, id)
    .run();
}

/** Borra la galería y sus imágenes (cascada explícita, sin depender del PRAGMA). */
export async function eliminarGaleria(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM portal_gallery_images WHERE gallery_id = ?1').bind(id),
    db.prepare('DELETE FROM portal_galleries WHERE id = ?1').bind(id),
  ]);
}

/** Cambia la URL de la imagen de portada de una galería. */
export async function actualizarPortadaGaleria(db: D1Database, id: number, portada: string): Promise<void> {
  await db
    .prepare("UPDATE portal_galleries SET portada = ?1, updated_at = datetime('now') WHERE id = ?2")
    .bind(portada, id)
    .run();
}

/**
 * Cambia solo la imagen de la página del complejo, sin tocar el resto del
 * contenido editorial (la imagen se sube en su propio formulario, aparte del
 * texto, para no perder lo que se está escribiendo).
 */
export async function setImagenComplejo(db: D1Database, imagen: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE portal_pages SET data = json_set(data, '$.imagen', ?1), updated_at = datetime('now') WHERE slug = 'complejo'")
    .bind(imagen)
    .run();
  return Number(res.meta.changes ?? 0) > 0;
}

/* ------------------------------ Imágenes ------------------------------ */

function mapImagen(row: Record<string, unknown>): ImagenGaleria {
  return {
    id: Number(row['id']),
    gallery_id: Number(row['gallery_id']),
    url: String(row['url'] ?? ''),
    caption: String(row['caption'] ?? ''),
    orden: Number(row['orden'] ?? 0),
    archivo_id: row['archivo_id'] == null ? null : Number(row['archivo_id']),
  };
}

export async function listarImagenes(db: D1Database, galleryId: number): Promise<ImagenGaleria[]> {
  const { results } = await db
    .prepare('SELECT * FROM portal_gallery_images WHERE gallery_id = ?1 ORDER BY orden, id')
    .bind(galleryId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(mapImagen);
}

export async function agregarImagen(
  db: D1Database,
  galleryId: number,
  url: string,
  caption: string,
  archivoId: number | null = null,
): Promise<number> {
  const max = await db
    .prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM portal_gallery_images WHERE gallery_id = ?1')
    .bind(galleryId)
    .first<{ m: number }>();
  const res = await db
    .prepare('INSERT INTO portal_gallery_images (gallery_id, url, caption, orden, archivo_id) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(galleryId, url, caption, Number(max?.m ?? 0) + 1, archivoId)
    .run();
  return Number(res.meta.last_row_id ?? 0);
}

export async function obtenerImagen(db: D1Database, imageId: number): Promise<ImagenGaleria | null> {
  if (!Number.isInteger(imageId) || imageId <= 0) return null;
  const row = await db.prepare('SELECT * FROM portal_gallery_images WHERE id = ?1').bind(imageId).first<Record<string, unknown>>();
  return row ? mapImagen(row) : null;
}

/** Quita la foto y devuelve el archivo de R2 que tenía asociado (o null). */
export async function quitarImagen(db: D1Database, imageId: number): Promise<number | null> {
  const img = await obtenerImagen(db, imageId);
  if (!img) return null;
  await db.prepare('DELETE FROM portal_gallery_images WHERE id = ?1').bind(imageId).run();
  return img.archivo_id;
}

/** Mueve una imagen un lugar (up/down) dentro de su galería. */
export async function moverImagen(db: D1Database, galleryId: number, imageId: number, direccion: 'up' | 'down'): Promise<void> {
  const imagenes = await listarImagenes(db, galleryId);
  const i = imagenes.findIndex((img) => img.id === imageId);
  if (i < 0) return;
  const j = direccion === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= imagenes.length) return;
  const a = imagenes[i]!;
  const b = imagenes[j]!;
  await db.batch([
    db.prepare('UPDATE portal_gallery_images SET orden = ?1 WHERE id = ?2').bind(b.orden, a.id),
    db.prepare('UPDATE portal_gallery_images SET orden = ?1 WHERE id = ?2').bind(a.orden, b.id),
  ]);
}

/** Actualiza el enlace y el pie (caption) de una imagen. */
export async function actualizarImagen(db: D1Database, imageId: number, url: string, caption: string): Promise<void> {
  await db.prepare('UPDATE portal_gallery_images SET url = ?1, caption = ?2 WHERE id = ?3')
    .bind(url, caption, imageId)
    .run();
}

/* ------------------------------ Páginas ------------------------------ */

export async function obtenerPagina(db: D1Database, slug: 'complejo' | 'torneo'): Promise<PaginaContenido | null> {
  const row = await db
    .prepare('SELECT slug, status, data, updated_at FROM portal_pages WHERE slug = ?1')
    .bind(slug)
    .first<{ slug: string; status: string; data: string; updated_at: string }>();
  if (!row) return null;
  return {
    slug,
    status: row.status === 'published' ? 'published' : 'draft',
    data: parsePaginaData(slug, row.data),
    updated_at: row.updated_at,
  };
}

/** La página solo si está publicada (rutas públicas). */
export async function obtenerPaginaPublica(db: D1Database, slug: 'complejo' | 'torneo'): Promise<PaginaContenido | null> {
  const p = await obtenerPagina(db, slug);
  return p && p.status === 'published' ? p : null;
}

export async function guardarPagina(
  db: D1Database,
  slug: 'complejo' | 'torneo',
  data: ComplejoData | TorneoData,
  status: EstadoContenido
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO portal_pages (slug, status, data, updated_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET status = ?2, data = ?3, updated_at = datetime('now')`
    )
    .bind(slug, status, JSON.stringify(data))
    .run();
}

/* =========================== Render helpers =========================== */

/**
 * Texto plano a párrafos HTML escapados. Nunca entra HTML del autor: primero
 * se escapa todo y recién después se agregan los <p>/<br>.
 */
export function parrafos(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
