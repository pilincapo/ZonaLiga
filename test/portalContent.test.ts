// Contenido del portal (Fase 18.2): validación, persistencia y permisos.
//
// Usa SQLite en memoria con las MIGRACIONES REALES (mismo truco que
// d1-audit.test.ts) envuelto como D1: así se prueba el SQL de verdad,
// incluida la regla de que solo lo publicado se ve en el sitio público.

import { describe, expect, it, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import type { Env } from '../src/types.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { portalAdminRoutes } from '../src/routes/portalAdmin.ts';
import { createSessionToken, sessionCookieHeader } from '../src/lib/auth.ts';
import {
  agregarImagen,
  alternarDestacada,
  cambiarEstadoGaleria,
  cambiarEstadoNoticia,
  crearGaleria,
  crearNoticia,
  eliminarNoticia,
  guardarPagina,
  leerComplejoForm,
  leerTorneoForm,
  listarGaleriasPublicadas,
  listarImagenes,
  listarNoticias,
  listarNoticiasPublicadas,
  moverImagen,
  obtenerGaleriaPublica,
  obtenerNoticia,
  obtenerNoticiaPublica,
  obtenerPagina,
  obtenerPaginaPublica,
  parrafos,
  validarGaleria,
  validarImagenGaleria,
  validarNoticia,
  validarUrlImagen,
} from '../src/lib/portalContent.ts';
import { completarGaleriasPublicas } from '../src/lib/portalGalerias.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- SQLite real con las migraciones del proyecto ---------- */

function crearBase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  }
  return db;
}

/** Adapter mínimo SQLite → D1 (prepara/bindea/ejecuta) para las rutas. */
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

const SECRET = 'secret-test-portal';
let sqlite: DatabaseSync;
let db: D1Database;

beforeAll(() => {
  sqlite = crearBase();
  db = d1(sqlite);
});

/* ============================ Validación ============================ */

