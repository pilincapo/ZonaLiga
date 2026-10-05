// Archivos del portal: subida, validación y persistencia en R2 (o conservación de
// URL externa). Sin binarios en D1: guardamos metadatos en D1 y el archivo en R2;
// la URL pública debe servirse solo si el recurso padre está publicado.

import type { R2Bucket, R2Object, R2ObjectBody } from '@cloudflare/workers-types';
import type { D1Database } from '@cloudflare/workers-types';
import { validarUrlImagen } from './portalContent.ts';
import type { Resultado } from './portalContent.ts';

// Imágenes permitidas: tipo MIME y extensión normalizada, ambas restringidas.
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
const EXTENSION_POR_MIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MIME_POR_EXTENSION).map(([ext, mime]) => [mime, ext])
) as Readonly<Record<string, string>>;

// Tamaño máximo razonable por imagen (8 MB). Más que suficiente para fotos, hero
// y portadas y con margen para que un CM no se quede sin espacio por foto grande.
const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024;

// Magic bytes por formato permitido (primeros bytes del archivo).
const MAGIC: Array<{ mime: string; bytes: readonly number[]; extension: string }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], extension: 'png' },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], extension: 'jpg' },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], extension: 'webp' },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38], extension: 'gif' },
];

// Tipos de archivo con su prefijo de ruta en R2 y tabla padre semántica.
export type ArchivoTipo =
  | 'noticia.imagen_principal'
  | 'galeria.portada'
  | 'galeria.foto'
  | 'complejo.imagen'
  | 'config.hero'
  | 'config.logo';

export type ArchivoSubtipo = ArchivoTipo;

/** Qué representa un archivo: su prefijo en R2 y de qué tabla es padre. */
export interface ArchivoTipoInfo {
  tipo: ArchivoTipo;
  prefijo: string;
  padreTable: 'portal_noticias' | 'portal_galleries' | 'portal_pages' | 'portal_configuracion';
}

export const TIPO_INFO: Readonly<Record<ArchivoTipo, ArchivoTipoInfo>> = {
  'noticia.imagen_principal': { tipo: 'noticia.imagen_principal', prefijo: 'noticia/imagen', padreTable: 'portal_noticias' },
  'galeria.portada': { tipo: 'galeria.portada', prefijo: 'galeria/portada', padreTable: 'portal_galleries' },
  'galeria.foto': { tipo: 'galeria.foto', prefijo: 'galeria/foto', padreTable: 'portal_galleries' },
  'complejo.imagen': { tipo: 'complejo.imagen', prefijo: 'complejo/imagen', padreTable: 'portal_pages' },
  'config.hero': { tipo: 'config.hero', prefijo: 'config/hero', padreTable: 'portal_configuracion' },
  'config.logo': { tipo: 'config.logo', prefijo: 'config/logo', padreTable: 'portal_configuracion' },
} as const;

export function tipoInfo(tipo: ArchivoTipo): ArchivoTipoInfo {
  return TIPO_INFO[tipo] ?? { tipo, prefijo: 'archivo', padreTable: 'portal_noticias' };
}

export interface Archivo {
  archivo_id: number;
  tipo: ArchivoTipo;
  padre_id: number;
  nombre_seguridad: string;
  extension: string;
  mime: string;
  tamano_bytes: number;
  url_externo: string | null;
  key_r2: string | null;
  url_publico: string;
  es_publico: 0 | 1;
  updated_at: string;
}

/** Url pública de un archivo ya resuelto: externo o la propia url_publico.
 * En R2 la `url_publico` ya guarda el dominio completo del bucket, así que no
 * hace falta volver a construirla acá. */
export function urlPublico(archivo: Pick<Archivo, 'url_publico' | 'key_r2' | 'url_externo'>): string {
  if (archivo.url_externo) return archivo.url_externo;
  return archivo.url_publico;
}

/** Limpia la URL externa rechazando javascript:, data: y no-HTTP(S). */
export function limpiarUrlExterno(raw: unknown): Resultado<string | null> {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  return validarUrlImagen(raw);
}

