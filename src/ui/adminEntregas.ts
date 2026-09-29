// Vistas del admin para revisar las entregas de los delegados.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import { BRACKET_LABELS } from '../lib/bracket.ts';
import {
  STATUS_LABELS,
  differsFromOfficial,
  eventCounts,
  hasOfficialResult,
  reviewLabel,
  type SubmissionEventRow,
} from '../lib/delegates.ts';
import type { Match, Team } from '../lib/types.ts';
import type { PendingSubmissionRow } from '../lib/submissions.ts';
import { listSubmissionsForMatch, submissionEvents } from '../lib/submissions.ts';
import { crest } from './match.ts';
import { emptyNote, icon } from './components.ts';

export interface SubmissionCardData {
  sub: PendingSubmissionRow;
  events: SubmissionEventRow[];
}

function roundText(row: { round: number | null; bracket_round?: string; played_on: string; kickoff_time?: string; venue: string }): string {
  const parts: string[] = [];
  if (row.round != null) parts.push(`Fecha ${row.round}`);
  if (row.bracket_round) parts.push(BRACKET_LABELS[row.bracket_round] ?? row.bracket_round);
  if (row.played_on) parts.push(formatDateShort(row.played_on));
  if (row.kickoff_time) parts.push(row.kickoff_time);
  if (row.venue) parts.push(row.venue);
  return parts.join(' · ');
}

function officialLine(row: PendingSubmissionRow): string {
  if (!hasOfficialResult({ status: row.match_status as Match['status'] })) {
    return '<span class="faint">Sin resultado oficial</span>';
  }
  const label = STATUS_LABELS[row.match_status] ?? row.match_status;
  if (row.match_status === 'played' || row.match_status === 'walkover') {
    return `<span class="badge green">${esc(label)}</span> <span class="strong">${row.match_home_goals} - ${row.match_away_goals}</span>`;
  }
  return `<span class="badge amber">${esc(label)}</span>`;
}

/**
 * Tarjeta de una entrega: propuesta del delegado, eventos, si difiere del
 * resultado oficial y los botones para aprobar (parcial o total) o rechazar.
 */
export function submissionCard(data: SubmissionCardData, teamMap: Map<number, Team>): string {
  const { sub, events } = data;
  const counts = eventCounts(events);
  const team = teamMap.get(sub.team_id);
  const officialStatus = sub.match_status as Match['status'];
  const isOfficial = hasOfficialResult({ status: officialStatus });
  const differs = isOfficial
    ? differsFromOfficial(sub, {
        status: officialStatus,
        home_goals: sub.match_home_goals,
        away_goals: sub.match_away_goals,
      })
    : false;

  const proposed =
    sub.status === 'played' || sub.status === 'walkover'
      ? `<span class="strong">${sub.home_goals} - ${sub.away_goals}</span>`
      : `<span class="badge amber">${esc(STATUS_LABELS[sub.status] ?? sub.status)}</span>`;

  const conflict = !isOfficial
    ? '<span class="badge ghost">Todavía sin resultado oficial</span>'
    : differs
      ? '<span class="badge amber">Difiere del oficial</span>'
      : '<span class="badge green">Coincide con el oficial</span>';

  return `<article class="tcard pcard">
  <span class="tcard-ico pcrest">${crest(team, 'sm')}</span>
  <div class="tcard-tx">
    <div class="tcard-top"><strong>${esc(team?.name ?? 'Equipo')}</strong><span class="badge amber">${esc(reviewLabel('pending'))}</span></div>
    <div class="tcard-meta">
      <span>Delegado: ${esc(sub.delegate_name || 'sin nombre')}</span>
      <span>Enviado: ${esc(sub.updated_at)}</span>
    </div>
    <div class="tcard-meta sub-propose">
      <span>Propone: ${proposed}</span>
      ${conflict}
    </div>
    <div class="tcard-meta">⚽ ${counts.goals} · 🔁 ${counts.ownGoals} · 🟨 ${counts.yellows} · 🟥 ${counts.reds}${sub.notes ? ` · 📝 ${esc(sub.notes)}` : ''}</div>
    <div class="sub-acts">
      <form method="post" action="/admin/entregas/${sub.id}/aprobar">
        <input type="hidden" name="back" value="/admin/entregas">
        <label class="small"><input type="checkbox" name="apply_score" checked style="width:auto"> Aplicar resultado</label>
        <label class="small"><input type="checkbox" name="apply_events" checked style="width:auto"> Aplicar eventos del equipo (${counts.goals + counts.ownGoals + counts.yellows + counts.reds})</label>
        <button class="btn btn-primary btn-sm" type="submit">✓ Aprobar y publicar</button>
      </form>
      <form method="post" action="/admin/entregas/${sub.id}/rechazar">
        <input type="hidden" name="back" value="/admin/entregas">
        <input type="text" name="review_note" maxlength="300" placeholder="Motivo del rechazo (opcional)">
        <button class="btn btn-danger btn-sm" type="submit">✕ Rechazar</button>
      </form>
    </div>
  </div>
</article>`;
}

