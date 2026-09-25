// Chrome del sitio: layout con barra de navegación, footer y selector de tema.
// Las piezas de partidos/equipos viven en match.ts; los íconos en icons.ts.

import { esc, escUrl } from '../lib/html.ts';
import { APP_VERSION } from '../changelog.ts';
import { icon } from './icons.ts';

export interface NavItem {
  href: string;
  label: string;
  match: string; // prefijo para marcar activo
  badge?: string | number;
}

const BRAND_SVG = `<svg viewBox="0 0 40 44" fill="none" aria-hidden="true">
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" fill="#0e8a4a"/>
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" stroke="#21c063" stroke-width="2.4"/>
  <circle cx="20" cy="19.5" r="7.6" fill="#fff"/>
  <path d="M20 15.7l3.5 2.5-1.3 4.2h-4.4l-1.3-4.2L20 15.7z" fill="#0d1b2a"/>
  <path d="M12.4 19.5l3.3-1.3M27.6 19.5l-3.3-1.3M20 27.1v-4.7" stroke="#0d1b2a" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

/** Subir al cambiar CSS/íconos: versiona la URL y saltea cachés viejas. */
const ASSET_VERSION = '25';

const SUN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7"/></svg>`;
const MOON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z"/></svg>`;

/**
 * Selector de tema: claro / oscuro / automático (sigue al sistema).
 * La elección manual se guarda en localStorage; sin elección manda el sistema.
 */
function themeMenu(): string {
  const sized = (svg: string) => svg.replace('<svg', '<svg width="16" height="16"');
  const opt = (choice: 'light' | 'dark' | 'auto', ico: string, label: string): string =>
    `<button type="button" role="menuitemradio" aria-checked="false" data-theme-choice="${choice}">
        <span class="theme-opt-ico">${ico}</span>${label}<span class="check">✓</span>
      </button>`;
  return `<div class="theme-menu">
    <button type="button" class="theme-toggle" id="themeToggle" aria-haspopup="true" aria-expanded="false" aria-label="Cambiar tema" title="Cambiar tema">
      <span class="ico-moon">${MOON_SVG}</span>
      <span class="ico-sun">${SUN_SVG}</span>
    </button>
    <div class="theme-pop" id="themePop" role="menu" hidden>
      ${opt('light', sized(SUN_SVG), 'Claro')}
      ${opt('dark', sized(MOON_SVG), 'Oscuro')}
      <div class="sep"></div>
      ${opt('auto', icon('monitor', 16), 'Automático (sistema)')}
    </div>
  </div>`;
}

/** Fija el tema antes de pintar (sin parpadeo) y sigue al sistema si no hay elección. */
const THEME_BOOTSTRAP = `<script>
  (function () {
    try {
      var saved = localStorage.getItem('zl-theme');
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var manual = saved === 'dark' || saved === 'light';
      var paint = function (dark) {
        if (dark) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
      };
      paint(manual ? saved === 'dark' : mq.matches);
      var onSystemChange = function () {
        var now = localStorage.getItem('zl-theme');
        if (now === 'dark' || now === 'light') return; // la elección manual siempre gana
        paint(mq.matches);
      };
      if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
      else if (mq.addListener) mq.addListener(onSystemChange);
    } catch (e) {}
  })();
</script>`;

function brandMark(href: string): string {
  return `<a class="brand" href="${escUrl(href)}">
      <span class="brand-logo">${BRAND_SVG}</span>
      <span class="brand-word">Zona<b>Liga</b></span>
    </a>`;
}

function siteFooter(): string {
  return `<footer class="site-footer">
  <div class="container">
    <div class="foot-grid">
      <div class="foot-brand">
        ${brandMark('/')}
        <p>Fixture, resultados, tablas y goleadores al día.</p>
      </div>
      <div class="foot-col">
        <h3>Navegación</h3>
        <ul>
          <li><a href="/">Inicio</a></li>
          <li><a href="/en-vivo">En vivo</a></li>
          <li><a href="/posiciones">Posiciones</a></li>
          <li><a href="/fixture">Fixture</a></li>
          <li><a href="/goleadores">Goleadores</a></li>
          <li><a href="/equipos">Equipos</a></li>
          <li><a href="/historial">Historial</a></li>
          <li><a href="/suspensiones">Suspensiones</a></li>
        </ul>
      </div>
      <div class="foot-col">
        <h3>Accesos</h3>
        <ul>
          <li><a href="/admin">Panel de administración</a></li>
          <li><a href="/delegado">Carga de resultados (delegados)</a></li>
          <li><a href="/buscar">Buscar equipo o jugador</a></li>
          <li><a href="/historial">Archivo de torneos</a></li>
        </ul>
      </div>
      <div class="foot-col foot-news">
        <h3>Compartí la liga</h3>
        <p>Mandales el fixture por WhatsApp.</p>
        <div class="foot-form">
          <a class="btn btn-primary" id="footShare" target="_blank" rel="noopener" href="https://wa.me/?text=">Compartir por WhatsApp</a>
        </div>
      </div>
    </div>
    <div class="foot-bottom">
      <span>© ${new Date().getFullYear()} ZonaLiga. Todos los derechos reservados. <a class="ver-link" href="/changelog" title="Novedades de esta versión" aria-label="Novedades de esta versión">v${APP_VERSION}</a></span>
      <span>Hecho para el fútbol amateur ♥</span>
    </div>
  </div>
</footer>`;
}

