// Fase 18.3, parte 2: Destacados, Configuración, resumen del portal, subida
// de imágenes en galería y complejo, y los bloques de la portada pública.
//
// SQLite en memoria con las MIGRACIONES REALES envuelto como D1 (igual que
// portalArchivos.test.ts), para probar el SQL de verdad, y un R2 falso.

import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import type { Env } from '../src/types.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { portalAdminRoutes } from '../src/routes/portalAdmin.ts';
import { portalImagenesRoutes } from '../src/routes/portalImagenes.ts';
import { createSessionToken, sessionCookieHeader } from '../src/lib/auth.ts';
import { agregarImagen, crearGaleria, crearNoticia, guardarPagina, listarImagenes, type ComplejoData } from '../src/lib/portalContent.ts';
import { guardarConfig, guardarPortada, leerConfig, leerPortada, validarConfig, type PortalConfig } from '../src/lib/portalConfig.ts';
import { resumenPortal } from '../src/lib/portalResumen.ts';
import { datosPortada } from '../src/lib/portalPortada.ts';
import { bloqueComplejo, bloqueFotos, bloqueInformacion, bloqueNoticias, bloquesPortada, heroPortada } from '../src/ui/portalPortada.ts';
import { dashboardPage } from '../src/ui/portalDashboard.ts';
import { PORTAL_PERMISSIONS } from '../src/lib/portalAccess.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'secret-test-portada';

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  return db;
}

function d1(db: DatabaseSync): D1Database {
  const stmt = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind(...a: unknown[]) {
        args = a;
        return s;
      },
      async first<T>() {
        return (db.prepare(sql).get(...(args as never[])) ?? null) as T | null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...(args as never[])) as T[], success: true, meta: {} };
      },
      async run() {
        const r = db.prepare(sql).run(...(args as never[]));
        return { success: true, results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return s;
  };
  return {
    prepare: stmt,
    batch: async (stmts: D1PreparedStatement[]) => {
      const out = [];
      for (const s of stmts) out.push(await (s as unknown as { run: () => Promise<unknown> }).run());
      return out;
    },
  } as unknown as D1Database;
}

function r2Falso() {
  const objetos = new Map<string, Uint8Array>();
  return {
    objetos,
    put: async (key: string, value: ArrayBuffer | Uint8Array) => {
      objetos.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    get: async (key: string) => {
      const bytes = objetos.get(key);
      if (!bytes) return null;
      return { body: new Blob([bytes]).stream(), httpMetadata: { contentType: 'image/png' } };
    },
    delete: async (key: string) => {
      objetos.delete(key);
    },
  };
}

function bytesPng(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
}

let sqlite: DatabaseSync;
let db: D1Database;

/** Cada grupo de tests arranca con una base limpia: los conteos se comparan exactos. */
function reiniciar(): void {
  sqlite = crearBase();
  db = d1(sqlite);
  nUsuario = 0;
}

beforeAll(reiniciar);

function env(bucket?: R2Bucket): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    ADMIN_PASSWORD: SECRET,
    ...(bucket ? { R2_PUBLIC_BUCKET: bucket } : {}),
  } as unknown as Env;
}

function app(e: Env) {
  const a = new Hono<{ Bindings: Env }>();
  a.route('/admin', adminRoutes);
  a.route('/portal-admin', portalAdminRoutes);
  a.route('/i', portalImagenesRoutes);
  return a;
}

let nUsuario = 0;

async function usuarioYCookie(permisos: string[]): Promise<string> {
  nUsuario += 1;
  const r = sqlite
    .prepare("INSERT INTO admin_users (username, name, password_hash, role, active) VALUES (?1, 'U', 'x', 'COMMUNITY_MANAGER', 1)")
    .run(`p${nUsuario}`);
  const id = Number(r.lastInsertRowid);
  for (const p of permisos) {
    sqlite.prepare('INSERT INTO admin_user_permissions (user_id, permission) VALUES (?1, ?2)').run(id, p);
  }
  const token = await createSessionToken(SECRET, 'COMMUNITY_MANAGER', id);
  return sessionCookieHeader(token).split(';')[0]!;
}

