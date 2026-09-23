// Modo "fecha en vivo": los partidos de hoy, con refresco automático.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateLong } from '../lib/format.ts';
import {
  buildLivePayload,
  leagueNow,
  type LiveMatchView,
  type LivePayload,
  type LiveSide,
} from '../lib/live.ts';
import { eventsForMatches, listPlayers } from '../lib/queries.ts';
import { pendingForTournament } from '../lib/submissions.ts';
import { loadTournamentView, type TournamentView } from '../lib/tournamentView.ts';
import type { Tournament } from '../lib/types.ts';
import { crest, emptyNote, layout } from './components.ts';
import { PUBLIC_NAV } from './public.ts';

/** Cada cuántos segundos se refresca la vista. */
const POLL_SECONDS = 20;

export interface LiveData {
  tournament: Tournament;
  payload: LivePayload;
}

/** Consulta todo lo necesario y arma el payload (compartido por la página y el endpoint). */
export async function liveData(db: D1Database, slug?: string): Promise<LiveData | null> {
  const view = await loadTournamentView(db, { slug });
  if (!view) return null;
  const t = view.tournament;

  const today = leagueNow().date;
  const todayMatches = view.matches.filter((m) => m.played_on === today && m.status !== 'bye');
  const teamIds = new Set<number>();
  for (const m of todayMatches) {
    if (m.home_team_id != null) teamIds.add(m.home_team_id);
    if (m.away_team_id != null) teamIds.add(m.away_team_id);
  }

  // Solo lo del día: eventos (goles para los goleadores) y entregas pendientes.
  const [events, pending, playersByTeam] = await Promise.all([
    eventsForMatches(db, todayMatches.map((m) => m.id)),
    pendingForTournament(db, t.id),
    Promise.all([...teamIds].map((id) => listPlayers(db, id, true))),
  ]);
  const players = playersByTeam.flat();

  // Una entrega por partido: la más reciente (la consulta ya viene ordenada).
  const provisional = new Map<number, { home: number; away: number; by: string; at: string }>();
  for (const p of pending) {
    if (provisional.has(p.match_id)) continue;
    provisional.set(p.match_id, {
      home: p.home_goals,
      away: p.away_goals,
      by: p.delegate_name ? `${p.delegate_name} (${p.team_name})` : p.team_name,
      at: p.updated_at,
    });
  }

  return {
    tournament: t,
    payload: buildLivePayload({ matches: view.matches, teams: view.teams, players, events, provisional }),
  };
}

/* ---------- Render ---------- */

function sideHtml(side: LiveSide, align: 'left' | 'right'): string {
  const inner = `${crest({ short_name: side.short, color: side.color, logo_url: side.logo, name: side.name }, 'sm')}<span class="live-name">${esc(side.name)}</span>`;
  return side.slug
    ? `<a class="live-side ${align}" href="/equipos/${escUrl(side.slug)}">${inner}</a>`
    : `<span class="live-side ${align}">${inner}</span>`;
}

function scoreCell(v: LiveMatchView): string {
  const official = v.phase === 'done';
  if (official) {
    return `<span class="live-goals" data-role="home-goals">${v.home.goals ?? 0}</span>
      <span class="live-dash">-</span>
      <span class="live-goals" data-role="away-goals">${v.away.goals ?? 0}</span>`;
  }
  if (v.provisional) {
    return `<span class="live-goals provisorio" data-role="home-goals">${v.provisional.home}</span>
      <span class="live-dash">-</span>
      <span class="live-goals provisorio" data-role="away-goals">${v.provisional.away}</span>`;
  }
  return `<span class="live-goals muted" data-role="home-goals">–</span>
      <span class="live-dash">-</span>
      <span class="live-goals muted" data-role="away-goals">–</span>`;
}

function matchCard(v: LiveMatchView): string {
  const metaBits = [v.kickoff, v.venue, v.round != null ? `Fecha ${v.round}` : '', v.zone ? `Zona ${v.zone}` : ''].filter(
    (x) => x
  );
  const proviso = `<div class="live-provisional"${v.provisional ? '' : ' hidden'} data-role="provisional">${
    v.provisional
      ? `Marcador provisorio según el delegado · <strong>${esc(v.provisional.by)}</strong> (pendiente de aprobación)`
      : ''
  }</div>`;
  // Siempre presente (aunque sea vacío): así el refresco puede completarlo
  // cuando el resultado se aprueba sin recargar la página.
  const scorersRow = `<div class="live-scorers"${v.phase === 'done' ? '' : ' hidden'}>
      <div data-role="home-scorers">${esc(v.home.scorersText)}</div>
      <div class="right" data-role="away-scorers">${esc(v.away.scorersText)}</div>
    </div>`;
  return `<article class="live-card" data-match="${v.id}" data-phase="${v.phase}">
  <div class="live-top">
    <span class="live-badge ${v.phase}" data-role="phase"><i></i>${esc(v.phaseText)}</span>
    <span class="live-meta">${esc(metaBits.join(' · '))}</span>
  </div>
  <div class="live-body">
    ${sideHtml(v.home, 'left')}
    <div class="live-nums">${scoreCell(v)}</div>
    ${sideHtml(v.away, 'right')}
  </div>
  ${proviso}
  ${scorersRow}
  <a class="live-link" href="/partido/${v.id}">Ver la ficha →</a>
</article>`;
}

