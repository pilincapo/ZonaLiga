// Panel del delegado (móvil primero): acceso por código, partidos y carga de resultado.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import { BRACKET_LABELS } from '../lib/bracket.ts';
import {
  STATUS_LABELS,
  eventCounts,
  hasOfficialResult,
  reviewBadgeClass,
  reviewLabel,
  type SubmissionEventRow,
  type SubmissionRow,
} from '../lib/delegates.ts';
import type { Match, Player, Team } from '../lib/types.ts';
import type { MatchWithTournament, OwnSubmission } from '../lib/submissions.ts';
import { crest, emptyNote, layout, type NavItem } from './components.ts';

const DELEGATE_NAV: NavItem[] = [
  { href: '/delegado', label: 'Mis partidos', match: 'delegado' },
  { href: '/', label: 'Ver la liga ↗', match: 'site' },
];

function delegateLayout(title: string, body: string): string {
  return layout({
    title,
    active: 'delegado',
    nav: DELEGATE_NAV,
    body,
    isAdmin: true,
    brandHref: '/delegado',
    actions: '<a class="btn btn-outline btn-sm" href="/delegado/logout">Salir</a>',
  });
}

function flashMsg(kind: 'error' | 'success', message?: string): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

function roundText(m: Match): string {
  const parts: string[] = [];
  if (m.round != null) parts.push(`Fecha ${m.round}`);
  if (m.bracket_round) parts.push(BRACKET_LABELS[m.bracket_round] ?? m.bracket_round);
  if (m.zone) parts.push(`Zona ${m.zone}`);
  if (m.played_on) parts.push(formatDateShort(m.played_on));
  if (m.kickoff_time) parts.push(m.kickoff_time);
  if (m.venue) parts.push(m.venue);
  return parts.join(' · ');
}

function matchLine(m: Match, teamMap: Map<number, Team>, myTeamId: number): string {
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : undefined;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : undefined;
  const iAmHome = m.home_team_id === myTeamId;
  const mineTeam = iAmHome ? home : away;
  const rival = iAmHome ? away : home;
  const official = hasOfficialResult(m);
  const myScore = official ? `${iAmHome ? m.home_goals : m.away_goals} - ${iAmHome ? m.away_goals : m.home_goals}` : '';
  return `<div class="match-row">
  <span class="team-cell">${crest(mineTeam)}<span class="tname">${esc(mineTeam?.name ?? 'Mi equipo')}</span></span>
  <span class="match-center">
    <span class="score">${official ? `${m.home_goals} - ${m.away_goals}` : '—'}</span>
    <span class="score-time">${official ? `mío: ${esc(myScore)}` : esc(m.kickoff_time || 'sin jugar')}</span>
  </span>
  <span class="team-cell away">${crest(rival)}<span class="tname">${esc(rival?.name ?? 'Por definir')}</span></span>
</div>`;
}

/* ---------- Login ---------- */

export function delegateLoginPage(opts: { error?: string; code?: string; next?: string } = {}): string {
  const body = `
<section class="hero">
  <div class="hero-kicker">ZonaLiga</div>
  <h1>Carga de resultados</h1>
  <p class="hero-sub">Ingresá con el código de tu equipo. Vas a poder cargar el resultado de cada partido y el administrador de la liga lo revisa antes de publicarlo.</p>
</section>
<section class="block"><div class="card form-card"><div class="card-body">
  ${flashMsg('error', opts.error)}
  <form method="post" action="/delegado/login" autocomplete="off">
    <input type="hidden" name="next" value="${escUrl(opts.next ?? '/delegado')}">
    <div class="field">
      <label for="code">Código de delegado</label>
      <input type="text" id="code" name="code" required autofocus inputmode="latin" autocapitalize="characters"
             spellcheck="false" maxlength="16" style="text-transform:uppercase;letter-spacing:3px;font-weight:700"
             value="${esc(opts.code ?? '')}" placeholder="ABCD2345">
      <p class="hint">Te lo da el administrador de la liga. No distingue mayúsculas, espacios ni guiones.</p>
    </div>
    <button class="btn btn-primary" type="submit">Entrar</button>
  </form>
</div></div></section>`;
  return delegateLayout('Carga de resultados', body);
}

