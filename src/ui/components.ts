// Chrome del sitio: layout con barra de navegación, footer y selector de tema.
// Las piezas de partidos/equipos viven en match.ts; los íconos en icons.ts.

import { esc, escUrl } from '../lib/html.ts';
import { APP_VERSION } from '../changelog.ts';
import { icon } from './icons.ts';

export { icon };

export interface NavItem {
  href: string;
  label: string;
  match: string; // prefijo para marcar activo
  badge?: string | number;
}

/**
 * Grupo del menú del panel: suelto (con href, sin ítems: Inicio, Estadísticas)
 * o desplegable (con ítems). El grupo se marca activo si su match coincide o
 * si alguno de sus ítems es la página actual.
 */
export interface NavGroup {
  label: string;
  items: NavItem[];
  href?: string;
  match?: string;
}

/** Selector global de torneo del header del panel (viaja con ?t=). */
export interface TournamentPickerData {
  tournaments: { slug: string; name: string; status: string }[];
  /** Torneo marcado como seleccionado (en el panel: el activo). */
  currentSlug?: string;
}

function tournamentPicker(p: TournamentPickerData): string {
  if (p.tournaments.length === 0) return '';
  const options = p.tournaments
    .map((t) => {
      const extra = t.status === 'finished' ? ' (finalizado)' : t.status === 'draft' ? ' (borrador)' : '';
      const sel = t.slug === p.currentSlug ? ' selected' : '';
      return `<option value="${escUrl(t.slug)}"${sel}>${esc(t.name)}${extra}</option>`;
    })
    .join('');
  // Form GET con action vacío: recarga la página actual con ?t=nuevo. Sin JS
  // también funciona (el navegador muestra el botón de enviar del form).
  return `<form class="tpick" method="get" action="" title="Torneo activo">
    ${icon('trophy', 15)}
    <select name="t" aria-label="Torneo activo" onchange="this.form.submit()">${options}</select>
  </form>`;
}

/** Menú del panel con grupos: sueltos como links y desplegables con nav-pop. */
function adminNav(groups: NavGroup[], active: string): string {
  const itemHtml = (n: NavItem) => {
    const badge = n.badge ? ` <span class="badge amber">${esc(String(n.badge))}</span>` : '';
    return `<a href="${escUrl(n.href)}" class="${active === n.match ? 'active' : ''}">${esc(n.label)}${badge}</a>`;
  };
  return groups
    .map((g) => {
      if (g.items.length === 0 && g.href) {
        return itemHtml({ href: g.href, label: g.label, match: g.match ?? '' });
      }
      const groupActive = g.match === active || g.items.some((i) => i.match === active);
      const totalBadge = g.items.reduce((acc, i) => acc + (typeof i.badge === 'number' ? i.badge : 0), 0);
      const badge = totalBadge > 0 ? `<span class="badge amber">${totalBadge}</span>` : '';
      return `<div class="nav-group${groupActive ? ' active' : ''}">
      <button type="button" class="nav-drop${groupActive ? ' active' : ''}" aria-expanded="false" aria-haspopup="true">${esc(g.label)}${badge}<span class="caret" aria-hidden="true">▾</span></button>
      <div class="nav-pop">${g.items.map(itemHtml).join('')}</div>
    </div>`;
    })
    .join('');
}

const BRAND_SVG = `<svg viewBox="0 0 40 44" fill="none" aria-hidden="true">
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" fill="#0e8a4a"/>
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" stroke="#21c063" stroke-width="2.4"/>
  <circle cx="20" cy="19.5" r="7.6" fill="#fff"/>
  <path d="M20 15.7l3.5 2.5-1.3 4.2h-4.4l-1.3-4.2L20 15.7z" fill="#0d1b2a"/>
  <path d="M12.4 19.5l3.3-1.3M27.6 19.5l-3.3-1.3M20 27.1v-4.7" stroke="#0d1b2a" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

/** Subir al cambiar CSS/íconos: versiona la URL y saltea cachés viejas. */
const ASSET_VERSION = '45';

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

/** Lógica del menú de tema (claro/oscuro/automático). La usan el layout
 *  clásico Y el shell del dashboard: sin esto, el botón no abre el menú. */
const THEME_MENU_SCRIPT = `<script>
  (function () {
    var tBtn = document.getElementById('themeToggle');
    var tPop = document.getElementById('themePop');
    if (!tBtn || !tPop) return;
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
  })();
