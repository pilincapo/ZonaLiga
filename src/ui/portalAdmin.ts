// Shell independiente para administrar la información del portal.

import { esc, escUrl } from '../lib/html.ts';
import { BRAND_SVG } from './components.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

export interface PortalNavItem {
  href: string;
  label: string;
  permission?: PortalPermission;
}

export const PORTAL_NAV: PortalNavItem[] = [
  { href: '/portal-admin', label: 'Inicio' },
  { href: '/portal-admin/noticias', label: 'Noticias', permission: 'PORTAL_NOTICIAS' },
  { href: '/portal-admin/fotos', label: 'Fotos', permission: 'PORTAL_FOTOS' },
  { href: '/portal-admin/destacados', label: 'Destacados', permission: 'PORTAL_DESTACADOS' },
  { href: '/portal-admin/complejo', label: 'El complejo', permission: 'PORTAL_COMPLEJO' },
  { href: '/portal-admin/torneo', label: 'Información del torneo', permission: 'PORTAL_TORNEO' },
  { href: '/portal-admin/configuracion', label: 'Configuración', permission: 'PORTAL_CONFIGURACION' },
];

type PortalSection = 'inicio' | 'noticias' | 'fotos' | 'destacados' | 'complejo' | 'torneo' | 'configuracion';

const SECTION_COPY: Record<PortalSection, { title: string; detail: string }> = {
  inicio: {
    title: 'Inicio',
    detail: 'Desde acá vas a poder administrar la información pública de la liga, sin tocar fixture, resultados ni reglas deportivas.',
  },
  noticias: { title: 'Noticias', detail: 'La carga y edición de noticias estará disponible en una próxima etapa.' },
  fotos: { title: 'Fotos', detail: 'La administración de galerías y fotos estará disponible en una próxima etapa.' },
  destacados: { title: 'Destacados', detail: 'La selección de contenido destacado estará disponible en una próxima etapa.' },
  complejo: { title: 'El complejo', detail: 'La información del complejo estará disponible en una próxima etapa.' },
  torneo: { title: 'Información del torneo', detail: 'La información pública del torneo estará disponible en una próxima etapa.' },
  configuracion: { title: 'Configuración', detail: 'La configuración del portal estará disponible en una próxima etapa.' },
};

const SECTION_PATH: Record<string, string> = {
  inicio: '/portal-admin',
  noticias: '/portal-admin/noticias',
  fotos: '/portal-admin/fotos',
  destacados: '/portal-admin/destacados',
  complejo: '/portal-admin/complejo',
  torneo: '/portal-admin/torneo',
  configuracion: '/portal-admin/configuracion',
};

export function portalAdminPage(
  section: PortalSection,
  permissions: ReadonlySet<PortalPermission>
): string {
  const selected = SECTION_COPY[section];
  const nav = PORTAL_NAV.filter((item) => !item.permission || permissions.has(item.permission));
  const links = nav
    .map((item) => `<a class="portal-side-link${item.href === SECTION_PATH[section] ? ' active' : ''}" href="${escUrl(item.href)}"><span class="portal-nav-mark" aria-hidden="true"></span><span>${esc(item.label)}</span></a>`)
    .join('');
  const cards = PORTAL_NAV
    .filter((item) => item.permission && permissions.has(item.permission))
    .map((item) => `<a class="portal-card" href="${escUrl(item.href)}"><span class="portal-card-ico" aria-hidden="true">●</span><strong>${esc(item.label)}</strong><span>Próximamente</span></a>`)
    .join('');
  const content = section === 'inicio'
    ? `<section class="portal-cards">${cards}</section>`
    : `<div class="portal-placeholder"><span class="portal-placeholder-mark" aria-hidden="true">…</span><div><strong>Próximamente</strong><p>${esc(selected.detail)}</p></div></div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(selected.title)} · Administración del portal — ZonaLiga</title>
<meta name="theme-color" content="#0d1b2a">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/css/app.css?v=66">
<script>(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.setAttribute('data-theme','dark')}catch(e){}})();</script>
</head>
<body class="portal-admin-body">
<div class="portal-admin-shell">
  <aside class="portal-admin-side">
    <a class="portal-admin-brand" href="/portal-admin"><span class="portal-brand-mark">${BRAND_SVG}</span><span>Zona<b>Liga</b><small>Portal informativo</small></span></a>
    <nav class="portal-admin-nav" aria-label="Administración del portal">${links}</nav>
    <div class="portal-admin-side-foot"><a href="/" target="_blank" rel="noopener">Ver portal ↗</a><a href="/portal-admin/logout">Cerrar sesión</a></div>
  </aside>
  <main class="portal-admin-main">
    <header class="portal-admin-top"><span>Administración del portal</span><a href="/" target="_blank" rel="noopener">Ver portal ↗</a></header>
    <section class="portal-admin-content">
      <div class="portal-admin-heading"><span class="portal-admin-eyebrow">PORTAL INFORMATIVO</span><h1>${esc(selected.title)}</h1><p>${esc(selected.detail)}</p></div>
      ${content}
      <p class="portal-admin-boundary">Este espacio está separado de la administración deportiva del torneo.</p>
    </section>
  </main>
</div>
</body>
</html>`;
}