/* ---------- Home del delegado ---------- */

export function delegateHomePage(opts: {
  team: Team;
  matches: MatchWithTournament[];
  submissions: OwnSubmission[];
  teamMap: Map<number, Team>;
  msg?: string;
  err?: string;
}): string {
  const { team, matches, submissions, teamMap } = opts;
  const pendingByMatch = new Map<number, OwnSubmission>();
  for (const s of submissions) if (s.review === 'pending') pendingByMatch.set(s.match_id, s);

  const toLoad = matches
    .filter((m) => m.status === 'scheduled' || pendingByMatch.has(m.id))
    .sort((a, b) => (a.played_on || '9999').localeCompare(b.played_on || '9999') || a.id - b.id);
  const history = matches.filter((m) => m.status !== 'scheduled' && !pendingByMatch.has(m.id)).slice(0, 12);
  const rejected = submissions.filter((s) => s.review === 'rejected');

  const cardFor = (m: Match) => {
    const sub = pendingByMatch.get(m.id);
    return `<div class="card" style="margin-bottom:10px">
      ${matchLine(m, teamMap, team.id)}
      <div style="padding:0 16px 14px">
        ${sub ? `<div class="mb-2"><span class="badge ${reviewBadgeClass(sub.review)}">${esc(reviewLabel(sub.review))}</span> <span class="small muted">enviaste ${sub.home_goals} - ${sub.away_goals}</span></div>` : ''}
        <div class="row-between mt-2">
          <span class="small faint">${esc(roundText(m))}</span>
          <a class="btn ${sub ? 'btn-ghost' : 'btn-primary'} btn-sm" href="/delegado/partido/${m.id}">${sub ? 'Editar envío' : 'Cargar resultado'}</a>
        </div>
      </div>
    </div>`;
  };

  const historyRows = history
    .map((m) => {
      const sub = submissions.find((s) => s.match_id === m.id);
      const badge = sub
        ? `<span class="badge ${reviewBadgeClass(sub.review)}">${esc(reviewLabel(sub.review))}</span>`
        : '<span class="faint small">—</span>';
      const rivalId = m.home_team_id === team.id ? m.away_team_id : m.home_team_id;
      const rival = rivalId != null ? teamMap.get(rivalId) : undefined;
      return `<tr>
    <td><span class="small muted">${esc(roundText(m))}</span></td>
    <td><span class="team-cell">${crest(rival, 'sm')}<span>${esc(rival?.name ?? '—')}</span></span></td>
    <td class="num">${hasOfficialResult(m) ? `${m.home_goals}-${m.away_goals}` : esc(STATUS_LABELS[m.status] ?? m.status)}</td>
    <td>${badge}</td>
    <td class="actions-cell"><a class="btn btn-ghost btn-sm" href="/delegado/partido/${m.id}">Ver</a></td>
  </tr>`;
    })
    .join('');

  const body = `
${flashMsg('success', opts.msg)}${flashMsg('error', opts.err)}
<section class="hero" style="padding-bottom:8px">
  <div class="flex" style="gap:14px">
    ${crest(team, 'lg')}
    <div>
      <div class="hero-kicker">Delegado${team.delegate_name ? ` · ${esc(team.delegate_name)}` : ''}</div>
      <h1 style="font-size:clamp(1.4rem,5vw,2rem)">${esc(team.name)}</h1>
    </div>
  </div>
</section>
${rejected.length > 0
      ? `<section class="block"><div class="error-box">Tenés ${rejected.length} entrega(s) rechazada(s). Revisá el motivo y volvé a enviar el resultado.</div></section>`
      : ''}
<section class="block">
  <div class="card-head"><h2>Partidos para cargar</h2><span class="muted small">${toLoad.length}</span></div>
  ${toLoad.length ? toLoad.map(cardFor).join('') : emptyNote('No hay partidos pendientes de cargar 🎉')}
</section>
<section class="block">
  <div class="card">
    <div class="card-head"><h2>Historial</h2></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Fecha</th><th>Rival</th><th class="num">Resultado</th><th>Mi envío</th><th></th></tr></thead>
      <tbody>${historyRows || '<tr><td colspan="5" class="empty-note">Sin partidos jugados todavía</td></tr>'}</tbody>
    </table></div>
  </div>
</section>
<section class="block"><p class="hint">¿Otra persona del equipo va a cargar los resultados? Pedile el código al administrador de la liga.</p></section>`;
  return delegateLayout('Mis partidos', body);
}