function defaultActions(isAdmin: boolean): string {
  if (isAdmin) return `<a class="btn btn-outline btn-sm" href="/">Ver sitio ↗</a>`;
  return `<a class="btn btn-outline btn-sm" href="/delegado">Delegado</a>
    <a class="btn btn-primary btn-sm" href="/admin">Panel</a>`;
}

export function layout(opts: {
  title: string;
  active?: string;
  nav: NavItem[];
  body: string;
  isAdmin?: boolean;
  brandHref?: string;
  actions?: string;
}): string {
  const nav = opts.nav
    .map((n) => {
      const badge = n.badge ? ` <span class="badge amber">${esc(String(n.badge))}</span>` : '';
      return `<a href="${escUrl(n.href)}" class="${opts.active === n.match ? 'active' : ''}">${esc(n.label)}${badge}</a>`;
    })
    .join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="theme-color" content="#0d1b2a">
<meta name="description" content="Fixture, posiciones, goleadores y resultados de la liga amateur">
${THEME_BOOTSTRAP}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/img/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
</head>
<body>
<header class="site-header${opts.isAdmin ? ' admin-header' : ''}">
  <div class="container">
    ${brandMark(opts.brandHref ?? (opts.isAdmin ? '/admin' : '/'))}
    <button id="navToggle" aria-label="Menú" aria-expanded="false">☰</button>
    <nav class="nav" id="mainNav">${nav}</nav>
    <div class="header-actions">${opts.actions ?? defaultActions(opts.isAdmin ?? false)}${themeMenu()}</div>
  </div>
</header>
<main class="container">
${opts.body}
</main>
${siteFooter()}
<script>
  var t = document.getElementById('navToggle');
  if (t) t.addEventListener('click', function () {
    var open = document.getElementById('mainNav').classList.toggle('open');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  /* Tema: claro / oscuro / automático */
  var tBtn = document.getElementById('themeToggle');
  var tPop = document.getElementById('themePop');
  if (tBtn && tPop) {
    var choices = [].slice.call(tPop.querySelectorAll('[data-theme-choice]'));
    var paint = function (dark) {
      if (dark) document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
    };
    var savedChoice = function () {
      try {
        var v = localStorage.getItem('zl-theme');
        return v === 'dark' || v === 'light' ? v : 'auto';
      } catch (e) { return 'auto'; }
    };
    var close = function () { tPop.setAttribute('hidden', ''); tBtn.setAttribute('aria-expanded', 'false'); };
    var sync = function () {
      var current = savedChoice();
      choices.forEach(function (b) {
        b.setAttribute('aria-checked', b.getAttribute('data-theme-choice') === current ? 'true' : 'false');
      });
    };
    tBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tPop.hasAttribute('hidden')) { sync(); tPop.removeAttribute('hidden'); tBtn.setAttribute('aria-expanded', 'true'); }
      else close();
    });
    choices.forEach(function (b) {
      b.addEventListener('click', function () {
        var choice = b.getAttribute('data-theme-choice');
        try {
          if (choice === 'auto') localStorage.removeItem('zl-theme');
          else localStorage.setItem('zl-theme', choice);
        } catch (e) {}
        var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        paint(choice === 'auto' ? systemDark : choice === 'dark');
        sync();
        close();
      });
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    sync();
  }
  var share = document.getElementById('footShare');
  if (share) share.href = 'https://wa.me/?text=' + encodeURIComponent('⚽ ZonaLiga — ' + document.title + ' ' + location.href);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
</script>
</body>
</html>`;
}

export function shareBar(links: { label: string; href: string }[]): string {
  if (links.length === 0) return '';
  const btns = links
    .map((l) => `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${escUrl(l.href)}">${esc(l.label)}</a>`)
    .join('');
  return `<div class="share-bar">${btns}</div>`;
}

export function emptyNote(text: string): string {
  return `<div class="empty-note">${esc(text)}</div>`;
}
