import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSessionToken, sessionCookieHeader } from '../src/lib/auth.ts';
import type { Env } from '../src/types.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { portalAdminRoutes } from '../src/routes/portalAdmin.ts';

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/admin', adminRoutes);
  app.route('/portal-admin', portalAdminRoutes);
  return app;
}

async function cookieFor(role: 'ADMIN' | 'COMMUNITY_MANAGER') {
  const token = await createSessionToken('fixture-secret', role);
  return sessionCookieHeader(token).split(';')[0]!;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    ADMIN_PASSWORD: 'fixture-secret',
    COMMUNITY_MANAGER_PASSWORD: 'community-pass',
    ...overrides,
  };
}

describe('rutas protegidas del portal y del área deportiva', () => {
  it('Community Manager sin permiso deportivo solo ingresa al portal', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER');
    const portal = await app.request('/portal-admin', { headers: { cookie } }, env());
    expect(portal.status).toBe(200);
    expect(await portal.text()).toContain('Portal informativo');

    const sports = await app.request('/admin', { headers: { cookie } }, env());
    expect(sports.status).toBe(302);
    expect(sports.headers.get('location')).toContain('/admin/login?next=%2Fadmin');
  });

  it('solo los permisos portal configurados dejan pasar a su sección', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER');
    const allowed = await app.request('/portal-admin/noticias', { headers: { cookie } }, env({ COMMUNITY_MANAGER_PORTAL_PERMISSIONS: 'PORTAL_NOTICIAS' }));
    const denied = await app.request('/portal-admin/fotos', { headers: { cookie } }, env({ COMMUNITY_MANAGER_PORTAL_PERMISSIONS: 'PORTAL_NOTICIAS' }));
    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('permiso deportivo opcional y permisos portal son independientes', async () => {
    const app = makeApp();
    const cookie = await cookieFor('COMMUNITY_MANAGER');
    const sportsEnv = env({ COMMUNITY_MANAGER_SPORTS_ADMIN: 'true' });
    const sports = await app.request('/admin/__auth-check', { headers: { cookie } }, sportsEnv);
    const portal = await app.request('/portal-admin', { headers: { cookie } }, sportsEnv);
    expect(sports.status).toBe(404); // No redirigió al login: la guardia deportiva autorizó el rol.
    expect(portal.status).toBe(200);
  });

  it('ADMIN conserva el área deportiva y no recibe automáticamente permisos del portal', async () => {
    const app = makeApp();
    const cookie = await cookieFor('ADMIN');
    const sports = await app.request('/admin/__auth-check', { headers: { cookie } }, env());
    const portal = await app.request('/portal-admin', { headers: { cookie } }, env());
    expect(sports.status).toBe(404);
    expect(portal.status).toBe(302);
    expect(portal.headers.get('location')).toBe('/admin');
  });
});