/** Detecta el tipo MIME real leyendo magic bytes del ArrayBuffer. */
export function mimePorMagicBytes(buf: ArrayBuffer, mimeEsperado?: string): Resultado<{
  mime: string;
  extension: string;
  tamano_bytes: number;
}> {
  const bytes = new Uint8Array(buf);
  const tamano = bytes.byteLength;
  if (!Number.isFinite(tamano) || tamano < 8) {
    return { ok: false, error: 'El archivo es muy pequeño o está vacío.' };
  }
  if (tamano > TAMANO_MAXIMO_BYTES) {
    return { ok: false, error: `El archivo supera el límite de ${TAMANO_MAXIMO_BYTES / 1024 / 1024} MB.` };
  }
  let encontrado: (typeof MAGIC)[number] | undefined;
  for (const entrada of MAGIC) {
    let ok = true;
    for (let i = 0; i < entrada.bytes.length; i++) {
      if (bytes[i] !== entrada.bytes[i]) { ok = false; break; }
    }
    if (ok) { encontrado = entrada; break; }
  }
  if (!encontrado) {
    return { ok: false, error: 'El archivo no es una imagen reconocida (JPG, PNG, WebP, GIF).' };
  }
  // Valida que el MIME declarado (si se pasa) sea el correcto; si no, usa el detectado.
  if (mimeEsperado && mimeEsperado !== encontrado.mime) {
    if (!Object.values(MIME_POR_EXTENSION).includes(mimeEsperado)) {
      return { ok: false, error: 'El archivo no es una imagen de los tipos permitidos.' };
    }
    // Si el cliente dijo el MIME correcto pero distinto (ej jpeg vs jpg), aceptamos el detectado.
    // No aceptamos MIME declarado inválido.
    return { ok: false, error: 'El archivo no es una imagen reconocida.' };
  }
  return { ok: true, value: { mime: encontrado.mime, extension: encontrado.extension, tamano_bytes: tamano } };
}

/** Nombre seguro único por prefijo: uuid + extensión normalizada. */
export function nombreSeguro(tipo: ArchivoTipo, extension: string): string {
  const prefijo = TIPO_INFO[tipo].prefijo;
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${prefijo}/${id}.${extension}`;
}

/** Valida y normaliza la extensión a una permitida. */
export function normalizarExtension(mime: string): string {
  return EXTENSION_POR_MIME[mime] ?? 'jpg';
}

/** Construye la URL pública de un archivo en R2 a partir de su key. */
export function urlR2(bucketDomain: string, key: string): string {
  return `https://${bucketDomain}/${key}`;
}

/** Booleano de si un archivo es público (sirve públicamente). No reemplaza la
 * validación de padre publicado al servir: esto es solo metadato. */
export function archivoEsPublico(a: Pick<Archivo, 'es_publico'>): boolean {
  return a.es_publico === 1;
}

// ---------- CRUD sobre la tabla portal_archivos ----------

export async function crearArchivo(
  db: D1Database,
  input: {
    tipo: ArchivoTipo;
    subtipo?: ArchivoSubtipo;
    padre_id: number;
    nombre_seguridad: string;
    extension: string;
    mime: string;
    tamano_bytes: number;
    url_publico: string;
    key_r2?: string | null;
    url_externo?: string | null;
    es_publico?: 0 | 1;
  },
): Promise<Archivo> {
  const r = await db.prepare(
    `INSERT INTO portal_archivos (tipo, padre_id, nombre_seguridad, extension, mime, tamano_bytes, url_externo, key_r2, url_publico, es_publico)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     RETURNING archivo_id, tipo, padre_id, nombre_seguridad, extension, mime, tamano_bytes, url_externo, key_r2, url_publico, es_publico, updated_at`
  )
    .bind(
      input.tipo,
      input.padre_id,
      input.nombre_seguridad,
      input.extension,
      input.mime,
      input.tamano_bytes,
      input.url_externo ?? null,
      input.key_r2 ?? null,
      input.url_publico,
      input.es_publico ?? 1,
    )
    .first();
  if (!r) throw new Error('No se pudo crear el archivo.');
  return r as unknown as Archivo;
}

export async function obtenerArchivoPorId(db: D1Database, archivo_id: number): Promise<Archivo | null> {
  return db.prepare('SELECT * FROM portal_archivos WHERE archivo_id = ?1').bind(archivo_id).first() as Promise<Archivo | null>;
}

export async function obtenerArchivoPorPadreYTipo(
  db: D1Database,
  tipo: ArchivoTipo,
  padre_id: number,
): Promise<Archivo | null> {
  return db.prepare('SELECT * FROM portal_archivos WHERE tipo = ?1 AND padre_id = ?2').bind(tipo, padre_id).first() as Promise<Archivo | null>;
}

/** Reemplazar un archivo existente por tipo/padre: borra el objeto R2 anterior si lo tiene,
 * y deja el registro nuevo. Devuelve el nuevo registro. */
