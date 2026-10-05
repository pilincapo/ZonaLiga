// Archivos del portal (Fase 18.3): validación real de imágenes, nombres seguros,
// servicio público /i/{archivo_id} y subida desde el panel.
//
// Usa SQLite en memoria con las MIGRACIONES REALES envuelto como D1 (igual que
// portalContent.test.ts) para probar el SQL de verdad, y un R2 falso con la
// misma forma que usa el código (put/get/delete).

import { describe, expect, it, beforeAll } from 'vitest';
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
import { mimePorMagicBytes, nombreSeguro, urlR2, subirArchivo } from '../src/lib/portalArchivos.ts';
import { crearNoticia } from '../src/lib/portalContent.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'secret-test-archivos';
const DOMINIO = 'cuenta.r2.dev';

/* ---------- SQLite real con las migraciones del proyecto ---------- */

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

/** R2 falso: guarda los bytes en memoria, igual que un bucket de verdad. */
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

let sqlite: DatabaseSync;
let db: D1Database;

beforeAll(() => {
  sqlite = crearBase();
  db = d1(sqlite);
});

function env(bucket: R2Bucket | undefined = undefined): Env {
  return { DB: db, ASSETS: {} as Fetcher, ADMIN_PASSWORD: SECRET } as unknown as Env;
}

function app(e: Env) {
  const a = new Hono<{ Bindings: Env }>();
  a.route('/admin', adminRoutes);
  a.route('/portal-admin', portalAdminRoutes);
  a.route('/i', portalImagenesRoutes);
  return a;
}

async function usuarioYCookie(permisos: string[]): Promise<string> {
  const r = sqlite
    .prepare("INSERT INTO admin_users (username, name, password_hash, role, active) VALUES (?1, 'U', 'x', 'COMMUNITY_MANAGER', 1)")
    .run(`u${Date.now()}${Math.round(performance.now() * 1000)}`);
  const id = Number(r.lastInsertRowid);
  for (const p of permisos) {
    sqlite.prepare('INSERT INTO admin_user_permissions (user_id, permission) VALUES (?1, ?2)').run(id, p);
  }
  const token = await createSessionToken(SECRET, 'COMMUNITY_MANAGER', id);
  return sessionCookieHeader(token).split(';')[0]!;
}

function form(body: Record<string, string | File>, cookie?: string): RequestInit {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, v);
  return { method: 'POST', headers: cookie ? { cookie } : {}, body: fd };
}

/* ------------------------------ imágenes ------------------------------ */

/** Bytes mínimos válidos de cada formato (el resto del archivo no importa). */
function bytesDe(mime: string): ArrayBuffer {
  const base =
    mime === 'image/png'
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : mime === 'image/jpeg'
        ? [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]
        : mime === 'image/gif'
          ? [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]
          : [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
  return new Uint8Array(base).buffer;
}

describe('validación de imágenes', () => {it('reconoce los formatos permitidos por sus bytes', () => {
    const png = mimePorMagicBytes(bytesDe('image/png'));
    const jpg = mimePorMagicBytes(bytesDe('image/jpeg'));
    const gif = mimePorMagicBytes(bytesDe('image/gif'));
    const webp = mimePorMagicBytes(bytesDe('image/webp'));
    expect(png.ok && png.value.mime).toBe('image/png');
    expect(jpg.ok && jpg.value.extension).toBe('jpg');
    expect(gif.ok && gif.value.extension).toBe('gif');
    expect(webp.ok && webp.value.mime).toBe('image/webp');
  });

  it('rechaza un archivo que no es imagen aunque diga que lo es', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]).buffer;
    const r = mimePorMagicBytes(pdf, 'image/png');
    expect(r.ok).toBe(false);
  });

  it('rechaza archivo vacío y archivo que supera el límite', () => {
    expect(mimePorMagicBytes(new ArrayBuffer(0)).ok).toBe(false);
    const gigante = new Uint8Array(9 * 1024 * 1024);
    gigante.set([0x89, 0x50, 0x4e, 0x47]);
    expect(mimePorMagicBytes(gigante.buffer).ok).toBe(false);
  });

  it('el nombre seguro lleva el prefijo del tipo y no el nombre del usuario', () => {
    const n = nombreSeguro('noticia.imagen_principal', 'png');
    expect(n.startsWith('noticia/imagen/')).toBe(true);
    expect(n.endsWith('.png')).toBe(true);
    expect(n).not.toMatch(/[\\ ]/);
    expect(nombreSeguro('config.hero', 'jpg')).toMatch(/^config\/hero\/[a-f0-9]+\.jpg$/);
  });

  it('la url pública de R2 se arma con el dominio del bucket', () => {
    expect(urlR2(DOMINIO, 'config/hero/abc.jpg')).toBe(`https://${DOMINIO}/config/hero/abc.jpg`);
  });
});