/** Formulario multipart. Un array de valores se manda como campos repetidos
 * (que es como llegan los checkboxes de varias opciones). */
function form(body: Record<string, string | string[] | File>, cookie?: string): RequestInit {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return { method: 'POST', headers: cookie ? { cookie } : {}, body: fd };
}

/* ============================== Destacados ============================== */

describe('/portal-admin/destacados', () => {
  beforeEach(reiniciar);

  it('guarda la noticia principal y las listas de destacadas', async () => {
    const a = app(env());
    const cookie = await usuarioYCookie(['PORTAL_DESTACADOS']);
    const n1 = await crearNoticia(db, { titulo: 'A', resumen: '', contenido: '', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    const n2 = await crearNoticia(db, { titulo: 'B', resumen: '', contenido: '', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    const g1 = await crearGaleria(db, { titulo: 'G', descripcion: '', portada: '', fecha: null, status: 'published' });

    const res = await a.request(
      '/portal-admin/destacados',
      form({ noticia_hero_id: String(n1), destacadas: [String(n1), String(n2)], galerias: String(g1) }, cookie),
      env()
    );
    expect(res.status).toBe(302);

    const portada = await leerPortada(db);
    expect(portada.noticia_hero_id).toBe(n1);
    expect(portada.noticias_destacadas).toEqual([n1, n2]);
    expect(portada.galerias_destacadas).toEqual([g1]);
  });

  it('descarta los destacados que ya no existen y lo avisa', async () => {
    const a = app(env());
    const cookie = await usuarioYCookie(['PORTAL_DESTACADOS']);
    const res = await a.request(
      '/portal-admin/destacados',
      form({ noticia_hero_id: '', destacadas: '999999', galerias: '' }, cookie),
      env()
    );
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('descartaron');
    expect((await leerPortada(db)).noticias_destacadas).toEqual([]);
  });

  it('sin permiso responde 403 y con permiso muestra el formulario', async () => {
    const a = app(env());
    const sinPermiso = await usuarioYCookie(['PORTAL_NOTICIAS']);
    expect((await a.request('/portal-admin/destacados', { headers: { cookie: sinPermiso } }, env())).status).toBe(403);

    const conPermiso = await usuarioYCookie(['PORTAL_DESTACADOS']);
    const res = await a.request('/portal-admin/destacados', { headers: { cookie: conPermiso } }, env());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Guardar destacados');
  });
});

/* ============================ Configuración ============================ */

describe('/portal-admin/configuracion', () => {
  beforeEach(reiniciar);

  it('valida en el servidor y guarda como publicada', async () => {
    const a = app(env());
    const cookie = await usuarioYCookie(['PORTAL_CONFIGURACION']);

    const mala = await a.request(
      '/portal-admin/configuracion',
      form({ nombre: '', facebook: 'http://no-https.com/x' }, cookie),
      env()
    );
    expect(mala.status).toBe(400);
    expect(await mala.text()).toContain('https://');

    const buena = await a.request(
      '/portal-admin/configuracion',
      form({
        nombre: 'Liga del Barrio',
        descripcion: 'La liga de todos los sábados',
        whatsapp: '5491112345678',
        telefono: '',
        facebook: 'https://facebook.com/liga',
        instagram: '',
        youtube: '',
        twitter: '',
        pie: 'Barrio Norte',
        mostrar_hero: 'on',
        mostrar_fotos: 'on',
        status: 'published',
      }, cookie),
      env()
    );
    expect(buena.status).toBe(302);
    const cfg = await leerConfig(db);
    expect(cfg.nombre).toBe('Liga del Barrio');
    expect(cfg.status).toBe('published');
    expect(cfg.mostrar_fotos).toBe(true);
  });

  it('validarConfig acepta vacíos y rechaza enlaces que no son https', () => {
    const ok = validarConfig({ nombre: 'ZonaLiga', status: 'draft' });
    expect(ok.ok).toBe(true);
    const mal = validarConfig({ nombre: 'ZonaLiga', instagram: 'ftp://x.com' });
    expect(mal.ok).toBe(false);
  });

  it('sube la imagen principal del portal y la publica como /i/{id}', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_CONFIGURACION']);
    await guardarConfig(db, { ...(await leerConfig(db)), status: 'published' });

    const res = await a.request(
      '/portal-admin/configuracion/imagen?tipo=config.hero',
      form({ 'config.hero__url_externo': '', archivo: new File([bytesPng()], 'hero.png', { type: 'image/png' }) }, cookie),
      e
    );
    expect(res.status).toBe(302);

    const fila = sqlite.prepare('SELECT * FROM portal_archivos WHERE tipo = ?1').get('config.hero') as { url_publico: string; key_r2: string };
    expect(fila.url_publico).toMatch(/^\/i\/\d+$/);
    expect(bucket.objetos.has(fila.key_r2)).toBe(true);
    // Como la configuración está publicada, el público la puede ver.
    expect((await a.request(fila.url_publico, {}, e)).status).toBe(200);
  });

  it('un tipo de imagen fuera de la lista blanca se rechaza', async () => {
    const e = env();
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_CONFIGURACION']);
    const res = await a.request('/portal-admin/configuracion/imagen?tipo=sql', form({ archivo: '' }, cookie), e);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('err=');
  });
});

/* ============================== Resumen ============================== */

describe('resumen del portal', () => {
  beforeEach(reiniciar);

  it('cuenta publicaciones, destacados, archivos y estado de la configuración', async () => {
    const a = app(env());
    const cookie = await usuarioYCookie(['PORTAL_CONFIGURACION']);
    await a.request(
      '/portal-admin/configuracion',
      form({ nombre: 'ZonaLiga', status: 'published', mostrar_hero: 'on' }, cookie),
      env()
    );

    const n1 = await crearNoticia(db, { titulo: 'Pub', resumen: '', contenido: '', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    await crearNoticia(db, { titulo: 'Borr', resumen: '', contenido: '', imagen: '', autor: '', published_at: null, destacada: false, status: 'draft' });
    const g1 = await crearGaleria(db, { titulo: 'G', descripcion: '', portada: '', fecha: null, status: 'published' });
    await guardarPortada(db, { noticia_hero_id: n1, noticias_destacadas: [n1], galerias_destacadas: [g1] });

    const r = await resumenPortal(db);
    expect(r.noticias).toEqual({ total: 2, publicadas: 1, borradores: 1 });
    expect(r.galerias.publicadas).toBe(1);
    expect(r.portada).toEqual({ hero: n1, noticias: 1, galerias: 1 });
    expect(r.config.publicada).toBe(true);
  });

  it('el dashboard muestra los números y los accesos a cada sección', () => {
    const html = dashboardPage({
      permisos: new Set(PORTAL_PERMISSIONS),
      resumen: {
        noticias: { total: 3, publicadas: 2, borradores: 1 },
        galerias: { total: 1, publicadas: 1, borradores: 0, fotos: 12 },
        portada: { hero: 5, noticias: 2, galerias: 1 },
        config: { nombre: 'Liga del Barrio', publicada: false },
        archivos: 4,
      },
      hero: { id: 5, titulo: 'Abrió la temporada', publicada: false },
      config: leerConfigSync(),
    });
    expect(html).toContain('Noticias publicadas');
    expect(html).toContain('1 en borrador');
    expect(html).toContain('Abrió la temporada');
    expect(html).toContain('Borrador');
    expect(html).toContain('La configuración del portal está en borrador');
    expect(html).toContain('href="/portal-admin/destacados"');
  });

  it('el resumen de una base vacía no rompe', async () => {
    const r = await resumenPortal(db);
    expect(r.archivos).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.noticias.total)).toBe(true);
  });
});

/** Config por defecto para armar la vista del dashboard sin tocar la base. */
function leerConfigSync(): PortalConfig {
  return {
    nombre: 'ZonaLiga',
    descripcion: '',
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
    config_id: 1,
  } satisfies PortalConfig;
}

/* ================= Subida de imágenes: galería y complejo ================= */

describe('imágenes en galería y complejo', () => {
  beforeEach(reiniciar);

  it('sube una foto de galería y la guarda en R2 y en la galería', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS']);
    const g = await crearGaleria(db, { titulo: 'Fecha 3', descripcion: '', portada: '', fecha: null, status: 'published' });

    const res = await a.request(
      `/portal-admin/fotos/${g}/imagenes`,
      form({ caption: 'Gol del segundo', archivo: new File([bytesPng()], 'f.png', { type: 'image/png' }) }, cookie),
      e
    );
    expect(res.status).toBe(302);

    const imagenes = await listarImagenes(db, g);
    expect(imagenes).toHaveLength(1);
    expect(imagenes[0]!.url).toMatch(/^\/i\/\d+$/);
    expect(imagenes[0]!.archivo_id).toBeTypeOf('number');
    expect(bucket.objetos.size).toBe(1);
    expect((await a.request(imagenes[0]!.url, {}, e)).status).toBe(200);
  });

  it('un archivo que no es imagen no deja la foto a medio crear', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS']);
    const g = await crearGaleria(db, { titulo: 'Fecha 4', descripcion: '', portada: '', fecha: null, status: 'published' });

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'x.pdf', { type: 'image/png' });
    const res = await a.request(`/portal-admin/fotos/${g}/imagenes`, form({ archivo: pdf }, cookie), e);
    expect(res.status).toBe(302);
    expect(await listarImagenes(db, g)).toHaveLength(0);
    expect(bucket.objetos.size).toBe(0);
  });

  it('quitar una foto borra también el archivo de R2', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS']);
    const g = await crearGaleria(db, { titulo: 'Fecha 5', descripcion: '', portada: '', fecha: null, status: 'published' });
    await a.request(
      `/portal-admin/fotos/${g}/imagenes`,
      form({ archivo: new File([bytesPng()], 'f.png', { type: 'image/png' }) }, cookie),
      e
    );
    const [img] = await listarImagenes(db, g);
    expect(bucket.objetos.size).toBe(1);

    await a.request(`/portal-admin/fotos/${g}/imagenes/${img!.id}/eliminar`, { method: 'POST', headers: { cookie } }, e);
    expect(await listarImagenes(db, g)).toHaveLength(0);
    expect(bucket.objetos.size).toBe(0);
  });

  it('sube la portada de la galería y la del complejo', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS', 'PORTAL_COMPLEJO']);
    const g = await crearGaleria(db, { titulo: 'Fecha 6', descripcion: '', portada: '', fecha: null, status: 'published' });
    await guardarPagina(db, 'complejo', {
      nombre: 'Complejo Norte',
      descripcion: '',
      direccion: '',
      telefono: '',
      whatsapp: '',
      horarios: '',
      como_llegar: '',
      info_util: '',
      imagen: '',
      instalaciones: [],
    }, 'published');

    const portada = await a.request(
      `/portal-admin/fotos/${g}/portada`,
      form({ 'galeria.portada__url_externo': '', archivo: new File([bytesPng()], 'p.png', { type: 'image/png' }) }, cookie),
      e
    );
    expect(portada.status).toBe(302);
    const g2 = sqlite.prepare('SELECT portada FROM portal_galleries WHERE id = ?1').get(g) as { portada: string };
    expect(g2.portada).toMatch(/^\/i\/\d+$/);

    const complejo = await a.request(
      '/portal-admin/complejo/imagen',
      form({ 'complejo.imagen__url_externo': '', archivo: new File([bytesPng()], 'c.png', { type: 'image/png' }) }, cookie),
      e
    );
    expect(complejo.status).toBe(302);
    const pag = sqlite.prepare("SELECT data FROM portal_pages WHERE slug = 'complejo'").get() as { data: string };
    expect(JSON.parse(pag.data).imagen).toMatch(/^\/i\/\d+$/);
  });

  it('guardar el texto del complejo no borra la imagen subida', async () => {
    const e = env();
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_COMPLEJO']);
    await guardarPagina(db, 'complejo', {
      nombre: 'Complejo Norte',
      descripcion: 'Canchas y vestuarios',
      direccion: 'Av. Norte 742',
      telefono: '',
      whatsapp: '',
      horarios: '',
      como_llegar: '',
      info_util: '',
      imagen: '/i/77',
      instalaciones: [],
    }, 'published');

    await a.request('/portal-admin/complejo', form({ nombre: 'Complejo Norte', descripcion: 'Canchas y vestuarios', direccion: 'Av. Norte 742', status: 'published' }, cookie), e);
    const pag = sqlite.prepare("SELECT data FROM portal_pages WHERE slug = 'complejo'").get() as { data: string };
    expect(JSON.parse(pag.data).imagen).toBe('/i/77');
  });

  it('subir dos veces la misma imagen reemplaza la anterior (un solo archivo)', async () => {
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS']);
    const g = await crearGaleria(db, { titulo: 'Fecha 7', descripcion: '', portada: '', fecha: null, status: 'published' });

    await a.request(`/portal-admin/fotos/${g}/portada`, form({ 'galeria.portada__url_externo': '', archivo: new File([bytesPng()], '1.png', { type: 'image/png' }) }, cookie), e);
    const primera = sqlite.prepare('SELECT key_r2 FROM portal_archivos').get() as { key_r2: string };
    await a.request(`/portal-admin/fotos/${g}/portada`, form({ 'galeria.portada__url_externo': '', archivo: new File([bytesPng()], '2.png', { type: 'image/png' }) }, cookie), e);

    expect(sqlite.prepare('SELECT COUNT(*) n FROM portal_archivos').get()).toMatchObject({ n: 1 });
    expect(bucket.objetos.has(primera.key_r2)).toBe(false);
    expect(bucket.objetos.size).toBe(1);
  });
});