/** Bandeja: todas las entregas pendientes agrupadas por partido. */
export async function submissionsAdminPage(
  db: D1Database,
  pending: PendingSubmissionRow[],
  eventsBySubmission: Map<number, SubmissionEventRow[]>,
  teamMap: Map<number, Team>,
  msg?: string,
  errMsg?: string
): Promise<string> {
  const byMatch = new Map<number, PendingSubmissionRow[]>();
  for (const s of pending) {
    const arr = byMatch.get(s.match_id);
    if (arr) arr.push(s);
    else byMatch.set(s.match_id, [s]);
  }

  const blocks: string[] = [];
  for (const [matchId, subs] of byMatch) {
    const first = subs[0]!;
    const home = first.home_team_id != null ? teamMap.get(first.home_team_id) : undefined;
    const away = first.away_team_id != null ? teamMap.get(first.away_team_id) : undefined;
    const cards = subs
      .map((s) => submissionCard({ sub: s, events: eventsBySubmission.get(s.id) ?? [] }, teamMap))
      .join('');
    blocks.push(`<section class="block">
  <div class="dash-card entmatch">
    <div class="dash-card-head">
      <h2>${crest(home, 'sm')} ${esc(home?.name ?? 'Local')} <span class="faint" style="font-weight:400">vs</span> ${esc(away?.name ?? 'Visitante')} ${crest(away, 'sm')}</h2>
      <span class="muted small">${esc(roundText(first))}</span>
    </div>
    <div class="entofficial">
      <span>Resultado oficial: ${officialLine(first)}</span>
      <a class="btn btn-ghost btn-sm" href="/admin/planilla/${matchId}">Cargar a mano</a>
    </div>
    ${cards}
    ${subs.length > 1 ? '<div class="entcombo"><strong>Dos entregas para este partido</strong>: podés aprobar las dos y los eventos se combinan (cada equipo aporta los suyos).</div>' : ''}
  </div>
</section>`);
  }

  const body = `
${msg ? `<div class="success-box">${esc(msg)}</div>` : ''}${errMsg ? `<div class="error-box">${esc(errMsg)}</div>` : ''}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Operación</span>
    <h1>Entregas de delegados</h1>
    <p>Los delegados cargan el resultado desde el celular. Nada se publica hasta que lo apruebes acá.</p>
  </div>
  <span class="badge ${pending.length ? 'amber' : 'ghost'}" style="padding:8px 14px;font-size:0.85rem">${pending.length} pendiente${pending.length === 1 ? '' : 's'}</span>
</div>
${blocks.join('') || `<section class="block"><div class="dash-card"><div class="dash-card-body">${emptyNote('No hay entregas pendientes 🎉')}</div></div></section>`}
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('bell', 16)} ¿Cómo funciona?</h2></div>
  <ul class="hint" style="margin:0 0 0 18px">
    <li>Cada equipo tiene un código de acceso: se genera en <a href="/admin/equipos">Equipos</a> → editar equipo.</li>
    <li>El delegado entra en <code>/delegado</code>, carga el resultado y los eventos de su equipo.</li>
    <li>Al aprobar, el resultado pasa a la planilla oficial y aparece en el sitio público.</li>
    <li>Si rechazás, el delegado ve el motivo y puede volver a enviar.</li>
  </ul>
</div></section>`;
  return body;
}

/** Bloque compacto para la planilla de un partido. */
export async function pendingForMatchBlock(
  db: D1Database,
  match: Match,
  teamMap: Map<number, Team>
): Promise<string> {
  const subs = await listSubmissionsForMatch(db, match.id);
  const pending = subs.filter((s) => s.review === 'pending');
  if (pending.length === 0) return '';

  const cards: string[] = [];
  for (const sub of pending) {
    const events = await submissionEvents(db, sub.id);
    const team = teamMap.get(sub.team_id);
    const counts = eventCounts(events);
    cards.push(`<div class="card" style="margin-bottom:10px">
  <div class="card-head">
    <h2 style="font-size:0.95rem">${esc(team?.name ?? 'Equipo')}</h2>
    <span class="badge amber">Entrega pendiente</span>
  </div>
  <div class="card-body">
    <div class="small mb-2">Propone <strong>${sub.home_goals} - ${sub.away_goals}</strong> (${esc(STATUS_LABELS[sub.status] ?? sub.status)}) · ⚽ ${counts.goals} 🟨 ${counts.yellows} 🟥 ${counts.reds}</div>
    <form method="post" action="/admin/entregas/${sub.id}/aprobar">
      <input type="hidden" name="back" value="/admin/planilla/${match.id}">
      <input type="hidden" name="apply_score" value="on">
      <input type="hidden" name="apply_events" value="on">
      <button class="btn btn-primary btn-sm" type="submit">✓ Aprobar</button>
    </form>
  </div>
</div>`);
  }
  return `<div class="card-body" style="border-top:1px solid var(--border)">
  <div class="uppercase mb-2">Entregas de delegados</div>
  ${cards.join('')}
  <a class="small" href="/admin/entregas">Ver todas las entregas →</a>
</div>`;
}
