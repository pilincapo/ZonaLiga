// Acceso separado para administrar el portal informativo.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { clearSessionCookieHeader, getSessionCookie, getSessionPrincipal, sessionSecret } from '../lib/auth.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';
import { getPanelUserById, userPortalPermissions } from '../lib/users.ts';
import { portalAdminPage } from '../ui/portalAdmin.ts';

type PortalEnv = {
  Bindings: Env;
  Variables: { portalPermissions: ReadonlySet<PortalPermission> };
};

export const portalAdminRoutes = new Hono<PortalEnv>();

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
  const principal = await getSessionPrincipal(getSessionCookie(c.req.raw), sessionSecret(c.env));
  if (!principal) return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  // El administrador gestiona el deporte: el portal es de los usuarios con
  // cuenta propia, así que se lo devolvemos a su panel.
  if (principal.role !== 'COMMUNITY_MANAGER' || principal.userId == null) {
    if (principal.role === 'ADMIN') return c.redirect('/admin');
    return c.redirect('/admin/login?next=%2Fportal-admin');
  }
  // Usuario real: carga sus permisos de portal desde la base.
  const user = await getPanelUserById(c.env.DB, principal.userId);
  if (!user || user.active !== 1) {
    c.header('Set-Cookie', clearSessionCookieHeader());
    return c.redirect('/admin/login?next=%2Fportal-admin');
  }
  const permissions = await userPortalPermissions(c.env.DB, user.id);
  const entry = sectionAt(path);
  if (!entry) return c.notFound();
  // Sección sin permiso: 403 aunque se conozca la URL (validación server-side).
  if (entry.permission && !permissions.has(entry.permission)) {
    return c.text('No tenés permiso para esta sección.', 403);
  }
  c.set('portalPermissions', permissions);
  return next();
});

for (const [path, route] of Object.entries(ROUTES)) {
  portalAdminRoutes.get(route, async (c) => {
    const entry = SECTIONS[path]!;
    const permissions = c.get('portalPermissions');
    return c.html(portalAdminPage(entry.section, permissions));
  });
}

portalAdminRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader());
  return c.redirect('/admin/login');
});
