// Guardias de /admin y /portal-admin con usuarios reales (sin claves
// compartidas): la identidad viene de la cookie firmada y los permisos de D1.

import { describe, expect, it, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createSessionToken, sessionCookieHeader, sessionSecret } from '../src/lib/auth.ts';
import { hashPanelPassword } from '../src/lib/users.ts';
import type { Env } from '../src/types.ts';
import { adminRoutes, isAdmin } from '../src/routes/admin.ts';
import { portalAdminRoutes } from '../src/routes/portalAdmin.ts';

const SECRET = 'fixture-secret';

/* ---------- Base falsa mínima: identidad y permisos, listas vacías para el resto ---------- */

interface FakeUserRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: 'COMMUNITY_MANAGER';
  active: number;
}

const users = new Map<number, FakeUserRow>();
const permissions = new Map<number, string[]>();
let nextId = 1;

function fakeDb(): D1Database {
  const stmt = (sql: string) => ({
    bind(...args: unknown[]) {
      if (sql.includes('FROM admin_users WHERE id = ?1')) {
        return { first: async () => users.get(args[0] as number) ?? null };
      }
      if (sql.includes('FROM admin_users WHERE username')) {
        const name = String(args[0] ?? '').toLowerCase();
        for (const u of users.values()) if (u.username.toLowerCase() === name) return { first: async () => u };
        return { first: async () => null };
      }
      if (sql.includes('FROM admin_user_permissions WHERE user_id = ?1')) {
        const list = permissions.get(args[0] as number) ?? [];
        return { all: async () => ({ results: list.map((permission) => ({ permission })) }) };
      }
      if (sql.includes('FROM admin_users ORDER BY username')) {
        return { all: async () => ({ results: [...users.values()] }) };
      }
      return { first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) };
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  });
  const db = {
    prepare: stmt,
    batch: async () => [],
  };
  return db as unknown as D1Database;
}

function env(): Env {
  return { DB: fakeDb(), ASSETS: {} as Fetcher, ADMIN_PASSWORD: SECRET };
}

async function addUser(permisos: string[], active = 1): Promise<number> {
  const id = nextId++;
  users.set(id, {
    id,
    username: `user${id}`,
    name: `Usuario ${id}`,
    password_hash: await hashPanelPassword(`clave-${id}-segura`),
    role: 'COMMUNITY_MANAGER',
    active,
  });
  permissions.set(id, permisos);
  return id;
}

async function cookieFor(role: 'ADMIN' | 'COMMUNITY_MANAGER', userId?: number): Promise<string> {
  const token = await createSessionToken(SECRET, role, userId);
  return sessionCookieHeader(token).split(';')[0]!;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/admin', adminRoutes);
  app.route('/portal-admin', portalAdminRoutes);
  return app;
}

let noticias: number;
let sinPortal: number;
let estadisticas: number;
let suspendido: number;

beforeAll(async () => {
  noticias = await addUser(['PORTAL_NOTICIAS']);
  sinPortal = await addUser([]);
  estadisticas = await addUser(['PORTAL_NOTICIAS', 'SPORTS_ESTADISTICAS']);
  suspendido = await addUser(['PORTAL_NOTICIAS'], 0);
});

describe('usuarios reales del panel (Fase 18.1 corregida)', () => {
  it('1) Community Manager válido entra a /portal-admin', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER', noticias);
    const res = await app.request('/portal-admin', { headers: { cookie } }, env());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Portal informativo');
  });

  it('2) Community Manager sin permisos deportivos no entra a /admin', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER', noticias);
    const res = await app.request('/admin', { headers: { cookie } }, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/portal-admin');
    // La decisión del guardia, sin pasar por la ruta.
    expect(await isAdmin({ req: { path: '/admin', raw: new Request('http://test/', { headers: { cookie } }) }, env: env() })).toBe(false);
  });

  it('3) el administrador (usuario normal del panel) no obtiene acceso al portal', async () => {
    const app = makeApp();
    const cookie = await cookieFor('ADMIN');
    const res = await app.request('/portal-admin', { headers: { cookie } }, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    // Sin sesión, el portal también manda al login.
    const anon = await app.request('/portal-admin', {}, env());
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toContain('/admin/login');
  });

  it('4) con un permiso deportivo específico obtiene solamente ese acceso', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER', estadisticas);
    const allowed = { req: { path: '/admin/estadisticas', raw: new Request('http://test/', { headers: { cookie } }) }, env: env() };
    const deniedTorneos = { req: { path: '/admin/torneos', raw: new Request('http://test/', { headers: { cookie } }) }, env: env() };
    const deniedFixture = { req: { path: '/admin/fixture', raw: new Request('http://test/', { headers: { cookie } }) }, env: env() };
    expect(await isAdmin(allowed)).toBe(true);
    expect(await isAdmin(deniedTorneos)).toBe(false);
    expect(await isAdmin(deniedFixture)).toBe(false);
    // Y en la ruta real, lo denegado redirige al portal.
    const res = await app.request('/admin/torneos', { headers: { cookie } }, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/portal-admin');
  });

  it('5) sin permiso de portal no puede abrir la sección aunque conozca la URL', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER', sinPortal);
    const res = await app.request('/portal-admin/noticias', { headers: { cookie } }, env());
    expect(res.status).toBe(403);
    // Con permiso, esa misma URL sí abre.
    const ok = await app.request('/portal-admin/noticias', { headers: { cookie: await cookieFor('COMMUNITY_MANAGER', noticias) } }, env());
    expect(ok.status).toBe(200);
    // La foto tampoco: este usuario solo tiene NOTICIAS.
    const fotos = await app.request('/portal-admin/fotos', { headers: { cookie: await cookieFor('COMMUNITY_MANAGER', noticias) } }, env());
    expect(fotos.status).toBe(403);
  });

  it('la sesión de un usuario suspendido se corta', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER', suspendido);
    const res = await app.request('/portal-admin', { headers: { cookie } }, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/admin/login');
  });

  it('el login acepta usuario y contraseña propios, y el secreto del panel sigue funcionando', async () => {
    const app = makeApp();
    // Cuenta propia: entra al portal.
    const user = users.get(noticias)!;
    const ok = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user.username, password: `clave-${noticias}-segura`, next: '/admin' }).toString(),
    }, env());
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/portal-admin');

    // Contraseña de la cuenta equivocada: 401.
    const bad = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: user.username, password: 'otra-clave' }).toString(),
    }, env());
    expect(bad.status).toBe(401);

    // El secreto del administrador, sin usuario, sigue dando acceso deportivo.
    const admin = await app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: SECRET }).toString(),
    }, env());
    expect(admin.status).toBe(302);
    expect(admin.headers.get('location')).toBe('/admin');
    expect(sessionSecret(env())).toBe(SECRET);
  });
});