/* --------------------------- servicio /i/{id} --------------------------- */

describe('servicio público de imágenes', () => {
  it('404 si el archivo no existe', async () => {
    const a = app(env());
    expect((await a.request('/i/999999', {}, env())).status).toBe(404);
  });

  it('404 si el id no es un número', async () => {
    const a = app(env());
    expect((await a.request('/i/abc', {}, env())).status).toBe(404);
  });

  it('404 si la noticia padre es borrador, y sirve cuando se publica', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const noticiaId = await crearNoticia(db, { titulo: 'Foto del complejo', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'draft' });
    const archivo = await subirArchivo(db, bucket as unknown as R2Bucket, DOMINIO, 'noticia.imagen_principal', noticiaId, bytesDe('image/png'));

    // Borrador: ni existe para el público.
    expect((await a.request(`/i/${archivo.archivo_id}`, {}, e as Env)).status).toBe(404);

    // Publicada: se sirve el objeto.
    sqlite.prepare("UPDATE portal_noticias SET status = 'published', published_at = '2026-10-05' WHERE id = ?1").run(noticiaId);
    const res = await a.request(`/i/${archivo.archivo_id}`, {}, e as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
  });

  it('redirige a la URL externa cuando la imagen es un enlace', async () => {
    const e = env();
    const a = app(e);
    const noticiaId = await crearNoticia(db, { titulo: 'Con enlace', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    sqlite
      .prepare(
        `INSERT INTO portal_archivos (tipo, padre_id, nombre_seguridad, extension, mime, tamano_bytes, url_externo, key_r2, url_publico, es_publico)
         VALUES ('noticia.imagen_principal', ?1, 'x.jpg', 'jpg', 'image/jpeg', 10, 'https://cdn.ejemplo.com/foto.jpg', NULL, 'https://cdn.ejemplo.com/foto.jpg', 1)`
      )
      .run(noticiaId);
    const row = sqlite.prepare('SELECT archivo_id FROM portal_archivos WHERE padre_id = ?1').get(noticiaId) as { archivo_id: number };
    const res = await a.request(`/i/${row.archivo_id}`, {}, e);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn.ejemplo.com/foto.jpg');
  });

  it('503 controlado cuando el bucket no está configurado', async () => {
    const e = env(); // sin R2
    const a = app(e);
    const noticiaId = await crearNoticia(db, { titulo: 'Sin bucket', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    sqlite
      .prepare(
        `INSERT INTO portal_archivos (tipo, padre_id, nombre_seguridad, extension, mime, tamano_bytes, url_externo, key_r2, url_publico, es_publico)
         VALUES ('noticia.imagen_principal', ?1, 'y.png', 'png', 'image/png', 10, NULL, 'noticia/imagen/y.png', 'https://x.r2.dev/noticia/imagen/y.png', 1)`
      )
      .run(noticiaId);
    const row = sqlite.prepare('SELECT archivo_id FROM portal_archivos WHERE padre_id = ?1').get(noticiaId) as { archivo_id: number };
    const res = await a.request(`/i/${row.archivo_id}`, {}, e);
    expect(res.status).toBe(503);
  });
});

/* ------------------------- subida desde el panel ------------------------- */

describe('subir imagen de una noticia desde el panel', () => {
  it('sube el archivo a R2, guarda el registro y publica la URL', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const cookie = await usuarioYCookie(['PORTAL_NOTICIAS']);
    const id = await crearNoticia(db, { titulo: 'Con foto', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });

    const archivo = new File([bytesDe('image/png')], 'foto.png', { type: 'image/png' });
    const res = await a.request(
      `/portal-admin/noticias/${id}/imagen`,
      form({ archivo, 'noticia.imagen_principal__url_externo': '' }, cookie),
      e as Env
    );
    expect(res.status).toBe(302);

    const fila = sqlite.prepare('SELECT * FROM portal_noticias WHERE id = ?1').get(id) as { imagen: string };
    expect(fila.imagen).toMatch(/^https:\/\/cuenta\.r2\.dev\/noticia\/imagen\//);
    const arch = sqlite.prepare('SELECT key_r2 FROM portal_archivos WHERE padre_id = ?1').get(id) as { key_r2: string };
    expect(bucket.objetos.has(arch.key_r2)).toBe(true);

    // Y el público la puede ver.
    const publica = await a.request(`/i/${(sqlite.prepare('SELECT archivo_id FROM portal_archivos WHERE padre_id = ?1').get(id) as { archivo_id: number }).archivo_id}`, {}, e as Env);
    expect(publica.status).toBe(200);
  });

  it('guarda un enlace externo sin tocar R2', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const cookie = await usuarioYCookie(['PORTAL_NOTICIAS']);
    const id = await crearNoticia(db, { titulo: 'Foto link', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });

    const res = await a.request(
      `/portal-admin/noticias/${id}/imagen`,
      form({ 'noticia.imagen_principal__url_externo': 'https://cdn.ejemplo.com/x.jpg' }, cookie),
      e as Env
    );
    expect(res.status).toBe(302);
    const fila = sqlite.prepare('SELECT imagen FROM portal_noticias WHERE id = ?1').get(id) as { imagen: string };
    expect(fila.imagen).toBe('https://cdn.ejemplo.com/x.jpg');
    expect(bucket.objetos.size).toBe(0);
  });

  it('rechaza un archivo que no es imagen y lo dice', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const cookie = await usuarioYCookie(['PORTAL_NOTICIAS']);
    const id = await crearNoticia(db, { titulo: 'No imagen', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'draft' });
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], 'x.pdf', { type: 'image/png' });

    const res = await a.request(`/portal-admin/noticias/${id}/imagen`, form({ archivo: pdf }, cookie), e as Env);
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('err=');
    expect(bucket.objetos.size).toBe(0);
  });

  it('quitar la imagen borra el archivo y deja el campo vacío', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const cookie = await usuarioYCookie(['PORTAL_NOTICIAS']);
    const id = await crearNoticia(db, { titulo: 'A quitar', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'published' });
    await subirArchivo(db, bucket as unknown as R2Bucket, DOMINIO, 'noticia.imagen_principal', id, bytesDe('image/png'));
    expect(bucket.objetos.size).toBe(1);

    const res = await a.request(`/portal-admin/noticias/${id}/imagen`, form({ accion: 'quitar' }, cookie), e as Env);
    expect(res.status).toBe(302);
    expect(bucket.objetos.size).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM portal_archivos WHERE padre_id = ?1').get(id)).toMatchObject({ n: 0 });
    expect((sqlite.prepare('SELECT imagen FROM portal_noticias WHERE id = ?1').get(id) as { imagen: string }).imagen).toBe('');
  });

  it('sin permiso de noticias, la subida responde 403', async () => {
    const bucket = r2Falso();
    const e = { ...env(), R2_PUBLIC_BUCKET: bucket as unknown as R2Bucket, R2_PUBLIC_BUCKET_DOMAIN: DOMINIO };
    const a = app(e as Env);
    const cookie = await usuarioYCookie(['PORTAL_FOTOS']);
    const id = await crearNoticia(db, { titulo: 'Sin permiso', resumen: '', contenido: 'x', imagen: '', autor: '', published_at: null, destacada: false, status: 'draft' });
    const archivo = new File([bytesDe('image/png')], 'f.png', { type: 'image/png' });
    const res = await a.request(`/portal-admin/noticias/${id}/imagen`, form({ archivo }, cookie), e as Env);
    expect(res.status).toBe(403);
    expect(bucket.objetos.size).toBe(0);
  });
});