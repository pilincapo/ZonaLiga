// Archivos del portal: subida, validación y persistencia en R2.
//
// El bucket es PRIVADO. La URL que se guarda y se muestra en el sitio es siempre
// `/i/{archivo_id}` (el Worker), que antes de entregar el archivo comprueba que el
// recurso padre esté publicado. Así un borrador no es accesible ni por URL directa.
//
// Las imágenes que ya están en internet no pasan por acá: siguen siendo URLs y
// se guardan en el campo de contenido de la noticia, la galería o la foto.

import type { R2Bucket } from '@cloudflare/workers-types';
import type { D1Database } from '@cloudflare/workers-types';
import { validarUrlImagen, type Resultado } from './portalContent.ts';

/**
 * Identificadores de padre que no son un id de contenido propio:
 * `portal_pages` usa el slug como clave y `portal_configuracion` tiene una sola
 * fila, así que se las identifica con una constante estable (ver migración 0014).
 */
export const PAGINA_COMPLEJO_ID = 1;
export const CONFIG_ID = 1;

// Imágenes permitidas: tipo MIME y extensión normalizada, ambas restringidas.
const MIMES_PERMITIDOS: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

/**
 * Tipos de archivo del portal. Cada tipo dice de qué tabla es padre:
 *   · noticia.imagen_principal → portal_noticias (una por noticia)
 *   · galeria.portada         → portal_galleries (una por galería)
 *   · galeria.foto            → portal_gallery_images (una por fila de foto)
 *   · complejo.imagen         → portal_pages, slug 'complejo' (PAGINA_COMPLEJO_ID)
 *   · config.hero / config.logo → portal_configuracion (CONFIG_ID)
 */
export type ArchivoTipo =
  | 'noticia.imagen_principal'
  | 'galeria.portada'
  | 'galeria.foto'
  | 'complejo.imagen'
  | 'config.hero'
  | 'config.logo';

/** Prefijo de las claves en R2, por tipo. */
const PREFIJOS: Readonly<Record<ArchivoTipo, string>> = {
  'noticia.imagen_principal': 'noticia/imagen',
  'galeria.portada': 'galeria/portada',
  'galeria.foto': 'galeria/foto',
  'complejo.imagen': 'complejo/imagen',
  'config.hero': 'config/hero',
  'config.logo': 'config/logo',
};

/** Todos los tipos aceptados: se usa para validar el parámetro de los endpoints. */
const ARCHIVO_TIPOS = Object.keys(PREFIJOS) as ArchivoTipo[];

