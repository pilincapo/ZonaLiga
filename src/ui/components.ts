// Componentes de UI compartidos (SSR por strings, sin JSX para evitar build paso).

import { esc, escUrl } from '../lib/html.ts';
import type { Event, Match, Team } from '../lib/types.ts';
import type { BracketColumn, BracketMatchView } from '../lib/bracket.ts';
import { sourceLabel } from '../lib/bracket.ts';
import { formatDateShort } from '../lib/format.ts';

export interface NavItem {
  href: string;
  label: string;
  match: string; // prefijo para marcar activo
  badge?: string | number;
}

/* ---------- Íconos de línea (SVG inline, sin dependencias) ---------- */

export type IconName =
  | 'search'
  | 'pin'
  | 'trophy'
  | 'users'
  | 'calendar'
  | 'bolt'
  | 'phone'
  | 'shield'
  | 'list'
  | 'whistle'
  | 'monitor';

const ICON_PATHS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/><path d="M12 14v4M8.5 20h7"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.3a3 3 0 0 1 0 5.4M17.5 20a5.6 5.6 0 0 0-1.6-3.9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
  bolt: '<path d="M13.2 2.5L5 13.4h5.3L9.8 21.5 18 10.6h-5.3l.5-8.1z"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 5.5h2M12 18.2h.01"/>',
  shield: '<path d="M12 21.5c4.7-2.3 7-6 7-10.7V5.6L12 2.7 5 5.6v5.2c0 4.7 2.3 8.4 7 10.7z"/><path d="M9 12l2 2 4-4"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
  whistle: '<path d="M14 8.5h6.5v3a5.5 5.5 0 1 1-5.5-5.5H16"/><path d="M13.5 9.5h1"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M9 20.5h6M12 17v3.5"/>',
};