describe('validación de contenido del portal', () => {
  it('la noticia exige título y acepta campos vacíos opcionales', () => {
    const malo = validarNoticia({ titulo: '   ' });
    expect(malo.ok).toBe(false);
    const ok = validarNoticia({ titulo: 'Arranca la fecha 7' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.status).toBe('draft');
      expect(ok.value.destacada).toBe(false);
      expect(ok.value.published_at).toBeNull();
    }
  });

  it('la imagen tiene que ser http/https: data: y javascript: se rechazan', () => {
    expect(validarUrlImagen('').ok).toBe(true);
    expect(validarUrlImagen('https://cdn.ejemplo.com/foto.jpg').ok).toBe(true);
    expect(validarUrlImagen('http://cdn.ejemplo.com/foto.jpg').ok).toBe(true);
    expect(validarUrlImagen('javascript:alert(1)').ok).toBe(false);
    expect(validarUrlImagen('data:text/html,<b>').ok).toBe(false);
    expect(validarUrlImagen('no-es-una-url').ok).toBe(false);
  });

  it('la fecha usa formato AAAA-MM-DD y el estado solo draft/published', () => {
    const ok = validarNoticia({ titulo: 'x', published_at: '2026-10-03', status: 'published' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toMatchObject({ published_at: '2026-10-03', status: 'published' });
    const fechaMala = validarNoticia({ titulo: 'x', published_at: 'mañana' });
    expect(fechaMala.ok).toBe(false);
    const estadoRaro = validarNoticia({ titulo: 'x', status: 'borrado_secreto' });
    expect(estadoRaro.ok && estadoRaro.value.status).toBe('draft');
  });

  it('la galería y su imagen validan igual (título y URL)', () => {
    expect(validarGaleria({ titulo: '' }).ok).toBe(false);
    expect(validarGaleria({ titulo: 'Fecha 6', portada: 'ftp://x' }).ok).toBe(false);
    expect(validarImagenGaleria({}).ok).toBe(false);
    expect(validarImagenGaleria({ url: 'https://x/f.jpg', caption: 'Gol' }).ok).toBe(true);
  });

  it('el contenido se escapa al renderizar: nunca entra HTML del autor', () => {
    const html = parrafos('Hola <script>alert(1)</script>\n\nSegundo párrafo');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<p>');
    expect(html.match(/<p>/g)?.length).toBe(2);
  });

  it('los formularios de páginas leen filas repetibles (instalaciones y documentos)', () => {
    const complejo = leerComplejoForm({
      nombre: 'Complejo Norte',
      inst_nombre: ['Cancha 5', '  ', 'Vestuarios'],
      inst_detalle: ['Sintética', 'x', 'Con duchas'],
    });
    expect(complejo.instalaciones).toHaveLength(2);
    expect(complejo.instalaciones[0]).toEqual({ nombre: 'Cancha 5', detalle: 'Sintética' });

    const torneo = leerTorneoForm({
      presentacion: 'Bienvenidos',
      doc_titulo: ['Reglamento 2026'],
      doc_url: ['https://docs.ejemplo.com/reglamento.pdf'],
    });
    expect(torneo.documentos).toHaveLength(1);
    expect(torneo.documentos[0]!.url).toContain('https://');
  });
});

/* ==================== Persistencia y publicación ==================== */

describe('persistencia: solo lo publicado se ve en el sitio', () => {
  it('la noticia borrador no aparece en el listado público ni en su URL', async () => {
    const id = await crearNoticia(db, {
      titulo: 'Noticia borrador',
      resumen: 'Nadie debe ver esto',
      contenido: 'Texto privado',
      imagen: '',
      autor: 'Comunicación',
      published_at: null,
      destacada: false,
      status: 'draft',
    });
    expect(id).toBeGreaterThan(0);

    const publicas = await listarNoticiasPublicadas(db);
    expect(publicas.find((n) => n.id === id)).toBeUndefined();
    expect(await obtenerNoticiaPublica(db, id)).toBeNull();
    // En el panel sí está.
    expect((await listarNoticias(db)).find((n) => n.id === id)).toBeTruthy();
    expect((await obtenerNoticia(db, id))?.titulo).toBe('Noticia borrador');

    // Al publicarla, pasa a verse.
    await cambiarEstadoNoticia(db, id, 'published');
    expect(await obtenerNoticiaPublica(db, id)).toBeTruthy();
    expect((await listarNoticiasPublicadas(db))[0]?.id).toBe(id);

    // Despublicarla la saca del sitio.
    await cambiarEstadoNoticia(db, id, 'draft');
    expect(await obtenerNoticiaPublica(db, id)).toBeNull();

    await eliminarNoticia(db, id);
    expect(await obtenerNoticia(db, id)).toBeNull();
  });

  it('publicar sin fecha asigna la de hoy, y destacar cambia el flag', async () => {
    const id = await crearNoticia(db, {
      titulo: 'Con fecha',
      resumen: '',
      contenido: '',
      imagen: '',
      autor: '',
      published_at: null,
      destacada: false,
      status: 'draft',
    });
    await cambiarEstadoNoticia(db, id, 'published');
    const n = await obtenerNoticiaPublica(db, id);
    expect(n?.published_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect((await obtenerNoticia(db, id))?.destacada).toBe(false);
    await alternarDestacada(db, id);
    expect((await obtenerNoticia(db, id))?.destacada).toBe(true);
    // Destacadas primero en el listado público.
    expect((await listarNoticiasPublicadas(db))[0]?.id).toBe(id);
    await eliminarNoticia(db, id);
  });

  it('la galería borrador no se ve pública; con fotos y portada efectiva sí', async () => {
    const id = await crearGaleria(db, {
      titulo: 'Galería de prueba',
      descripcion: 'Fotos de la fecha',
      portada: '',
      fecha: '2026-09-20',
      status: 'draft',
    });
    expect(await obtenerGaleriaPublica(db, id)).toBeNull();

    await agregarImagen(db, id, 'https://cdn.ejemplo.com/1.jpg', 'Primer gol');
    await agregarImagen(db, id, 'https://cdn.ejemplo.com/2.jpg', '');
    const imagenes = await listarImagenes(db, id);
    expect(imagenes).toHaveLength(2);
    expect(imagenes[0]!.orden).toBeLessThan(imagenes[1]!.orden);

    // Mover la segunda arriba cambia el orden.
    await moverImagen(db, id, imagenes[1]!.id, 'up');
    const reordenadas = await listarImagenes(db, id);
    expect(reordenadas[0]!.id).toBe(imagenes[1]!.id);

    await cambiarEstadoGaleria(db, id, 'published');
    const publicas = await completarGaleriasPublicas(db);
    const mia = publicas.find((g) => g.id === id);
    expect(mia).toBeTruthy();
    expect(mia!.total).toBe(2);
    expect(mia!.portadaEfectiva).toContain('https://');

    await cambiarEstadoGaleria(db, id, 'draft');
    expect(await obtenerGaleriaPublica(db, id)).toBeNull();
    expect((await listarGaleriasPublicadas(db)).find((g) => g.id === id)).toBeUndefined();
  });

  it('las páginas del complejo y del torneo tienen su propio estado', async () => {
    const complejo = leerComplejoForm({ nombre: 'Complejo Central', direccion: 'Av. 1', inst_nombre: [], inst_detalle: [] });
    await guardarPagina(db, 'complejo', complejo, 'draft');
    expect(await obtenerPaginaPublica(db, 'complejo')).toBeNull();

    await guardarPagina(db, 'complejo', complejo, 'published');
    const pub = await obtenerPaginaPublica(db, 'complejo');
    expect(pub).toBeTruthy();
    expect((pub!.data as { nombre: string }).nombre).toBe('Complejo Central');

    // El torneo se guarda por separado: publicar uno no publica al otro.
    const torneo = leerTorneoForm({ presentacion: 'Temporada 2026', dias_juego: 'sábados' });
    await guardarPagina(db, 'torneo', torneo, 'published');
    const t = await obtenerPagina(db, 'torneo');
    expect(t?.status).toBe('published');
    expect((t!.data as { dias_juego: string }).dias_juego).toBe('sábados');

    // JSON corrupto no rompe la lectura.
    sqlite.prepare("UPDATE portal_pages SET data = '{no es json' WHERE slug = 'complejo'").run();
    const rota = await obtenerPagina(db, 'complejo');
    expect(rota?.status).toBe('published');
    expect((rota!.data as { nombre: string }).nombre).toBe('');
  });
});

/* ===================== Rutas: permisos y flujos ===================== */

async function usuario(permisos: string[]): Promise<number> {
  const fila = sqlite.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM admin_users').get() as { n: number };
  const id = Number(fila.n);
  sqlite
    .prepare("INSERT INTO admin_users (id, username, name, password_hash, role, active) VALUES (?1, ?2, ?3, 'x', 'COMMUNITY_MANAGER', 1)")
    .run(id, `user${id}`, `Usuario ${id}`);
  for (const p of permisos) {
    sqlite.prepare('INSERT INTO admin_user_permissions (user_id, permission) VALUES (?1, ?2)').run(id, p);
  }
  return id;
}

async function cookieDe(userId: number): Promise<string> {
  const token = await createSessionToken(SECRET, 'COMMUNITY_MANAGER', userId);
  return sessionCookieHeader(token).split(';')[0]!;
}

function app(env: Env): Hono<{ Bindings: Env }> {
  const a = new Hono<{ Bindings: Env }>();
  a.route('/admin', adminRoutes);
  a.route('/portal-admin', portalAdminRoutes);
  return a;
}

function env(): Env {
  return { DB: db, ASSETS: {} as Fetcher, ADMIN_PASSWORD: SECRET };
}

function form(body: Record<string, string | string[]>, cookie?: string): RequestInit {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, item);
    else params.append(k, v);
  }
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: params.toString(),
  };
}