export function esArchivoTipo(raw: unknown): raw is ArchivoTipo {
  return typeof raw === 'string' && (ARCHIVO_TIPOS as string[]).includes(raw);
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

/** URL pública de un archivo propio: siempre pasa por el Worker, que valida
 * que el recurso padre esté publicado. El bucket nunca se expone. */
export function urlArchivoPropio(archivoId: number): string {
  return `/i/${archivoId}`;
}

/** URL de una imagen subida: la que se muestra en el sitio. */
export function urlArchivo(archivo: Pick<Archivo, 'url_publico' | 'url_externo'> | null | undefined): string {
  return archivo ? archivo.url_externo || archivo.url_publico : '';
}

/**
 * ¿Está este archivo entre los públicos? La vista `portal_archivos_publicos`
 * ya exige que el padre esté publicado, así que es la única comprobación que
 * hace falta para servirlo.
 */
export async function archivoEsPublico(db: D1Database, archivoId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT archivo_id FROM portal_archivos_publicos WHERE archivo_id = ?1')
    .bind(archivoId)
    .first<{ archivo_id: number }>();
  return row != null;
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
  const encontrado = MAGIC.find((entrada) =>
    entrada.bytes.every((b, i) => bytes[i] === b)
  );
  if (!encontrado) {
    return { ok: false, error: 'El archivo no es una imagen reconocida (JPG, PNG, WebP, GIF).' };
  }
  // El MIME declarado tiene que ser uno de los permitidos; si no coincide con los
  // bytes, gana lo que dicen los bytes (no la extensión que mandó el navegador).
  if (mimeEsperado && !MIMES_PERMITIDOS.includes(mimeEsperado)) {
    return { ok: false, error: 'El archivo no es una imagen de los tipos permitidos.' };
  }
  return { ok: true, value: { mime: encontrado.mime, extension: encontrado.extension, tamano_bytes: tamano } };
}

/** Nombre seguro único por prefijo: uuid + extensión normalizada. */
export function nombreSeguro(tipo: ArchivoTipo, extension: string): string {
  const id = crypto.randomUUID().replace(/-/g, '');
  return `${PREFIJOS[tipo]}/${id}.${extension}`;
}

/* ------------------------- CRUD sobre portal_archivos ------------------------- */

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

/** Borra el registro y su objeto en R2 (si hay). */
export async function eliminarArchivo(db: D1Database, r2: R2Bucket | null, archivo_id: number): Promise<boolean> {
  const archivo = await obtenerArchivoPorId(db, archivo_id);
  if (!archivo) return false;
  if (archivo.key_r2 && r2) {
    try { await r2.delete(archivo.key_r2); } catch { /* mejor esfuerzo */ }
  }
  await db.prepare('DELETE FROM portal_archivos WHERE archivo_id = ?1').bind(archivo_id).run();
  return true;
}

/** Quita el archivo de un tipo/padre (imagen principal, portada, hero, logo). */
export async function eliminarArchivoPorTipoYPadre(
  db: D1Database,
  r2: R2Bucket | null,
  tipo: ArchivoTipo,
  padre_id: number,
): Promise<boolean> {
  const archivo = await obtenerArchivoPorPadreYTipo(db, tipo, padre_id);
  if (!archivo) return false;
  return eliminarArchivo(db, r2, archivo.archivo_id);
}

/**
 * Sube un archivo a R2 y deja su registro en D1. Si ese tipo y padre ya tenían
 * una imagen, se borra la anterior (registro y objeto): hay un índice único por
 * (tipo, padre) justamente para que nunca queden dos.
 *
 * La `url_publico` que se guarda es la ruta del Worker (`/i/{id}`), no la
 * dirección del bucket: así el bucket puede ser privado y nadie accede a una
 * imagen de borrador saltándose la comprobación de publicación.
 */
export async function subirArchivo(
  db: D1Database,
  r2: R2Bucket,
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
  await r2.put(nombre, buffer, {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  });
  // Primero se libera el lugar del índice único, después se inserta el nuevo.
  await eliminarArchivoPorTipoYPadre(db, r2, tipo, padreId);
  const creado = await crearArchivo(db, {
    tipo,
    padre_id: padreId,
    nombre_seguridad: nombre,
    extension,
    mime,
    tamano_bytes,
    url_publico: '',
    key_r2: nombre,
    es_publico: esPublico ?? 1,
  });
  return creado;
}

/**
 * Inserta el registro y completa la URL pública: el id sólo existe después del
 * INSERT, así que `/i/{id}` se escribe en un segundo paso (y recién ahí pasa a
 * `es_publico`, para que nunca quede visible una URL a medio construir).
 */
async function crearArchivo(
  db: D1Database,
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
  const r = await db
    .prepare(
      `INSERT INTO portal_archivos (tipo, padre_id, nombre_seguridad, extension, mime, tamano_bytes, url_externo, key_r2, url_publico, es_publico)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
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
    )
    .first();
  if (!r) throw new Error('No se pudo guardar el archivo.');
  const id = Number(r.archivo_id);
  const url = urlArchivoPropio(id);
  await db
    .prepare('UPDATE portal_archivos SET url_publico = ?1, es_publico = ?2 WHERE archivo_id = ?3')
    .bind(url, input.es_publico ?? 1, id)
    .run();
  return { ...(r as unknown as Archivo), url_publico: url, es_publico: input.es_publico ?? 1 };
}

/* --------------------- subida desde el panel (común) --------------------- */

/** Lo que devuelve una carga de imagen: qué quedó puesto y qué se le dice al usuario. */
export interface ResultadoImagen {
  /** URL que hay que guardar en el contenido (o en el mismo archivo, si ya era un enlace). */
  url: string;
  /** Mensaje para la pantalla. */
  mensaje: string;
  /** Si algo salió mal, el mensaje va como error y el contenido queda como estaba. */
  error?: boolean;
  /** El archivo de R2 resultante, si la imagen se subió (no si es un enlace). */
  archivo?: Archivo;
}

export interface OpcionesCargaImagen {
  tipo: ArchivoTipo;
  padreId: number;
  /** Campo `archivo` del formulario multipart (puede no venir). */
  archivo: unknown;
  /** Campo del enlace externo (puede no venir). */
  url: string;
  /** Lo que hay hoy en el contenido, para no perderlo si no se envió nada nuevo. */
  urlActual: string;
  /** Si el recurso está publicado (define si el archivo se sirve al público). */
  esPublico: boolean;
  /** ¿Hay bucket configurado en este entorno? */
  bucket: R2Bucket | null;
}

/**
 * Resuelve una carga de imagen de los formularios del panel. Acepta las tres
 * cosas que puede hacer la persona: subir un archivo, pegar un enlace de
 * internet, o quitar la imagen. Nunca tira excepciones: devuelve el mensaje
 * para mostrar y, si algo falla, deja el contenido como estaba.
 */
export async function cargarImagen(db: D1Database, opts: OpcionesCargaImagen): Promise<ResultadoImagen> {
  const esPublico: 0 | 1 = opts.esPublico ? 1 : 0;

  // 1) Quitar la imagen.
  if (opts.archivo === 'quitar') {
    await eliminarArchivoPorTipoYPadre(db, opts.bucket, opts.tipo, opts.padreId);
    return { url: '', mensaje: 'Imagen quitada' };
  }

  // 2) Archivo del dispositivo → R2.
  if (opts.archivo instanceof File && opts.archivo.size > 0) {
    if (!opts.bucket) {
      return {
        url: opts.urlActual,
        mensaje: 'Las imágenes subidas todavía no están disponibles en este sitio. Usá un enlace externo por mientras.',
        error: true,
      };
    }
    try {
      const buffer = await opts.archivo.arrayBuffer();
      const archivo = await subirArchivo(
        db,
        opts.bucket,
        opts.tipo,
        opts.padreId,
        buffer,
        opts.archivo.type || undefined,
        esPublico
      );
      return { url: archivo.url_publico, mensaje: 'Imagen cargada', archivo };
    } catch (e) {
      console.error('No se pudo subir la imagen:', e);
      return {
        url: opts.urlActual,
        mensaje: e instanceof Error ? e.message : 'No se pudo subir la imagen',
        error: true,
      };
    }
  }

  // 3) Enlace externo: se guarda la URL y se borra el archivo propio anterior.
  if (opts.url.trim() !== '') {
    const v = validarUrlImagen(opts.url);
    if (!v.ok) return { url: opts.urlActual, mensaje: v.error, error: true };
    await eliminarArchivoPorTipoYPadre(db, opts.bucket, opts.tipo, opts.padreId);
    return { url: v.value, mensaje: 'Imagen actualizada con el enlace externo' };
  }

  return { url: opts.urlActual, mensaje: 'No se recibió una imagen nueva' };
}