export function icon(name: IconName, size = 18): string {
  const p = ICON_PATHS[name] ?? '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

const BRAND_SVG = `<svg viewBox="0 0 40 44" fill="none" aria-hidden="true">
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" fill="#0e8a4a"/>
  <path d="M20 2.2l15.6 5.6v12.6c0 9.8-6.5 17.2-15.6 20.4C10.9 37.6 4.4 30.2 4.4 20.4V7.8L20 2.2z" stroke="#21c063" stroke-width="2.4"/>
  <circle cx="20" cy="19.5" r="7.6" fill="#fff"/>
  <path d="M20 15.7l3.5 2.5-1.3 4.2h-4.4l-1.3-4.2L20 15.7z" fill="#0d1b2a"/>
  <path d="M12.4 19.5l3.3-1.3M27.6 19.5l-3.3-1.3M20 27.1v-4.7" stroke="#0d1b2a" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

/** Subir al cambiar CSS/íconos: versiona la URL y saltea cachés viejas. */
const ASSET_VERSION = '6';

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
        <p>La pasión del fútbol amateur, bien organizada: fixture, resultados, tablas y goleadores al día.</p>
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
        <p>Mandales el fixture y la tabla a los jugadores por WhatsApp.</p>
        <div class="foot-form">
          <a class="btn btn-primary" id="footShare" target="_blank" rel="noopener" href="https://wa.me/?text=">Compartir por WhatsApp</a>
        </div>
      </div>
    </div>
    <div class="foot-bottom">
      <span>© ${new Date().getFullYear()} ZonaLiga. Todos los derechos reservados.</span>
      <span>Hecho para el fútbol amateur ♥</span>
    </div>
  </div>
</footer>`;
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

function defaultActions(isAdmin: boolean): string {
  if (isAdmin) return `<a class="btn btn-outline btn-sm" href="/">Ver sitio ↗</a>`;
  return `<a class="btn btn-outline btn-sm" href="/delegado">Delegado</a>
    <a class="btn btn-primary btn-sm" href="/admin">Panel</a>`;
}

export function crest(
  team: { name?: string; short_name: string; color: string; logo_url: string } | null | undefined,
  size: '' | 'sm' | 'lg' = ''
): string {
  if (!team) return `<span class="crest ${size}" style="background:#2a3a4d">?</span>`;
  if (team.logo_url) {
    return `<span class="crest ${size}"><img src="${escUrl(team.logo_url)}" alt=""></span>`;
  }
  const short = team.short_name || (team.name ?? '').slice(0, 3).toUpperCase() || '···';
  return `<span class="crest ${size}" style="background:${escUrl(team.color)}">${esc(short)}</span>`;
}

export function teamCell(
  team: { id: number; name: string; slug: string; short_name: string; color: string; logo_url: string } | null | undefined,
  opts: { link?: boolean; placeholder?: string; align?: 'left' | 'right' } = {}
): string {
  const cls = opts.align === 'right' ? 'team-cell away' : 'team-cell';
  if (!team) {
    return `<span class="${cls}"><span class="placeholder">${esc(opts.placeholder ?? 'Por definir')}</span></span>`;
  }
  const name = opts.link === false ? esc(team.name) : `<a href="/equipos/${escUrl(team.slug)}">${esc(team.name)}</a>`;
  return `<span class="${cls}">${crest(team)}<span class="tname">${name}</span></span>`;
}

export function statusTag(m: Match): string {
  if (m.status === 'scheduled') {
    const time = m.kickoff_time ? ` · ${esc(m.kickoff_time)}` : '';
    return `<span class="status-tag scheduled">${formatDateShort(m.played_on) || 'A definir'}${time}</span>`;
  }
  const labels: Record<string, string> = {
    postponed: 'Postergado',
    suspended: 'Suspendido',
    walkover: 'Walkover',
    bye: 'Libre',
    played: 'Jugado',
  };
  return `<span class="status-tag ${m.status}">${labels[m.status] ?? m.status}</span>`;
}

export function matchCenter(m: Match): string {
  if (m.status === 'scheduled') {
    return `<div class="match-center"><span class="score-time">${esc(m.kickoff_time || '')}</span><span class="score-time">${formatDateShort(m.played_on)}</span></div>`;
  }
  if (m.status === 'played' || m.status === 'walkover') {
    return `<div class="match-center"><a class="score" href="/partido/${m.id}">${m.home_goals} - ${m.away_goals}</a><span class="score-time">${formatDateShort(m.played_on)}</span></div>`;
  }
  return `<div class="match-center"><a class="score" style="opacity:.55" href="/partido/${m.id}">- : -</a><span class="score-time">${statusTag(m)}</span></div>`;
}

export function matchRow(
  m: Match,
  teamMap: Map<number, Team>,
  opts: { homePlaceholder?: string; awayPlaceholder?: string } = {}
): string {
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
  return `<div class="match-row">
  ${teamCell(home, { placeholder: opts.homePlaceholder, align: 'left' })}
  ${matchCenter(m)}
  ${teamCell(away, { placeholder: opts.awayPlaceholder, align: 'right' })}
</div>`;
}

export function bracketColumn(col: BracketColumn, teamMap: Map<number, Team>): string {
  const rows = col.matches
    .map((v: BracketMatchView) => {
      const m = v.match;
      const home = m && m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
      const away = m && m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
      const homeName = home
        ? teamCell(home, { align: 'left' })
        : `<span class="team-cell"><span class="placeholder">${esc(sourceLabel(m?.home_source ?? ''))}</span></span>`;
      const awayName = away
        ? teamCell(away, { align: 'right' })
        : `<span class="team-cell away"><span class="placeholder">${esc(sourceLabel(m?.away_source ?? ''))}</span></span>`;
      const center = m
        ? matchCenter(m)
        : `<div class="match-center"><span class="score-time">a definir</span></div>`;
      return `<div class="match-row">${homeName}${center}${awayName}</div>`;
    })
    .join('');
  return `<div class="bracket-col"><h3>${esc(col.title)}</h3>${rows || '<div class="empty-note">Sin partidos</div>'}</div>`;
}

export function eventIcon(type: Event['type']): string {
  const map: Record<string, string> = { goal: '⚽', own_goal: '🔁', yellow: '🟨', red: '🟥' };
  return `<span class="evt ${type}">${map[type] ?? '•'}</span>`;
}

export function eventRow(
  e: Event,
  playerMap: Map<number, { name: string; team_id: number }>,
  teamMap: Map<number, Team>,
  match: Match
): string {
  const p = e.player_id != null ? playerMap.get(e.player_id) : undefined;
  const side = e.team_id === match.home_team_id ? 'left' : 'right';
  const who = p ? `<a href="/jugador/${e.player_id}">${esc(p.name)}</a>` : '<span class="faint">—</span>';
  const min = e.minute != null ? `${e.minute}'` : '';
  const cell =
    side === 'left'
      ? `<span class="when">${min}</span>${eventIcon(e.type)}<span class="grow">${who}</span>`
      : `<span class="grow side-r"><span class="team-cell">${who}</span></span>${eventIcon(e.type)}<span class="when" style="text-align:right">${min}</span>`;
  return `<div class="event-row">${cell}</div>`;
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