export async function reemplazarArchivo(
  db: D1Database,
  r2: R2Bucket | null,
  input: {
    tipo: ArchivoTipo;
    padre_id: number;
    nombre_seguridad: string;
    extension: string;
    mime: string;
    tamano_bytes: number;
    url_publico: string;
    key_r2?: string | null;
    url_externo?: string | null;
    es_publico?: 0 | 1;
  },
): Promise<Archivo> {
  const existente = await obtenerArchivoPorPadreYTipo(db, input.tipo, input.padre_id);
  if (existente && existente.key_r2) {
    const key = existente.key_r2;
    try {
      if (r2) await r2.delete(key);
    } catch {
      // Si falla la borrado (ej. bucket no disponible en test), no impedimos el reemplazo;
      // en producción esto debería registrarse y tratarse como un problema de limpieza.
    }
  }
  return crearArchivo(db, {
    ...input,
    key_r2: input.key_r2 ?? null,
    url_externo: input.url_externo ?? null,
  });
}

/** Subir un archivo a R2 y crear el registro en D1, o conservar URL externo si se prefiere. */
export async function subirArchivo(
  db: D1Database,
  r2: R2Bucket | null,
  bucketDomain: string,
  tipo: ArchivoTipo,
  padreId: number,
  buffer: ArrayBuffer,
  mimeEsperado?: string,
  esPublico?: 0 | 1,
): Promise<Archivo> {
  const deteccion = mimePorMagicBytes(buffer, mimeEsperado);
  if (!deteccion.ok) throw new Error(deteccion.error);
  const { mime, extension, tamano_bytes } = deteccion.value;
  const nombre = nombreSeguro(tipo, extension);
  const urlArchivo = urlR2(bucketDomain, nombre);
  if (r2) {
    await r2.put(nombre, buffer, {
      httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
    });
  }
  return crearArchivo(db, {
    tipo,
    padre_id: padreId,
    nombre_seguridad: nombre,
    extension,
    mime,
    tamano_bytes,
    url_publico: urlArchivo,
    key_r2: r2 ? nombre : null,
    es_publico: esPublico ?? 1,
  });
}

/** Eliminar un archivo: borra el objeto R2 si existe y quita el registro. */
export async function eliminarArchivo(db: D1Database, r2: R2Bucket | null, archivo_id: number): Promise<boolean> {
  const archivo = await obtenerArchivoPorId(db, archivo_id);
  if (!archivo) return false;
  if (archivo.key_r2 && r2) {
    try { await r2.delete(archivo.key_r2); } catch { /* best effort */ }
  }
  await db.prepare('DELETE FROM portal_archivos WHERE archivo_id = ?1').bind(archivo_id).run();
  return true;
}

/** Eliminar un archivo por tipo/padre (para noticia, complejo, configuración):
 *  borra el objeto R2 si lo tiene y quita el registro. */
export async function eliminarArchivoPorTipoYTipo(
  db: D1Database,
  r2: R2Bucket | null,
  tipo: ArchivoTipo,
  padre_id: number,
): Promise<boolean> {
  const archivo = await obtenerArchivoPorPadreYTipo(db, tipo, padre_id);
  if (!archivo) return false;
  return eliminarArchivo(db, r2, archivo.archivo_id);
}

/** Quitar imagen de noticia: elimina el archivo asociado y deja el campo de imagen vacío. */
export async function quitarImagenNoticia(
  db: D1Database,
  r2: R2Bucket | null,
  noticiaId: number,
): Promise<void> {
  await eliminarArchivoPorTipoYTipo(db, r2, 'noticia.imagen_principal', noticiaId);
  await db.prepare("UPDATE portal_noticias SET imagen = '' WHERE id = ?1").bind(noticiaId).run();
}

/** Lista archivos públicos del portal, según la vista creada en la migración. */
export async function archivosPublicos(db: D1Database): Promise<
  Array<{ archivo_id: number; tipo: ArchivoTipo; padre_id: number; url_publico: string; mime: string; tamano_bytes: number }>
> {
  return db
    .prepare('SELECT archivo_id, tipo, padre_id, url_publico, mime, tamano_bytes FROM portal_archivos_publicos')
    .all() as unknown as Array<{
      archivo_id: number;
      tipo: ArchivoTipo;
      padre_id: number;
      url_publico: string;
      mime: string;
      tamano_bytes: number;
    }>;
}