</script>`;

function brandMark(href: string): string {
  return `<a class="brand" href="${escUrl(href)}">
      <span class="brand-logo">${BRAND_SVG}</span>
      <span class="brand-word">Zona<b>Liga</b></span>
    </a>`;
}

function siteFooter(nav: NavItem[], mas?: NavGroup): string {
  const principal = nav.map((n) => `<li><a href="${escUrl(n.href)}">${esc(n.label)}</a></li>`).join('');
  const masItems = mas ? mas.items.map((n) => `<li><a href="${escUrl(n.href)}">${esc(n.label)}</a></li>`).join('') : '';
  return `<footer class="site-footer">
  <div class="container">
    <div class="foot-grid">
      <div class="foot-brand">
        ${brandMark('/')}
        <p>Fixture, resultados, tablas y goleadores al día.</p>
      </div>
      <div class="foot-col">
        <h3>Navegación</h3>
        <ul>${principal}${masItems}</ul>
      </div>
      <div class="foot-col">
        <h3>Accesos</h3>
        <ul>
          <li><a href="/admin">Panel de administración</a></li>
          <li><a href="/delegado">Carga de resultados (delegados)</a></li>
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
  /** Navegación del panel: grupos con dropdown + selector global de torneo. */
  adminGroups?: NavGroup[];
  /** Torneos para el selector global del header del panel. */
  tournaments?: TournamentPickerData;
  /** Grupo desplegable del sitio público ("Más"). */
  mas?: NavGroup;
  /** Slug del torneo actual (?t=) para propagarlo en los enlaces del menú público. */
  tSlug?: string;
  brandHref?: string;
  actions?: string;
}): string {
  const withT = (href: string): string => {
    // Propaga el torneo actual en los links del menú público (solo rutas que
    // aceptan ?t=). Sin ?t= en la página, el link queda como siempre.
    if (!opts.tSlug || opts.isAdmin) return href;
    if (href === '/' ) return `/?t=${escUrl(opts.tSlug)}`;
    if (['/en-vivo', '/fixture', '/posiciones', '/goleadores', '/suspensiones'].includes(href)) {
      return `${href}?t=${escUrl(opts.tSlug)}`;
    }
    return href;
  };
  const masHtml = opts.mas
    ? (() => {
        const items = opts.mas.items
          .map((n) => `<a href="${escUrl(n.href)}" class="${opts.active === n.match ? 'active' : ''}">${esc(n.label)}</a>`)
          .join('');
        const groupActive = opts.mas.items.some((i) => i.match === opts.active);
        return `<div class="nav-group${groupActive ? ' active' : ''}">
      <button type="button" class="nav-drop${groupActive ? ' active' : ''}" aria-expanded="false" aria-haspopup="true">${esc(opts.mas.label)}<span class="caret" aria-hidden="true">▾</span></button>
      <div class="nav-pop">${items}</div>
    </div>`;
      })()
    : '';
  const nav = opts.adminGroups
    ? adminNav(opts.adminGroups, opts.active ?? '')
    : opts.nav
        .map((n) => {
      const badge = n.badge ? ` <span class="badge amber">${esc(String(n.badge))}</span>` : '';
      return `<a href="${escUrl(withT(n.href))}" class="${opts.active === n.match ? 'active' : ''}">${esc(n.label)}${badge}</a>`;
    })
        .join('') + masHtml;
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
    <div class="header-actions">${opts.tournaments ? tournamentPicker(opts.tournaments) : ''}${opts.actions ?? defaultActions(opts.isAdmin ?? false)}${themeMenu()}</div>
  </div>
</header>
<main class="container">
${opts.body}
</main>
${siteFooter(opts.nav, opts.mas)}
<script>
  var t = document.getElementById('navToggle');
  if (t) t.addEventListener('click', function () {
    var open = document.getElementById('mainNav').classList.toggle('open');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  /* Dropdowns del panel: abren al toque, cierran con clic afuera o Escape.
     En móvil, el botón del grupo funciona como acordeón. */
  var drops = [].slice.call(document.querySelectorAll('.nav-group'));
  function closeDrops(except) {
    drops.forEach(function (g) {
      if (g !== except) { g.classList.remove('open'); var b = g.querySelector('.nav-drop'); if (b) b.setAttribute('aria-expanded', 'false'); }
    });
  }
  drops.forEach(function (g) {
    var btn = g.querySelector('.nav-drop');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !g.classList.contains('open');
      closeDrops(g);
      g.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  });
  document.addEventListener('click', function () { closeDrops(null); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrops(null); });
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

/* ===================== Dashboard admin (solo /admin) =====================
   Shell con sidebar + topbar, según el diseño de referencia. Solo lo usa
   el inicio del panel; el resto de /admin/* sigue con el layout clásico.
   Reutiliza adminNav (grupos), tournamentPicker y themeMenu de este módulo. */

export interface DashQuickAction {
  href: string;
  label: string;
  icon: string; // nombre de IconName
  tone: 'green' | 'blue' | 'violet' | 'amber' | 'danger';
}

export interface DashActivityItem {
  icon: string;
  tone: 'green' | 'blue' | 'violet' | 'amber' | 'danger';
  when: string;
  title: string;
  detail: string;
}

export interface DashboardShellOpts {
  title: string;
  active: string;
  groups: NavGroup[];
  picker?: TournamentPickerData;
  torneo?: { name: string; season: string; status: string; slug: string } | null;
  /** Buscador global: action + placeholder (funcionalidad existente). */
  search?: { action: string; placeholder: string };
  pending?: number;
  quickActions?: DashQuickAction[];
  activity?: DashActivityItem[];
  /** Aviso de estado general: títulos + detalle; sin datos, no se muestra. */
  status?: { tone: 'ok' | 'warn'; title: string; detail: string } | null;
  body: string;
}

function dashSideNav(groups: NavGroup[], active: string): string {
  const item = (n: NavItem) => {
    const badge = n.badge ? `<span class="badge amber">${esc(String(n.badge))}</span>` : '';
    return `<a href="${escUrl(n.href)}" class="${active === n.match ? 'active' : ''}">${esc(n.label)}${badge}</a>`;
  };
  return groups
    .map((g) => {
      if (g.items.length === 0 && g.href) {
        return `<nav class="dash-sec">${item({ href: g.href, label: g.label, match: g.match ?? '' })}</nav>`;
      }
      return `<div class="dash-sec"><div class="dash-sec-t">${esc(g.label)}</div>${g.items.map(item).join('')}</div>`;
    })
    .join('');
}

export function dashboardShell(o: DashboardShellOpts): string {
  const side = dashSideNav(o.groups, o.active);
  const quick = (o.quickActions ?? [])
    .map(
      (a) => `<a class="dash-quick" href="${escUrl(a.href)}"><span class="dash-quick-ico q-${a.tone}">${icon(a.icon as 'home', 16)}</span><span>${esc(a.label)}</span></a>`
    )
    .join('');
  const activity = (o.activity ?? [])
    .map(
      (a) => `<div class="dash-act"><span class="dash-act-ico q-${a.tone}">${icon(a.icon as 'home', 13)}</span><span class="dash-act-body"><span class="dash-act-when">${esc(a.when)}</span><strong>${esc(a.title)}</strong><span>${esc(a.detail)}</span></span></div>`
    )
    .join('');
  const torneo = o.torneo
    ? `<a class="dash-torneo" href="/admin/fixture?t=${escUrl(o.torneo.slug)}">
  <span class="dash-torneo-ico">${icon('trophy', 20)}</span>
  <span class="dash-torneo-tx"><strong>${esc(o.torneo.name)}</strong><span class="dash-torneo-status"><span class="dot"></span>${o.torneo.status === 'active' ? 'En curso' : o.torneo.status === 'draft' ? 'Borrador' : 'Finalizado'}</span></span>
  <span class="chev">›</span>
</a>`
    : '';
  const status = o.status
    ? `<div class="dash-status ${o.status.tone === 'ok' ? 'st-ok' : 'st-warn'}">${icon(o.status.tone === 'ok' ? 'shield' : 'bell', 15)}<span><strong>${esc(o.status.title)}</strong><em>${esc(o.status.detail)}</em></span></div>`
    : '';
  const pendingBadge = o.pending ? `<span class="dash-bell-badge">${o.pending}</span>` : '';
  const picker = o.picker ? tournamentPicker(o.picker) : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="theme-color" content="#0d1b2a">
<meta name="description" content="Panel de administración de la liga amateur">
${THEME_BOOTSTRAP}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/img/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
</head>
<body class="dash-body">
<div class="dash-shell">
  <aside class="dash-side" id="dashSide">
    <a class="dash-brand" href="/admin">
      <span class="dash-brand-logo">${BRAND_SVG}</span>
      <span class="dash-brand-tx"><span class="brand-word">Zona<b>Liga</b></span><small>Ligas de fútbol amateur</small></span>
    </a>
    <div class="dash-nav">${side}</div>
    <div class="dash-side-foot">
      <div class="dash-side-promo">
        <span class="dash-promo-ico">${icon('ball', 22)}</span>
        <strong>Tu liga, en un solo lugar</strong>
        <p>Organizá, gestioná y hacé crecer tu torneo de forma simple y eficiente.</p>
      </div>
      <div class="dash-side-user"><span class="dash-avatar">AD</span><span class="dash-user-tx"><strong>Administrador</strong><small>Panel</small></span></div>
    </div>
  </aside>
  <div class="dash-main">
    <header class="dash-top">
      <button type="button" class="dash-burger" id="dashBurger" aria-label="Abrir menú" aria-expanded="false" aria-controls="dashSide">☰</button>
      ${picker ? `<div class="dash-top-pick">${picker}</div>` : ''}
      ${o.search ? `<form class="dash-search" action="${escUrl(o.search.action)}" method="get" role="search"><span class="ic-wrap">${icon('search', 15)}</span><input type="search" name="q" placeholder="${esc(o.search.placeholder)}" aria-label="Buscar"></form>` : ''}
      <div class="dash-top-actions">
        <a class="dash-bell" href="/admin/entregas" title="Entregas pendientes" aria-label="Entregas pendientes">${icon('bell', 17)}${pendingBadge}</a>
        ${themeMenu()}
      </div>
    </header>
    <main class="dash-content">
${o.body}
    </main>
  </div>
</div>
<div class="dash-overlay" id="dashOverlay" hidden></div>
<script>
  var burger = document.getElementById('dashBurger');
  var side = document.getElementById('dashSide');
  var overlay = document.getElementById('dashOverlay');
  function closeSide() { side.classList.remove('open'); overlay.setAttribute('hidden', ''); burger.setAttribute('aria-expanded', 'false'); }
  if (burger) burger.addEventListener('click', function () {
    var open = side.classList.toggle('open');
    if (open) overlay.removeAttribute('hidden'); else closeSide();
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  if (overlay) overlay.addEventListener('click', closeSide);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSide(); });
</script>
${THEME_MENU_SCRIPT}
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
