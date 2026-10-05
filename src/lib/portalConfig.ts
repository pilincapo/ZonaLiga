// Configuración del portal y selección de lo que aparece en la portada.
//
// Son datos del portal, no del torneo: nombre, contacto, redes, pie de página y
// qué noticias/galerías van destacadas. Nada de esto toca la competencia: el
// fixture, las posiciones y los resultados siguen viniendo del panel deportivo.
//
// Reglas:
//   · Lo que se elige como destacado sólo se muestra si además está publicado.
//   · Guardar valida en el servidor (todo se valida acá, no en el HTML).

import type { D1Database } from '@cloudflare/workers-types';
import { obtenerNoticia, obtenerGaleria } from './portalContent.ts';

// ------------------------------ configuración ------------------------------

export interface PortalConfig {
  nombre: string;
  descripcion: string;
  whatsapp: string;
  telefono: string;
  facebook: string;
  instagram: string;
  youtube: string;
  twitter: string;
  pie: string;
  mostrar_hero: boolean;
  mostrar_fotos: boolean;
  status: 'draft' | 'published';
  config_id: number;
}

const CONFIG_POR_DEFECTO: Omit<PortalConfig, 'config_id'> = {
  nombre: 'ZonaLiga',
  descripcion: 'La liga amateur, con fixture, resultados, posiciones y fotos.',
  whatsapp: '',
  telefono: '',
  facebook: '',
  instagram: '',
  youtube: '',
  twitter: '',
  pie: '',
  mostrar_hero: true,
  mostrar_fotos: true,
  status: 'draft',
};

type Fila = Record<string, unknown>;

function filaConfig(fila: Fila | null): PortalConfig {
  if (!fila) return { ...CONFIG_POR_DEFECTO, config_id: 1 };
  return {
    config_id: Number(fila['config_id'] ?? 1),
    nombre: String(fila['nombre'] ?? CONFIG_POR_DEFECTO.nombre),
    descripcion: String(fila['descripcion'] ?? CONFIG_POR_DEFECTO.descripcion),
    whatsapp: String(fila['whatsapp'] ?? ''),
    telefono: String(fila['telefono'] ?? ''),
    facebook: String(fila['facebook'] ?? ''),
    instagram: String(fila['instagram'] ?? ''),
    youtube: String(fila['youtube'] ?? ''),
    twitter: String(fila['twitter'] ?? ''),
    pie: String(fila['pie'] ?? ''),
    mostrar_hero: Number(fila['mostrar_hero'] ?? 1) === 1,
    mostrar_fotos: Number(fila['mostrar_fotos'] ?? 1) === 1,
    status: fila['status'] === 'published' ? 'published' : 'draft',
  };
}

export async function leerConfig(db: D1Database): Promise<PortalConfig> {
  const fila = await db.prepare('SELECT * FROM portal_configuracion WHERE config_id = 1').first<Fila>();
  return filaConfig(fila);
}

/** Configuración pública: sólo la que está publicada. */
export async function leerConfigPublica(db: D1Database): Promise<PortalConfig | null> {
  const cfg = await leerConfig(db);
  return cfg.status === 'published' ? cfg : null;
}

// Validación de cada campo. Los enlaces de redes aceptan http(s); el teléfono y
// WhatsApp se guardan como texto para no romper números con espacios.
export interface Resultado<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

