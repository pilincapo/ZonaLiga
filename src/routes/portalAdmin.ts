// Acceso separado para administrar el portal informativo.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { getSessionCookie, getSessionRole, sessionSecret, clearSessionCookieHeader } from '../lib/auth.ts';
import { canAccessPortalPermission, portalPermissionsOf, type PortalPermission } from '../lib/portalAccess.ts';
import { portalAdminPage } from '../ui/portalAdmin.ts';

export const portalAdminRoutes = new Hono<{ Bindings: Env }>();

const SECTIONS: Record<string, { section: Parameters<typeof portalAdminPage>[0]; permission?: PortalPermission }> = {
  '/portal-admin': { section: 'inicio' },
  '/portal-admin/noticias': { section: 'noticias', permission: 'PORTAL_NOTICIAS' },
  '/portal-admin/fotos': { section: 'fotos', permission: 'PORTAL_FOTOS' },
  '/portal-admin/destacados': { section: 'destacados', permission: 'PORTAL_DESTACADOS' },
  '/portal-admin/complejo': { section: 'complejo', permission: 'PORTAL_COMPLEJO' },
  '/portal-admin/torneo': { section: 'torneo', permission: 'PORTAL_TORNEO' },
  '/portal-admin/configuracion': { section: 'configuracion', permission: 'PORTAL_CONFIGURACION' },
};

const ROUTES: Record<string, string> = {
  '/portal-admin': '/',
  '/portal-admin/noticias': '/noticias',
  '/portal-admin/fotos': '/fotos',
  '/portal-admin/destacados': '/destacados',
  '/portal-admin/complejo': '/complejo',
  '/portal-admin/torneo': '/torneo',
  '/portal-admin/configuracion': '/configuracion',
};

function portalPath(path: string): string {
  const normalized = path.replace(/\/$/, '') || '/';
  if (normalized === '/portal-admin' || normalized.startsWith('/portal-admin/')) return normalized;
  return normalized === '/' ? '/portal-admin' : `/portal-admin${normalized}`;
}

function sectionAt(path: string) {
  return SECTIONS[path];
}

portalAdminRoutes.use('*', async (c, next) => {
  const path = portalPath(c.req.path);
  if (path === '/portal-admin/login') return c.redirect('/admin/login?next=%2Fportal-admin');
  if (path === '/portal-admin/logout') return next();
  const role = await getSessionRole(getSessionCookie(c.req.raw), sessionSecret(c.env));
  if (!role) return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  if (role === 'ADMIN') return c.redirect('/admin');
  if (role !== 'COMMUNITY_MANAGER') return c.redirect('/admin/login?next=%2Fportal-admin');
  const entry = sectionAt(path);
  if (!entry) return c.notFound();
  if (entry.permission) {
    const permissions = portalPermissionsOf(c.env.COMMUNITY_MANAGER_PORTAL_PERMISSIONS);
    if (!canAccessPortalPermission(role, entry.permission, permissions)) return c.text('No tenés permiso para esta sección.', 403);
  }
  return next();
});

for (const [path, route] of Object.entries(ROUTES)) {
  portalAdminRoutes.get(route, async (c) => {
    const entry = SECTIONS[path]!;
    const permissions = portalPermissionsOf(c.env.COMMUNITY_MANAGER_PORTAL_PERMISSIONS);
    return c.html(portalAdminPage(entry.section, permissions));
  });
}

portalAdminRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader());
  return c.redirect('/admin/login');
});