describe('rutas del portal: permisos por sección en el servidor', () => {
  it('crear, editar, publicar y despublicar una noticia con PORTAL_NOTICIAS', async () => {
    const user = await usuario(['PORTAL_NOTICIAS']);
    const cookie = await cookieDe(user);
    const a = app(env());

    // Alta como borrador.
    const crear = await a.request('/portal-admin/noticias', form({ titulo: 'Fecha 8 programada', status: 'draft' }, cookie), env());
    expect(crear.status).toBe(302);
    expect(crear.headers.get('location')).toContain('borrador');
    const creada = (await listarNoticias(db)).find((n) => n.titulo === 'Fecha 8 programada')!;
    expect(creada.status).toBe('draft');

    // El listado del panel la muestra.
    const listado = await a.request('/portal-admin/noticias', { headers: { cookie } }, env());
    expect(listado.status).toBe(200);
    expect(await listado.text()).toContain('Fecha 8 programada');

    // Edición: pasa a publicada.
    const editar = await a.request(`/portal-admin/noticias/${creada.id}`, form({ titulo: 'Fecha 8 programada', contenido: 'Se juega el domingo', status: 'published' }, cookie), env());
    expect(editar.status).toBe(302);
    expect(editar.headers.get('location')).toContain('publicada');
    expect((await obtenerNoticia(db, creada.id))?.status).toBe('published');

    // Despublicar desde el listado.
    const despublicar = await a.request(`/portal-admin/noticias/${creada.id}/despublicar`, form({}, cookie), env());
    expect(despublicar.status).toBe(302);
    expect((await obtenerNoticia(db, creada.id))?.status).toBe('draft');

    // Vista previa accesible con permiso (muestra borrador con aviso).
    const preview = await a.request(`/portal-admin/noticias/${creada.id}/vista-previa`, { headers: { cookie } }, env());
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('NO se ve en el sitio');

    await eliminarNoticia(db, creada.id);
  });

  it('sin PORTAL_NOTICIAS no se puede ni ver ni POSTear la URL directa (403)', async () => {
    const sinPermiso = await usuario(['PORTAL_FOTOS']);
    const cookie = await cookieDe(sinPermiso);
    const a = app(env());

    for (const [path, init] of [
      ['/portal-admin/noticias', { headers: { cookie } }],
      ['/portal-admin/noticias/nueva', { headers: { cookie } }],
      ['/portal-admin/noticias', form({ titulo: 'Intruso', status: 'draft' }, cookie)],
      ['/portal-admin/noticias/1/publicar', form({}, cookie)],
      ['/portal-admin/noticias/1/eliminar', form({}, cookie)],
    ] as [string, RequestInit][]) {
      const res = await a.request(path, init, env());
      expect(res.status, `${path} debe responder 403`).toBe(403);
      expect(await res.text()).toContain('No tenés permiso');
    }
  });

  it('crear y publicar una galería con PORTAL_FOTOS, y sus fotos', async () => {
    const user = await usuario(['PORTAL_FOTOS']);
    const cookie = await cookieDe(user);
    const a = app(env());

    const crear = await a.request('/portal-admin/fotos', form({ titulo: 'Fecha 5 fotos', status: 'draft' }, cookie), env());
    expect(crear.status).toBe(302);
    const galeria = (await completarGaleriasPublicas(db)).find((g) => g.titulo === 'Fecha 5 fotos') ?? null;
    // Borrador: no está en el listado público todavía.
    expect(galeria).toBeNull();
    const creada = sqlite.prepare("SELECT id FROM portal_galleries WHERE titulo = 'Fecha 5 fotos'").get() as { id: number };

    // Agregar dos fotos.
    for (const url of ['https://cdn.ejemplo.com/a.jpg', 'https://cdn.ejemplo.com/b.jpg']) {
      const res = await a.request(`/portal-admin/fotos/${creada.id}/imagenes`, form({ url }, cookie), env());
      expect(res.status).toBe(302);
    }
    expect(await listarImagenes(db, creada.id)).toHaveLength(2);

    // Publicar.
    const pub = await a.request(`/portal-admin/fotos/${creada.id}/publicar`, form({}, cookie), env());
    expect(pub.status).toBe(302);
    const publicas = await completarGaleriasPublicas(db);
    expect(publicas.find((g) => g.id === creada.id)?.total).toBe(2);

    await a.request(`/portal-admin/fotos/${creada.id}/eliminar`, form({}, cookie), env());
    expect(sqlite.prepare('SELECT COUNT(*) n FROM portal_gallery_images WHERE gallery_id = ?1').get(creada.id) as { n: number }).toMatchObject({ n: 0 });
  });

  it('editar el complejo y la información del torneo con sus permisos', async () => {
    const user = await usuario(['PORTAL_COMPLEJO', 'PORTAL_TORNEO']);
    const cookie = await cookieDe(user);
    const a = app(env());

    const guardarComplejo = await a.request(
      '/portal-admin/complejo',
      form({
        nombre: 'Complejo Nuevo',
        direccion: 'Calle 123',
        inst_nombre: ['Cancha 1'],
        inst_detalle: ['Natural'],
        status: 'published',
      }, cookie),
      env()
    );
    expect(guardarComplejo.status).toBe(302);
    const complejo = await obtenerPaginaPublica(db, 'complejo');
    expect(complejo).toBeTruthy();
    expect((complejo!.data as { direccion: string }).direccion).toBe('Calle 123');

    const guardarTorneo = await a.request(
      '/portal-admin/torneo',
      form({ presentacion: 'Temporada 2026', dias_juego: 'sábados y domingos', status: 'published' }, cookie),
      env()
    );
    expect(guardarTorneo.status).toBe(302);
    expect((await obtenerPaginaPublica(db, 'torneo'))).toBeTruthy();

    // Volver a borrador lo saca del sitio.
    const borrador = await a.request('/portal-admin/complejo', form({ nombre: 'Complejo Nuevo', status: 'draft' }, cookie), env());
    expect(borrador.status).toBe(302);
    expect(await obtenerPaginaPublica(db, 'complejo')).toBeNull();
  });

  it('sin PORTAL_COMPLEJO ni PORTAL_TORNEO las páginas quedan cerradas (403)', async () => {
    const user = await usuario(['PORTAL_NOTICIAS']);
    const cookie = await cookieDe(user);
    const a = app(env());
    for (const path of ['/portal-admin/complejo', '/portal-admin/torneo', '/portal-admin/complejo/vista-previa']) {
      const res = await a.request(path, { headers: { cookie } }, env());
      expect(res.status, `${path} debe responder 403`).toBe(403);
    }
    for (const path of ['/portal-admin/complejo', '/portal-admin/torneo']) {
      const res = await a.request(path, form({ nombre: 'x', status: 'published' }, cookie), env());
      expect(res.status, `${path} (POST) debe responder 403`).toBe(403);
    }
  });

  it('sin sesión no se entra al panel: manda al login', async () => {
    const a = app(env());
    const res = await a.request('/portal-admin/noticias', {}, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/admin/login');
  });
});

/* =================== Regresión: alta de usuarios =================== */

describe('alta de usuarios en /admin/accesos', () => {
  it('varios permisos marcados se guardan TODOS, no solo el último', async () => {
    const token = await createSessionToken(SECRET, 'ADMIN');
    const cookie = sessionCookieHeader(token).split(';')[0]!;
    const a = app(env());

    const res = await a.request(
      '/admin/accesos',
      form(
        {
          username: 'editor.contenido',
          name: 'Editor de contenido',
          password: 'clave-editor-2026',
          permission: ['PORTAL_NOTICIAS', 'PORTAL_FOTOS', 'PORTAL_TORNEO'],
        },
        cookie
      ),
      env()
    );
    expect(res.status).toBe(302);

    const user = sqlite.prepare("SELECT id FROM admin_users WHERE username = 'editor.contenido'").get() as { id: number };
    const perms = sqlite.prepare('SELECT permission FROM admin_user_permissions WHERE user_id = ?1').all(user.id) as { permission: string }[];
    expect(perms.map((p) => p.permission).sort()).toEqual(['PORTAL_FOTOS', 'PORTAL_NOTICIAS', 'PORTAL_TORNEO']);
  });
});