function texto(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

function enlaceOVacio(raw: unknown): Resultado<string> {
  const v = texto(raw, 300);
  if (v === '') return { ok: true, value: '' };
  if (!/^https:\/\/.+/i.test(v)) {
    return { ok: false, error: `El enlace "${v.slice(0, 40)}" tiene que empezar con https://` };
  }
  return { ok: true, value: v };
}

export function validarConfig(form: Record<string, unknown>): Resultado<PortalConfig> {
  const base = CONFIG_POR_DEFECTO;
  const nombre = texto(form['nombre'], 80);
  if (!nombre) return { ok: false, error: 'El portal necesita un nombre público.' };

  const redes: Array<[keyof PortalConfig, string]> = [
    ['facebook', 'Facebook'],
    ['instagram', 'Instagram'],
    ['youtube', 'YouTube'],
    ['twitter', 'X (Twitter)'],
  ];
  const valores: Record<string, string> = {};
  for (const [campo, etiqueta] of redes) {
    const r = enlaceOVacio(form[campo]);
    if (!r.ok) return { ok: false, error: r.error ?? `${etiqueta}: enlace inválido` };
    valores[campo] = r.value ?? '';
  }

  const status = form['status'] === 'published' ? 'published' : 'draft';
  return {
    ok: true,
    value: {
      ...base,
      config_id: 1,
      nombre,
      descripcion: texto(form['descripcion'], 300),
      whatsapp: texto(form['whatsapp'], 40),
      telefono: texto(form['telefono'], 40),
      facebook: valores['facebook'] ?? '',
      instagram: valores['instagram'] ?? '',
      youtube: valores['youtube'] ?? '',
      twitter: valores['twitter'] ?? '',
      pie: texto(form['pie'], 300),
      mostrar_hero: form['mostrar_hero'] === 'on' || form['mostrar_hero'] === '1',
      mostrar_fotos: form['mostrar_fotos'] === 'on' || form['mostrar_fotos'] === '1',
      status,
    },
  };
}

export async function guardarConfig(db: D1Database, cfg: PortalConfig): Promise<void> {
  await db
    .prepare(
      `INSERT INTO portal_configuracion
         (config_id, nombre, descripcion, whatsapp, telefono, facebook, instagram, youtube, twitter, pie, mostrar_hero, mostrar_fotos, status, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'))
       ON CONFLICT(config_id) DO UPDATE SET
         nombre = ?1, descripcion = ?2, whatsapp = ?3, telefono = ?4,
         facebook = ?5, instagram = ?6, youtube = ?7, twitter = ?8, pie = ?9,
         mostrar_hero = ?10, mostrar_fotos = ?11, status = ?12, updated_at = datetime('now')`
    )
    .bind(
      cfg.nombre,
      cfg.descripcion,
      cfg.whatsapp,
      cfg.telefono,
      cfg.facebook,
      cfg.instagram,
      cfg.youtube,
      cfg.twitter,
      cfg.pie,
      cfg.mostrar_hero ? 1 : 0,
      cfg.mostrar_fotos ? 1 : 0,
      cfg.status
    )
    .run();
}

// --------------------------------- portada ---------------------------------

export interface Portada {
  noticia_hero_id: number | null;
  noticias_destacadas: number[];
  galerias_destacadas: number[];
}

const VACIA: Portada = { noticia_hero_id: null, noticias_destacadas: [], galerias_destacadas: [] };

function ids(raw: unknown): number[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

export async function leerPortada(db: D1Database): Promise<Portada> {
  const fila = await db
    .prepare('SELECT noticia_hero_id, noticias_destacadas, galerias_destacadas FROM portal_portada WHERE portada_id = 1')
    .first<Fila>();
  if (!fila) return { ...VACIA };
  return {
    noticia_hero_id: fila['noticia_hero_id'] == null ? null : Number(fila['noticia_hero_id']),
    noticias_destacadas: ids(fila['noticias_destacadas']),
    galerias_destacadas: ids(fila['galerias_destacadas']),
  };
}

/**
 * Guarda la portada. Sólo se aceptan noticias y galerías que existen; si algo
 * dejó de existir en el meantime se ignora en lugar de romper la portada.
 */
export async function guardarPortada(db: D1Database, portada: Portada): Promise<Portada> {
  let hero: number | null = null;
  if (portada.noticia_hero_id != null) {
    const n = await obtenerNoticia(db, portada.noticia_hero_id);
    if (n) hero = n.id;
  }
  const noticias = await filtrarExistentes(
    portada.noticias_destacadas,
    async (id) => (await obtenerNoticia(db, id)) != null
  );
  const galerias = await filtrarExistentes(
    portada.galerias_destacadas,
    async (id) => (await obtenerGaleria(db, id)) != null
  );

  await db
    .prepare(
      `INSERT INTO portal_portada (portada_id, noticia_hero_id, noticias_destacadas, galerias_destacadas, updated_at)
       VALUES (1, ?1, ?2, ?3, datetime('now'))
       ON CONFLICT(portada_id) DO UPDATE SET
         noticia_hero_id = ?1, noticias_destacadas = ?2, galerias_destacadas = ?3, updated_at = datetime('now')`
    )
    .bind(hero, JSON.stringify(noticias), JSON.stringify(galerias))
    .run();

  return { noticia_hero_id: hero, noticias_destacadas: noticias, galerias_destacadas: galerias };
}

async function filtrarExistentes(candidatos: number[], existe: (id: number) => Promise<boolean>): Promise<number[]> {
  const out: number[] = [];
  for (const id of candidatos) {
    if (await existe(id)) out.push(id);
  }
  return out;
}

/** Lee una lista de ids marcados en un formulario de checkboxes. */
export function leerIds(form: Record<string, unknown>, campo: string): number[] {
  const raw = form[campo];
  const lista = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return lista
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}