/* ============================ Portada pública ============================ */

describe('datos y bloques de la portada pública', () => {
  beforeEach(reiniciar);

  it('sólo toma lo publicado: un borrador nunca llega a la portada', async () => {
    const publicada = await crearNoticia(db, { titulo: 'Sí sale', resumen: 'Resumen', contenido: '', imagen: '', autor: '', published_at: '2026-10-01', destacada: false, status: 'published' });
    const borrador = await crearNoticia(db, { titulo: 'No sale', resumen: '', contenido: '', imagen: '', autor: '', published_at: null, destacada: false, status: 'draft' });
    const gPub = await crearGaleria(db, { titulo: 'Galería publicada', descripcion: '', portada: 'https://cdn.x/1.jpg', fecha: null, status: 'published' });
    await guardarPortada(db, { noticia_hero_id: borrador, noticias_destacadas: [borrador, publicada], galerias_destacadas: [gPub] });

    const d = await datosPortada(db);
    // El hero es borrador: no se usa.
    expect(d.hero).toBeNull();
    // De las destacadas sólo entra la publicada.
    expect(d.noticias.map((n) => n.id)).toEqual([publicada]);
    expect(d.galerias.map((g) => g.id)).toEqual([gPub]);
  });

  it('sin nada destacado muestra las últimas noticias publicadas', async () => {
    await crearNoticia(db, { titulo: 'Última', resumen: '', contenido: '', imagen: '', autor: '', published_at: '2026-10-02', destacada: false, status: 'published' });
    const d = await datosPortada(db);
    expect(d.noticias.length).toBeGreaterThan(0);
    expect(d.noticias.every((n) => n.status === 'published')).toBe(true);
    expect(d.hero).toBeNull();
  });

  it('el hero usa la imagen del complejo y la identidad configurada', () => {
    const html = heroPortada(
      {
        config: { ...leerConfigSync(), nombre: 'Liga Norte', descripcion: 'La liga del barrio' },
        identidad: { hero: '', logo: '' },
        hero: null,
        noticias: [],
        galerias: [],
        fotos: [],
        complejo: { ...(leerComplejoSync()), imagen: 'https://cdn.x/complejo.jpg' },
        torneo: null,
      },
      null
    );
    expect(html).toContain("url('https://cdn.x/complejo.jpg')");
    expect(html).toContain('Liga Norte');
    expect(html).toContain('La liga del barrio');
    expect(html).toContain('ph-hero--foto');
  });

  it('la imagen principal del portal manda sobre la foto del complejo', async () => {
    await guardarConfig(db, { ...(await leerConfig(db)), mostrar_hero: true, status: 'published' });
    await guardarPagina(db, 'complejo', { ...leerComplejoSync(), imagen: 'https://cdn.x/complejo.jpg' }, 'published');
    const bucket = r2Falso();
    const e = env(bucket as unknown as R2Bucket);
    const a = app(e);
    const cookie = await usuarioYCookie(['PORTAL_CONFIGURACION']);
    await a.request(
      '/portal-admin/configuracion/imagen?tipo=config.hero',
      form({ 'config.hero__url_externo': '', archivo: new File([bytesPng()], 'hero.png', { type: 'image/png' }) }, cookie),
      e
    );

    const d = await datosPortada(db);
    expect(d.identidad.hero).toMatch(/^\/i\/\d+$/);
    const html = heroPortada(d, null);
    expect(html).toContain(d.identidad.hero);
    expect(html).not.toContain('complejo.jpg');
  });

it('si se desactiva la imagen principal, vuelve la foto del complejo', async () => {
    await guardarConfig(db, { ...(await leerConfig(db)), mostrar_hero: false, status: 'published' });
    await guardarPagina(db, 'complejo', { ...leerComplejoSync(), imagen: 'https://cdn.x/complejo.jpg' }, 'published');
    const d = await datosPortada(db);
    expect(d.identidad.hero).toBe('');
    expect(heroPortada(d, null)).toContain('complejo.jpg');
  });

it('los bloques no se muestran vacíos ni con texto de relleno', () => {
    const vacio = {
      config: null,
      identidad: { hero: '', logo: '' },
      hero: null,
      noticias: [],
      galerias: [],
      fotos: [],
      complejo: null,
      torneo: null,
    };
    expect(bloqueNoticias(vacio)).toBe('');
    expect(bloqueFotos(vacio)).toBe('');
    expect(bloqueComplejo(vacio)).toBe('');
    expect(bloqueInformacion(vacio)).toBe('');
  });

  it('la portada no repite el bloque de noticias (homePage lo renderiza aparte)', () => {
    const noticia = {
      id: 1,
      titulo: 'Arrancó la Copa',
      resumen: 'Primera fecha jugada.',
      contenido: 'Texto.',
      imagen: '',
      status: 'published' as const,
      destacada: false,
      published_at: '2026-10-02',
      autor: 'Prensa',
      created_at: '2026-10-02',
      updated_at: '2026-10-02',
    };
    const datos = {
      config: null,
      identidad: { hero: '', logo: '' },
      hero: noticia,
      noticias: [noticia],
      galerias: [],
      fotos: [],
      complejo: null,
      torneo: null,
    };
    // bloquesPortada ya NO incluye el bloque de noticias: si lo incluyera,
    // la portada renderizaría la sección "Noticias" dos veces.
    expect(bloquesPortada(datos, null)).not.toContain('<h2>Noticias</h2>');
    // El bloque se sigue renderizando una vez desde homePage.
    const portada = `${bloqueNoticias(datos)}${bloquesPortada(datos, null)}`;
    expect(portada.split('<h2>Noticias</h2>').length - 1).toBe(1);
  });

  it('si se desactiva "mostrar fotos", la portada no las muestra', async () => {
    const g = await crearGaleria(db, { titulo: 'Fecha 8', descripcion: '', portada: '', fecha: null, status: 'published' });
    await agregarImagen(db, g, 'https://cdn.x/foto.jpg', '');
    await guardarConfig(db, { ...(await leerConfig(db)), mostrar_fotos: false, status: 'published' });

    const d = await datosPortada(db);
    expect(d.fotos.length).toBeGreaterThan(0);
    expect(bloqueFotos(d)).toBe('');
  });

  it('el bloque del complejo arma el enlace de WhatsApp con los números', () => {
    const html = bloqueComplejo({
      config: null,
      identidad: { hero: '', logo: '' },
      hero: null,
      noticias: [],
      galerias: [],
      fotos: [],
      complejo: { ...(leerComplejoSync()), nombre: 'Complejo Norte', whatsapp: '549 11 1234-5678', direccion: 'Av. Norte 742' },
      torneo: null,
    });
    expect(html).toContain('https://wa.me/5491112345678');
    expect(html).toContain('Av. Norte 742');
  });
});

/** Complejo vacío para armar las vistas sin tocar la base. */
function leerComplejoSync(): ComplejoData {
  return {
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
}