function summaryBar(p: LivePayload): string {
  const chips: string[] = [];
  const push = (n: number, label: string, cls: string) => {
    if (n > 0) chips.push(`<span class="badge ${cls}">${n} ${esc(label)}</span>`);
  };
  push(p.summary.playing, p.summary.playing === 1 ? 'en juego' : 'en juego', 'green');
  push(p.summary.done, 'finalizado(s)', 'ghost');
  push(p.summary.upcoming, 'por jugar', 'info');
  push(p.summary.awaiting, 'sin resultado', 'amber');
  push(p.summary.off, 'suspendido(s)', 'red');
  const goals = p.summary.goals > 0 ? `<span class="badge ghost">${p.summary.goals} gol(es)</span>` : '';
  return `<div class="live-summary" data-role="summary">${chips.join(' ')} ${goals}</div>`;
}

export async function livePage(db: D1Database, slug?: string): Promise<string> {
  const data = await liveData(db, slug);
  if (!data) {
    return layout({
      title: 'En vivo',
      active: 'envivo',
      nav: PUBLIC_NAV,
      body: emptyNote('No hay torneo activo'),
    });
  }
  const { tournament, payload } = data;
  const fecha = payload.round != null ? `Fecha ${payload.round}` : 'Fecha en vivo';
  const cards = payload.matches.map(matchCard).join('');

  // Sin partidos hoy no hay nada que refrescar: se avisa cuándo se vuelve a jugar.
  const auto = payload.matches.length > 0;
  const liveNow = payload.summary.playing > 0;
  const nextHint = payload.next
    ? ` La próxima fecha es el ${formatDateLong(payload.next.date)}${
        payload.next.round != null ? ` (Fecha ${payload.next.round})` : ''
      }.`
    : '';
  const countLine = auto
    ? `<strong data-role="count">${payload.summary.total}</strong> partido(s) programado(s). La página se actualiza sola cada ${POLL_SECONDS} segundos.`
    : `Hoy no se juega.${esc(nextHint)}`;

  const body = `
<section class="hero live-hero">
  <div class="hero-kicker">${liveNow ? '🔴 ' : ''}${esc(fecha)}${liveNow ? ' · jugándose ahora' : ''}</div>
  <h1>En vivo</h1>
  <p class="hero-sub">
    ${esc(tournament.name)} · ${esc(formatDateLong(payload.date))} · ${countLine}
  </p>
</section>

${auto
      ? `<section class="block">
  <div class="card">
    <div class="card-head">
      <h2>Estado de la fecha</h2>
      <span class="muted small">Actualizado <span data-role="updated">${esc(payload.time)}</span>
        <span class="live-dot" data-role="status-dot" title="Actualización automática"></span>
      </span>
    </div>
    <div class="card-body">
      ${summaryBar(payload)}
      <div class="flex flex-wrap mt-2">
        <button type="button" class="btn btn-ghost btn-sm" data-role="refresh">↻ Actualizar ahora</button>
        <a class="btn btn-ghost btn-sm" href="/fixture">Ver todo el fixture</a>
        <span class="small faint" data-role="autostate">Actualización automática activa</span>
      </div>
    </div>
  </div>
</section>`
      : ''}

${payload.matches.length > 0
      ? `<section class="block"><div class="live-grid" data-role="matches" id="liveRoot">${cards}</div></section>`
      : `<section class="block"><div class="card"><div class="card-body">
        ${emptyNote('Hoy no hay partidos programados.')}
        <p class="muted small" style="text-align:center;margin-top:0">Acá vas a ver el minuto a minuto el día que se juegue${payload.next ? `, el ${esc(formatDateLong(payload.next.date))}` : ''}.</p>
        <div style="text-align:center"><a class="btn btn-sm" href="/fixture">Ver la próxima fecha</a></div>
      </div></div></section>`}

<section class="block">
  <div class="card"><div class="card-body">
    <strong class="uppercase">Cómo funciona</strong>
    <ul class="hint" style="margin:8px 0 0 18px">
      <li>Los partidos del día se muestran acá y la página se refresca sola cada ${POLL_SECONDS} segundos.</li>
      <li>Mientras el delegado de cada equipo carga el resultado, ves el <strong>marcador provisorio</strong>.</li>
      <li>Cuando el administrador lo aprueba, el marcador pasa a final y queda publicado en toda la liga.</li>
    </ul>
  </div></div>
</section>

<script>
(function () {
  var AUTO = ${auto ? 'true' : 'false'};
  var root = document.getElementById('liveRoot');
  var refresh = document.querySelector('[data-role="refresh"]');
  var autostate = document.querySelector('[data-role="autostate"]');
  var updated = document.querySelector('[data-role="updated"]');
  var summary = document.querySelector('[data-role="summary"]');
  var count = document.querySelector('[data-role="count"]');
  var dot = document.querySelector('[data-role="status-dot"]');
  var INTERVAL = ${POLL_SECONDS} * 1000;
  var timer = null;
  var scores = {};

  // Guarda los marcadores que ya conocemos para resaltar solo lo que cambió.
  document.querySelectorAll('[data-match]').forEach(function (card) {
    var h = card.querySelector('[data-role="home-goals"]');
    var a = card.querySelector('[data-role="away-goals"]');
    scores[card.getAttribute('data-match')] = (h ? h.textContent : '') + '-' + (a ? a.textContent : '');
  });

  function setText(el, value) {
    if (el && value != null && el.textContent !== String(value)) el.textContent = String(value);
  }

  // Igual que el esc() del servidor: lo que viene de la base no se inyecta crudo.
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function flash(el) {
    if (!el) return;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 2200);
  }

  function badge(card, phase, text) {
    var b = card.querySelector('[data-role="phase"]');
    if (!b) return;
    if (card.getAttribute('data-phase') !== phase) card.setAttribute('data-phase', phase);
    b.className = 'live-badge ' + phase;
    if (b.textContent.trim() !== text) b.textContent = text;
  }

  function apply(data) {
    setText(updated, data.time);
    if (dot) dot.classList.add('ok');
    (data.matches || []).forEach(function (m) {
      var card = document.querySelector('[data-match="' + m.id + '"]');
      if (!card) return;
      badge(card, m.phase, m.phaseText);
      var homeGoals = m.home.goals != null ? m.home.goals : (m.provisional ? m.provisional.home : '–');
      var awayGoals = m.away.goals != null ? m.away.goals : (m.provisional ? m.provisional.away : '–');
      var hEl = card.querySelector('[data-role="home-goals"]');
      var aEl = card.querySelector('[data-role="away-goals"]');
      var changed = scores[card.getAttribute('data-match')] !== homeGoals + '-' + awayGoals;
      setText(hEl, homeGoals);
      setText(aEl, awayGoals);
      if (changed) {
        scores[card.getAttribute('data-match')] = homeGoals + '-' + awayGoals;
        flash(hEl);
        flash(aEl);
      }
      var hs = card.querySelector('[data-role="home-scorers"]');
      var as = card.querySelector('[data-role="away-scorers"]');
      if (hs) setText(hs, m.home.scorersText);
      if (as) setText(as, m.away.scorersText);
      if (hs) {
        var row = hs.parentElement;
        if (m.home.scorersText || m.away.scorersText) row.removeAttribute('hidden');
        else row.setAttribute('hidden', '');
      }
      // El aviso de "provisorio" desaparece cuando el resultado se oficializa.
      var prov = card.querySelector('[data-role="provisional"]');
      if (prov) {
        if (m.provisional) {
          prov.innerHTML = 'Marcador provisorio según el delegado · <strong>' + esc(m.provisional.by) +
            '</strong> (pendiente de aprobación)';
          prov.removeAttribute('hidden');
        } else {
          prov.setAttribute('hidden', '');
        }
      }
    });
    if (count) setText(count, data.summary.total);
    if (summary) {
      var parts = [];
      if (data.summary.playing) parts.push('<span class="badge green">' + data.summary.playing + ' en juego</span>');
      if (data.summary.done) parts.push('<span class="badge ghost">' + data.summary.done + ' finalizado(s)</span>');
      if (data.summary.upcoming) parts.push('<span class="badge info">' + data.summary.upcoming + ' por jugar</span>');
      if (data.summary.awaiting) parts.push('<span class="badge amber">' + data.summary.awaiting + ' sin resultado</span>');
      if (data.summary.off) parts.push('<span class="badge red">' + data.summary.off + ' suspendido(s)</span>');
      if (data.summary.goals) parts.push('<span class="badge ghost">' + data.summary.goals + ' gol(es)</span>');
      summary.innerHTML = parts.join(' ');
    }
  }

  function poll() {
    fetch('/api/vivo' + location.search, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        apply(data);
        if (autostate) setText(autostate, 'Actualización automática activa (cada ${POLL_SECONDS}s)');
      })
      .catch(function () { if (autostate) setText(autostate, 'Sin conexión: reintentando…'); });
  }

  function start() {
    stop();
    timer = setInterval(poll, INTERVAL);
    if (autostate) setText(autostate, 'Actualización automática activa (cada ${POLL_SECONDS}s)');
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (autostate) setText(autostate, 'Actualización en pausa (pestaña en segundo plano)');
  }

  // No gastamos requests con la pestaña oculta; al volver, refrescamos enseguida.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (AUTO) { poll(); start(); }
  });
  if (refresh) refresh.addEventListener('click', poll);
  if (dot) dot.classList.add('ok');
  if (AUTO) start();
  else if (autostate) setText(autostate, 'Sin partidos hoy: no hace falta refrescar.');
})();
</script>`;

  return layout({ title: `En vivo — ${tournament.name}`, active: 'envivo', nav: PUBLIC_NAV, body });
}