/* ---------- Cargar resultado ---------- */

export function delegateMatchPage(opts: {
  team: Team;
  match: Match;
  teamMap: Map<number, Team>;
  roster: Player[];
  pending?: { submission: SubmissionRow; events: SubmissionEventRow[] } | null;
  lastReviewed?: SubmissionRow | null;
  msg?: string;
  err?: string;
}): string {
  const { team, match, teamMap, roster, pending } = opts;
  const home = match.home_team_id != null ? teamMap.get(match.home_team_id) : undefined;
  const away = match.away_team_id != null ? teamMap.get(match.away_team_id) : undefined;
  const official = hasOfficialResult(match);
  const values = pending?.submission ?? null;

  const playerOptions = roster
    .map((p) => `<option value="${p.id}">${p.number != null ? `#${p.number} ` : ''}${esc(p.name)}</option>`)
    .join('');

  const eventsRows = (pending?.events ?? [])
    .map((e) => {
      const p = roster.find((x) => x.id === e.player_id);
      const label =
        e.type === 'goal' ? '⚽ Gol' : e.type === 'own_goal' ? '🔁 En contra' : e.type === 'yellow' ? '🟨 Amarilla' : '🟥 Roja';
      return `<tr>
      <td class="num">${e.minute != null ? `${e.minute}'` : ''}</td>
      <td>${label}</td>
      <td>${esc(p?.name ?? '—')}</td>
      <td class="actions-cell">
        <form method="post" action="/delegado/partido/${match.id}/evento/eliminar" style="display:inline">
          <input type="hidden" name="event_id" value="${e.id}">
          <button class="btn btn-danger btn-sm">✕</button>
        </form>
      </td>
    </tr>`;
    })
    .join('');
  const counts = eventCounts(pending?.events ?? []);

  const body = `
${flashMsg('success', opts.msg)}${flashMsg('error', opts.err)}
<section class="hero" style="padding-bottom:6px">
  <a class="small muted" href="/delegado">← Volver</a>
  <div class="hero-kicker mt-2">${esc(roundText(match))}</div>
  <h1 style="font-size:clamp(1.3rem,5vw,1.9rem)">${esc(home?.name ?? 'Local')} vs ${esc(away?.name ?? 'Visitante')}</h1>
</section>
${official
      ? `<section class="block"><div class="card"><div class="card-body">
      <span class="badge green">Resultado oficial</span>
      <span class="strong"> ${match.home_goals} - ${match.away_goals}</span>
      <p class="hint mb-0">Si está mal, mandá tu corrección: el administrador la evalúa.</p>
    </div></div></section>`
      : ''}
${opts.lastReviewed && opts.lastReviewed.review === 'rejected'
      ? `<section class="block"><div class="error-box">Tu envío anterior fue rechazado${opts.lastReviewed.review_note ? `: ${esc(opts.lastReviewed.review_note)}` : ''}. Corregilo y volvé a enviar.</div></section>`
      : ''}
${pending
      ? `<section class="block"><div class="success-box">Envío pendiente de aprobación (${pending.submission.home_goals} - ${pending.submission.away_goals}). Podés corregirlo mientras el administrador no lo publique.</div></section>`
      : ''}

<section class="block"><div class="card"><div class="card-body">
  <div class="uppercase mb-2">Paso 1 · ${pending ? 'Resultado enviado' : 'Resultado'}</div>
  <form method="post" action="/delegado/partido/${match.id}">
    <div class="form-row">
      <div class="field">
        <label for="status">Estado del partido</label>
        <select id="status" name="status">
          <option value="played" ${!values || values.status === 'played' ? 'selected' : ''}>Se jugó</option>
          <option value="postponed" ${values?.status === 'postponed' ? 'selected' : ''}>Se postergó</option>
          <option value="suspended" ${values?.status === 'suspended' ? 'selected' : ''}>Se suspendió</option>
          <option value="walkover" ${values?.status === 'walkover' ? 'selected' : ''}>Walkover (no se presentó uno)</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="home_goals">Goles ${esc(home?.short_name || home?.name || 'local')}</label>
        <input type="number" id="home_goals" name="home_goals" min="0" max="30" inputmode="numeric" value="${values?.home_goals ?? match.home_goals}">
      </div>
      <div class="field">
        <label for="away_goals">Goles ${esc(away?.short_name || away?.name || 'visitante')}</label>
        <input type="number" id="away_goals" name="away_goals" min="0" max="30" inputmode="numeric" value="${values?.away_goals ?? match.away_goals}">
      </div>
    </div>
    <p class="hint">Local: <strong>${esc(home?.name ?? '—')}</strong> · Visitante: <strong>${esc(away?.name ?? '—')}</strong> · En un walkover el ganador tiene que tener más goles.</p>
    <div class="field"><label for="notes">Notas para el administrador (opcional)</label><input type="text" id="notes" name="notes" maxlength="300" value="${esc(values?.notes ?? '')}"></div>
    <button class="btn btn-primary" type="submit">${pending ? 'Guardar cambios del envío' : 'Enviar al administrador'}</button>
  </form>
</div></div></section>

${pending
      ? `<section class="block"><div class="card"><div class="card-body">
    <div class="uppercase mb-2">Paso 2 · Goles y tarjetas de ${esc(team.name)}</div>
    <p class="hint">Se cargan solo los eventos de tu equipo (${counts.goals} gol/es, ${counts.yellows} amarilla/s, ${counts.reds} roja/s). El rival carga los suyos.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th class="num">Min</th><th>Evento</th><th>Jugador</th><th></th></tr></thead>
      <tbody>${eventsRows || '<tr><td colspan="4" class="empty-note">Sin eventos cargados</td></tr>'}</tbody>
    </table></div>
    <form method="post" action="/delegado/partido/${match.id}/evento" class="mt-3">
      <div class="form-row">
        <div class="field" style="max-width:150px">
          <label for="type">Evento</label>
          <select id="type" name="type">
            <option value="goal">⚽ Gol</option>
            <option value="yellow">🟨 Amarilla</option>
            <option value="red">🟥 Roja</option>
            <option value="own_goal">🔁 Gol en contra</option>
          </select>
        </div>
        <div class="field" style="max-width:100px">
          <label for="minute">Minuto</label>
          <input type="number" id="minute" name="minute" min="0" max="130" inputmode="numeric" placeholder="opcional">
        </div>
        <div class="field grow">
          <label for="player_id">Jugador</label>
          <select id="player_id" name="player_id" required><option value="">Elegí…</option>${playerOptions}</select>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" type="submit">+ Agregar evento</button>
    </form>
  </div></div></section>

  <section class="block">
    <form method="post" action="/delegado/partido/${match.id}/retirar" onsubmit="return confirm('¿Cancelar el envío? El administrador ya no lo va a ver.')">
      <button class="btn btn-ghost btn-sm" type="submit">Cancelar mi envío</button>
    </form>
  </section>`
      : ''}`;
  return delegateLayout('Cargar resultado', body);
}
