// Panel de administración.

import { esc, escUrl } from '../lib/html.ts';
import { slugify } from '../lib/slug.ts';
import { parseRules, DEFAULT_RULES, POSITION_ORDER } from '../lib/types.ts';
import type { Match, Rules, Team, Tournament } from '../lib/types.ts';
import { generateDoubleRoundRobin, generateRoundRobin, playedCount, shuffled } from '../lib/fixture.ts';
import { computeSuspensions } from '../lib/suspensions.ts';
import {
  EMPTY_SCHEDULE,
  WEEKDAY_LABELS,
  formatScheduleGaps,
  plannedRoundDate,
  scheduleGaps,
  scheduleOf,
  type TournamentSchedule,
} from '../lib/schedule.ts';
import { BRACKET_LABELS } from '../lib/bracket.ts';
import { formatDateShort } from '../lib/format.ts';
import {
  getMatch,
  getTeam,
  listEvents,
  listPlayers,
  listTeams,
  listTournaments,
} from '../lib/queries.ts';
import {
  countPendingSubmissions,
  matchIdsWithPendingSubmissions,
  pendingSubmissions,
  submissionEvents,
} from '../lib/submissions.ts';
import { scoreFromEvents, MAX_GOALS } from '../lib/sheet.ts';
import { rulesOf } from '../lib/rules.ts';
import { loadTournamentView } from '../lib/tournamentView.ts';
import type { SubmissionEventRow } from '../lib/delegates.ts';
import { delegateShareText, generateDelegateCode } from '../lib/delegates.ts';
import { waLink } from '../lib/share.ts';
import { pendingForMatchBlock, submissionsAdminPage } from './adminEntregas.ts';
import { crest } from './match.ts';
import { layout, type NavItem } from './components.ts';

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Resumen', match: 'admin' },
  { href: '/admin/torneos', label: 'Torneos', match: 'torneos' },
  { href: '/admin/equipos', label: 'Equipos', match: 'equipos' },
  { href: '/admin/jugadores', label: 'Jugadores', match: 'jugadores' },
  { href: '/admin/fixture', label: 'Fixture', match: 'fixture' },
  { href: '/admin/planilla', label: 'Planilla', match: 'planilla' },
  { href: '/admin/entregas', label: 'Entregas', match: 'entregas' },
  { href: '/admin/ajustes', label: 'Puntos', match: 'ajustes' },
  { href: '/admin/suspensiones', label: 'Suspensiones', match: 'suspensiones' },
];

function adminLayout(opts: { title: string; active: string; body: string; pending?: number }): string {
  const nav = opts.pending
    ? ADMIN_NAV.map((item) => (item.match === 'entregas' ? { ...item, badge: opts.pending } : item))
    : ADMIN_NAV;
  return layout({ title: opts.title, active: opts.active, nav, body: opts.body, isAdmin: true });
}

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

function pageHead(title: string, action?: { href: string; label: string }): string {
  const btn = action
    ? `<a class="btn btn-primary btn-sm" href="${escUrl(action.href)}">${esc(action.label)}</a>`
    : '';
  return `<section class="hero" style="padding-bottom:12px">
  <div class="row-between">
    <h1>${esc(title)}</h1>${btn}
  </div>
</section>`;
}

/* ============================== LOGIN ============================== */

export function loginPage(error?: string, next?: string): string {
  const body = `
<section class="hero"><div class="hero-kicker">ZonaLiga</div><h1>Panel de administración</h1></section>
<section class="block"><div class="card form-card">
  <div class="card-body">
    ${flash('error', error)}
    <form method="post" action="/admin/login">
      <input type="hidden" name="next" value="${escUrl(next ?? '/admin')}">
      <div class="field">
        <label for="password">Contraseña</label>
        <input type="password" id="password" name="password" required autofocus autocomplete="current-password">
        <p class="hint">Es la contraseña configurada como secreto ADMIN_PASSWORD en Cloudflare.</p>
      </div>
      <button class="btn btn-primary" type="submit">Entrar</button>
    </form>
  </div>
</div></section>`;
  return adminLayout({ title: 'Ingresar', active: 'login', body });
}

/* ============================== DASHBOARD ============================== */

export async function dashboardPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const [tournaments, teams, pending] = await Promise.all([
    listTournaments(db),
    listTeams(db),
    countPendingSubmissions(db),
  ]);
  const activeView = await loadTournamentView(db);
  const active = activeView?.tournament ?? null;
  let matchStats = { total: 0, played: 0, upcoming: 0 };
  if (activeView) {
    const matches = activeView.matches;
    matchStats = {
      total: matches.filter((m) => m.status !== 'bye').length,
      played: matches.filter((m) => m.status === 'played' || m.status === 'walkover').length,
      upcoming: matches.filter((m) => m.status === 'scheduled').length,
    };
  }

  const stat = (label: string, value: string | number, href?: string) => `
  <a class="card" style="padding:16px;color:var(--text)" ${href ? `href="${escUrl(href)}"` : ''}>
    <div class="hero-kicker">${esc(label)}</div>
    <div style="font-family:var(--font-head);font-size:1.6rem">${esc(String(value))}</div>
  </a>`;

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Resumen', { href: '/admin/torneos/nuevo', label: '+ Nuevo torneo' })}
<section class="block grid-2">
  ${stat('Torneos', tournaments.length, '/admin/torneos')}
  ${stat('Equipos', teams.length, '/admin/equipos')}
  ${stat('Torneo activo', active?.name ?? '—', active ? '/admin/fixture' : undefined)}
  ${stat('Partidos jugados', matchStats.played, '/admin/planilla')}
  ${stat('Entregas pendientes', pending, '/admin/entregas')}
</section>
<section class="block"><div class="card"><div class="card-body">
  <strong>Atajos:</strong>
  <a href="/admin/planilla">cargar un resultado</a> ·
  <a href="/admin/entregas">aprobar entregas de delegados</a> ·
  <a href="/admin/fixture">generar fixture</a> ·
  <a href="/admin/jugadores">cargar plantilla</a>
</div></div></section>`;
  return adminLayout({ title: 'Panel', active: 'admin', body, pending });
}

/* ============================== ENTREGAS DE DELEGADOS ============================== */

export async function entregasAdminPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const [pending, teams] = await Promise.all([pendingSubmissions(db, 60), listTeams(db, true)]);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const eventsBySubmission = new Map<number, SubmissionEventRow[]>();
  for (const sub of pending) {
    eventsBySubmission.set(sub.id, await submissionEvents(db, sub.id));
  }
  const inner = await submissionsAdminPage(db, pending, eventsBySubmission, teamMap, msg, errMsg);
  return adminLayout({ title: 'Entregas', active: 'entregas', body: inner, pending: pending.length });
}

/* ============================== TORNEOS ============================== */

function scheduleFields(schedule: TournamentSchedule): string {
  const list = (items: string[]): string => items.join('\n');
  return `
<div class="form-row">
  <div class="field">
    <label for="venues">Canchas</label>
    <textarea id="venues" name="venues" rows="3" placeholder="Cancha 1&#10;Cancha 2">${esc(list(schedule.venues))}</textarea>
    <p class="hint">Una por línea (máximo 12). Si no cargás canchas, el fixture sale sin cancha asignada.</p>
  </div>
  <div class="field">
    <label for="kickoffs">Horarios de inicio</label>
    <textarea id="kickoffs" name="kickoffs" rows="3" placeholder="10:00&#10;12:00&#10;14:00">${esc(list(schedule.kickoffs))}</textarea>
    <p class="hint">Uno por línea o separados por comas (máximo 12). Acepta “9” o “9:30”.</p>
  </div>
</div>
<div class="form-row">
  <div class="field">
    <label for="start_date">Fecha de inicio</label>
    <input id="start_date" name="start_date" type="date" value="${esc(schedule.startDate)}">
    <p class="hint">Primer día de juego. Al generar el fixture, cada fecha avanza el calendario desde acá.</p>
  </div>
  <div class="field">
    <label for="round_gap">Días entre fechas</label>
    <input id="round_gap" name="round_gap" type="number" min="1" max="30" value="${schedule.roundGapDays}" style="width:100px">
    <p class="hint">7 = cada fecha una semana después. Usá 3 o 4 si jugás a mitad de semana.</p>
  </div>
  <div class="field">
    <label for="play_weekday">Día de juego</label>
    <select id="play_weekday" name="play_weekday">
      <option value="" ${schedule.playWeekday == null ? 'selected' : ''}>Sin preferencia</option>
      ${WEEKDAY_LABELS.map(
        (label, i) => `<option value="${i}" ${schedule.playWeekday === i ? 'selected' : ''}>${label[0]!.toUpperCase() + label.slice(1)}</option>`,
      ).join('')}
    </select>
    <p class="hint">Las fechas se agarran a este día (ej.: sábado).</p>
  </div>
</div>
<p class="hint">Al generar el fixture, los partidos de cada fecha toman su día (según la fecha de inicio y el día de juego) y rotan entre estas canchas y horarios: primera hora en todas las canchas, después la siguiente hora, y así. Si la configuración no alcanza para todos los partidos de una fecha, los últimos repiten horario.</p>`;
}

function rulesFields(rules: Rules): string {
  const f = (name: keyof Rules, label: string, hint?: string) => `
  <div class="field">
    <label for="${name}">${esc(label)}</label>
    <input type="number" step="1" min="0" id="${name}" name="${name}" value="${rules[name] as number}">
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
  </div>`;
  return `
<div class="form-row">
  ${f('win', 'Puntos por victoria')}
  ${f('draw', 'Puntos por empate')}
  ${f('loss', 'Puntos por derrota')}
</div>
<div class="form-row">
  ${f('walkoverGoals', 'Goles en walkover', 'Resultado que se le asienta al ganador de un WO')}
  ${f('redSuspensionMatches', 'Suspensión por roja', 'Partidos de sanción por roja directa')}
</div>
<div class="form-row">
  ${f('yellowAccumulation', 'Amarillas para suspensión', '0 = desactivado')}
  ${f('yellowAccumWindow', 'Ventana de acumulación', 'Últimas N jornadas; 0 = todo el torneo')}
</div>
<div class="field">
  <label><input type="checkbox" name="showAdvanced" ${rules.showAdvanced ? 'checked' : ''}> Fair play y valla menos vencida</label>
  <p class="hint">Muestra la columna FP y los líderes de fair play y valla en la página de Posiciones</p>
</div>`;
}

export async function tournamentsPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  const rows = tournaments
    .map(
      (t) => `<tr>
    <td><a href="/?t=${escUrl(t.slug)}"><strong>${esc(t.name)}</strong></a></td>
    <td>${esc(formatLabel(t.format))}</td>
    <td>${badge(t.status)}</td>
    <td class="actions-cell">
      <a class="btn btn-ghost btn-sm" href="/admin/torneos/${t.id}">Editar</a>
      <form method="post" action="/admin/torneos/${t.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar torneo y todos sus partidos?')">
        <button class="btn btn-danger btn-sm" type="submit">Eliminar</button>
      </form>
    </td>
  </tr>`
    )
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Torneos', { href: '/admin/torneos/nuevo', label: '+ Nuevo torneo' })}
<section class="block"><div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Nombre</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" class="empty-note">Sin torneos. Creá el primero.</td></tr>'}</tbody>
</table></div></div></section>`;
  return adminLayout({ title: 'Torneos', active: 'torneos', body });
}

function badge(status: string): string {
  const cls = status === 'active' ? 'green' : status === 'draft' ? 'amber' : 'ghost';
  const label = status === 'active' ? 'En curso' : status === 'draft' ? 'Borrador' : 'Finalizado';
  return `<span class="badge ${cls}">${label}</span>`;
}

function formatLabel(format: string): string {
  return format === 'round_robin' ? 'Todos contra todos' : format === 'zonas_playoffs' ? 'Zonas + playoffs' : 'Copa';
}

export async function tournamentFormPage(db: D1Database, id?: number, error?: string): Promise<string> {
  let t: Tournament | null = null;
  if (id != null) {
    const { results } = await db.prepare('SELECT * FROM tournaments WHERE id = ?1').bind(id).all<Tournament>();
    t = results?.[0] ?? null;
  }
  const rules = t ? parseRules(t.config) : DEFAULT_RULES;
  const schedule = t ? scheduleOf(t.config) : EMPTY_SCHEDULE;
  const isEdit = t != null;
  const body = `
${flash('error', error)}
${pageHead(isEdit ? `Editar: ${t!.name}` : 'Nuevo torneo')}
<section class="block"><div class="card form-card"><div class="card-body">
  <form method="post" action="${isEdit ? `/admin/torneos/${t!.id}` : '/admin/torneos'}">
    <div class="field">
      <label for="name">Nombre</label>
      <input type="text" id="name" name="name" required value="${esc(t?.name ?? '')}" placeholder="Ej: Copa Barrial 2026">
    </div>
    <div class="form-row">
      <div class="field">
        <label for="season">Temporada</label>
        <input type="text" id="season" name="season" value="${esc(t?.season ?? '')}" placeholder="2026">
      </div>
      <div class="field">
        <label for="status">Estado</label>
        <select id="status" name="status">
          <option value="draft" ${t?.status === 'draft' ? 'selected' : ''}>Borrador</option>
          <option value="active" ${t?.status === 'active' ? 'selected' : ''}>En curso</option>
          <option value="finished" ${t?.status === 'finished' ? 'selected' : ''}>Finalizado</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="format">Formato</label>
      <select id="format" name="format">
        <option value="round_robin" ${t?.format === 'round_robin' ? 'selected' : ''}>Todos contra todos</option>
        <option value="zonas_playoffs" ${t?.format === 'zonas_playoffs' ? 'selected' : ''}>Zonas + playoffs</option>
        <option value="copa" ${t?.format === 'copa' ? 'selected' : ''}>Copa eliminatoria</option>
      </select>
    </div>
    <h3 class="zone-title">Canchas y horarios</h3>
    ${scheduleFields(schedule)}
    <h3 class="zone-title">Reglas de puntuación y sanciones</h3>
    ${rulesFields(rules)}
    <button class="btn btn-primary" type="submit">Guardar</button>
    <a class="btn btn-ghost" href="/admin/torneos">Cancelar</a>
  </form>
</div></div></section>`;
  return adminLayout({ title: isEdit ? 'Editar torneo' : 'Nuevo torneo', active: 'torneos', body });
}

/* ============================== EQUIPOS ============================== */

export async function teamsAdminPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const teams = await listTeams(db, true);
  const rows = teams
    .map(
      (tm) => `<tr>
    <td><a href="/equipos/${escUrl(tm.slug)}"><strong>${esc(tm.name)}</strong></a></td>
    <td>${esc(tm.short_name)}</td>
    <td><span class="crest sm" style="background:${escUrl(tm.color)}">${esc(tm.short_name || '···')}</span></td>
    <td>${tm.active ? '' : '<span class="badge ghost">Inactivo</span>'}</td>
    <td class="actions-cell">
      <a class="btn btn-ghost btn-sm" href="/admin/equipos/${tm.id}">Editar</a>
      <form method="post" action="/admin/equipos/${tm.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar equipo? Se borran sus jugadores.')">
        <button class="btn btn-danger btn-sm" type="submit">Eliminar</button>
      </form>
    </td>
  </tr>`
    )
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Equipos', { href: '/admin/equipos/nuevo', label: '+ Nuevo equipo' })}
<section class="block"><div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Nombre</th><th>Corto</th><th>Color</th><th></th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty-note">Sin equipos todavía.</td></tr>'}</tbody>
</table></div></div></section>`;
  return adminLayout({ title: 'Equipos', active: 'equipos', body });
}

/** Bloque de delegado del equipo: nombre, habilitación, código y compartir. */
function delegateSection(team: Team, origin: string): string {
  const code = team.delegate_code;
  const url = `${origin}/delegado`;
  const shareHref = code ? waLink(delegateShareText(team.name, code, url)) : '';
  return `<div style="border-top:1px solid var(--border);margin-top:18px;padding-top:16px">
  <div class="uppercase mb-2">Delegado del equipo</div>
  <form method="post" action="/admin/equipos/${team.id}/delegado">
    <div class="form-row">
      <div class="field grow">
        <label for="delegate_name">Nombre del delegado</label>
        <input type="text" id="delegate_name" name="delegate_name" maxlength="80" value="${esc(team.delegate_name)}" placeholder="Ej: Juan Pérez">
      </div>
      <div class="field" style="max-width:240px">
        <label>Acceso</label>
        <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0">
          <input type="checkbox" name="delegate_enabled" ${team.delegate_enabled ? 'checked' : ''} style="width:auto"> Puede cargar resultados
        </label>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" type="submit">Guardar delegado</button>
  </form>
  <div class="mt-3">
    <p class="hint mb-2">Código de acceso: <strong style="letter-spacing:2px">${esc(code ?? 'sin generar')}</strong></p>
    <form method="post" action="/admin/equipos/${team.id}/delegado/codigo" style="display:inline">
      <button class="btn btn-ghost btn-sm" type="submit">${code ? 'Regenerar código' : 'Generar código'}</button>
    </form>
    ${code
      ? `<form method="post" action="/admin/equipos/${team.id}/delegado/revocar" style="display:inline" onsubmit="return confirm('¿Revocar el acceso del delegado?')">
      <button class="btn btn-danger btn-sm" type="submit">Revocar</button></form>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${escUrl(shareHref)}">📲 Enviar código por WhatsApp</a>`
      : ''}
    <p class="hint">El delegado entra en <code>${esc(url)}</code>, carga el resultado de los partidos de su equipo y todo queda pendiente de tu aprobación.</p>
  </div>
</div>`;
}

export async function teamFormPage(db: D1Database, id?: number, error?: string, origin = ''): Promise<string> {
  let tm: Team | null = null;
  if (id != null) tm = await getTeam(db, id);
  const isEdit = tm != null;
  const delegateBlock = isEdit ? delegateSection(tm!, origin) : '';
  const body = `
${flash('error', error)}
${pageHead(isEdit ? `Editar: ${tm!.name}` : 'Nuevo equipo')}
<section class="block"><div class="card form-card"><div class="card-body">
  <form method="post" action="${isEdit ? `/admin/equipos/${tm!.id}` : '/admin/equipos'}">
    <div class="form-row">
      <div class="field">
        <label for="name">Nombre</label>
        <input type="text" id="name" name="name" required value="${esc(tm?.name ?? '')}">
      </div>
      <div class="field">
        <label for="short_name">Nombre corto (3 letras)</label>
        <input type="text" id="short_name" name="short_name" maxlength="4" value="${esc(tm?.short_name ?? '')}" placeholder="ALM">
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="color">Color de camiseta</label>
        <input type="color" id="color" name="color" value="${esc(tm?.color ?? '#22c55e')}" style="height:42px;padding:4px">
      </div>
      <div class="field">
        <label for="logo_url">Escudo (URL opcional)</label>
        <input type="url" id="logo_url" name="logo_url" value="${esc(tm?.logo_url ?? '')}" placeholder="https://...">
      </div>
    </div>
    <div class="field">
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0">
        <input type="checkbox" name="active" ${!tm || tm.active ? 'checked' : ''} style="width:auto"> Activo
      </label>
    </div>
    <button class="btn btn-primary" type="submit">Guardar</button>
    <a class="btn btn-ghost" href="/admin/equipos">Cancelar</a>
  </form>
  ${delegateBlock}
</div></div></section>`;
  return adminLayout({ title: isEdit ? 'Editar equipo' : 'Nuevo equipo', active: 'equipos', body });
}

/* ============================== JUGADORES ============================== */

export async function playersAdminPage(db: D1Database, selectedTeamId?: number, msg?: string, errMsg?: string): Promise<string> {
  const teams = await listTeams(db, true);
  const selectedId = selectedTeamId ?? teams[0]?.id;
  const players = selectedId != null ? await listPlayers(db, selectedId, true) : [];

  const teamOptions = teams
    .map(
      (tm) =>
        `<option value="${tm.id}" ${tm.id === selectedId ? 'selected' : ''}>${esc(tm.name)}</option>`
    )
    .join('');

  const positionOptions = (selected: string) =>
    ['', ...POSITION_ORDER]
      .map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p || '—'}</option>`)
      .join('');

  const rows = players
    .map(
      (p) => `<tr>
    <td class="num">${p.number ?? ''}</td>
    <td><strong>${esc(p.name)}</strong></td>
    <td>${esc(p.position || '—')}</td>
    <td>${p.active ? '' : '<span class="badge ghost">Baja</span>'}</td>
    <td class="actions-cell">
      <form method="post" action="/admin/jugadores/${p.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar jugador?')">
        <button class="btn btn-danger btn-sm" type="submit">Eliminar</button>
      </form>
    </td>
  </tr>`
    )
    .join('');

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Jugadores')}
<section class="block"><div class="card"><div class="card-body">
  <form method="get" action="/admin/jugadores" class="form-row">
    <div class="field grow">
      <label>Equipo</label>
      <select name="team" onchange="this.form.submit()">${teamOptions || '<option value="">Sin equipos — cargá equipos primero</option>'}</select>
    </div>
  </form>
  ${selectedId != null
    ? `<form method="post" action="/admin/jugadores">
    <input type="hidden" name="team_id" value="${selectedId}">
    <div class="form-row">
      <div class="field grow"><label>Nombre</label><input type="text" name="name" required placeholder="Nombre y apellido"></div>
      <div class="field" style="max-width:90px"><label>#</label><input type="number" name="number" min="1" max="99"></div>
      <div class="field" style="max-width:110px"><label>Posición</label><select name="position">${positionOptions('')}</select></div>
    </div>
    <button class="btn btn-primary" type="submit">+ Agregar jugador</button>
  </form>`
    : ''}
</div></div></section>
<section class="block"><div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>#</th><th>Jugador</th><th>Pos</th><th></th><th></th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty-note">Sin jugadores en este equipo.</td></tr>'}</tbody>
</table></div></div></section>`;
  return adminLayout({ title: 'Jugadores', active: 'jugadores', body });
}

/* ============================== FIXTURE ============================== */

export async function fixtureAdminPage(db: D1Database, slugParam: string | undefined, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout({ title: 'Fixture', active: 'fixture', body: `${pageHead('Fixture')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  const view = await loadTournamentView(db, { id: t.id, includeInactiveTeams: true });
  const matches = view?.matches ?? [];
  const teams = view?.teams ?? [];
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));

  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    if (m.round == null) continue;
    const arr = byRound.get(m.round);
    if (arr) arr.push(m);
    else byRound.set(m.round, [m]);
  }
  const roundKeys = [...byRound.keys()].sort((a, b) => a - b);

  // Aviso: si alguna fecha tiene más partidos que slots configurados.
  const gaps = scheduleGaps(
    scheduleOf(t.config),
    roundKeys.map((round) => ({ round, count: byRound.get(round)!.length }))
  );
  const gapsNote = gaps.length ? `<div class="warning-box">${esc(formatScheduleGaps(gaps))}</div>` : '';

  // Guardia contra pisar resultados: con partidos jugados (o torneo
  // finalizado), "Generar" queda deshabilitado y se explica por qué.
  const jugados = playedCount(matches);
  const genBlocked = jugados > 0 || t.status === 'finished';
  const blockNote =
    jugados > 0
      ? `<div class="warning-box">Hay ${jugados} partido(s) con resultado cargado: “Generar” está deshabilitado para no pisarlos. Usá “Regenerar cruce” para rearmar solo los pendientes.</div>`
      : t.status === 'finished'
        ? '<div class="warning-box">Torneo finalizado: “Generar” está deshabilitado. Cambialo a activo para regenerar el fixture.</div>'
        : '';

  const roundSections = roundKeys
    .map((r) => {
      const list = byRound.get(r)!;
      const rows = list
        .map((m) => {
          const h = m.home_team_id != null ? teamMap.get(m.home_team_id)?.name : (m.home_source ? `→ ${m.home_source}` : 'Por definir');
          const a = m.away_team_id != null ? teamMap.get(m.away_team_id)?.name : (m.away_source ? `→ ${m.away_source}` : 'Por definir');
          return `<tr>
      <td class="num">${m.id}</td>
      <td>${esc(h ?? 'Por definir')} <span class="faint">vs</span> ${esc(a ?? 'Por definir')}</td>
      <td>${esc(m.zone || '')}${m.bracket_round ? ' ' + esc(BRACKET_LABELS[m.bracket_round] ?? m.bracket_round) : ''}</td>
      <td>${m.played_on ? esc(formatDateShort(m.played_on)) : ''} ${esc(m.kickoff_time || '')}</td>
      <td>${esc(m.venue || '')}</td>
      <td class="actions-cell">
        <a class="btn btn-ghost btn-sm" href="/admin/planilla/${m.id}">Planilla</a>
        <form method="post" action="/admin/fixture/${m.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar partido?')">
          <button class="btn btn-danger btn-sm">✕</button>
        </form>
      </td>
    </tr>`;
        })
        .join('');
      return `<h3 class="zone-title">Fecha ${r}</h3><div class="card"><div class="table-wrap"><table class="data">
    <thead><tr><th>ID</th><th>Partido</th><th>Zona / Ronda</th><th>Día y hora</th><th>Cancha</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
    })
    .join('');

  const body = `
${flash('success', msg)}${flash('error', errMsg)}${blockNote}${gapsNote}
${pageHead(`Fixture — ${t.name}`, { href: `/admin/fixture/nuevo?t=${t.slug}`, label: '+ Partido suelto' })}
<section class="block"><div class="card"><div class="card-body">
  <form method="post" action="/admin/fixture/generar" class="form-row">
    <input type="hidden" name="tournament_id" value="${t.id}">
    <div class="field grow">
      <label>Generar fixture automático</label>
      <select name="mode">
        <option value="single">Ida (una vuelta)</option>
        <option value="double">Ida y vuelta</option>
      </select>
    </div>
    <div class="field" style="align-self:flex-end">
      <span style="display:flex;gap:8px">
        <button class="btn btn-primary" type="submit" ${genBlocked ? 'disabled' : ''} onclick="return confirm('Esto reemplaza TODO el fixture (los partidos jugados se pierden). ¿Continuar?')">Generar</button>
        <button class="btn btn-ghost" type="submit" formaction="/admin/fixture/regenerar" onclick="return confirm('Se rearman SOLO los cruces pendientes: los partidos jugados y sus resultados quedan intactos. ¿Continuar?')">↻ Regenerar cruce</button>
      </span>
    </div>
  </form>
  <p class="hint">Usa los equipos activos (${teams.filter((x) => x.active).length}). <strong>Generar</strong> arma todo de cero. <strong>Regenerar cruce</strong> es para cuando entró un equipo nuevo o cambió un participante a mitad de torneo: conserva lo jugado, rearma los pendientes y avisa si algún partido nuevo chocaría con uno ya jugado (cruces repetidos, equipo en dos partidos de la misma fecha o cancha doblemente reservada).</p>
</div></div></section>
<section class="block"><div class="card"><div class="card-body">
  <strong>Orden de partidos por fecha:</strong> <a href="/admin/fechas?t=${escUrl(t.slug)}">asignar día, hora y cancha →</a>
</div></div></section>
${roundSections || '<section class="block"><div class="card"><div class="card-body">Fixture vacío. Generá uno automático o agregá partidos.</div></div></section>'}`;
  return adminLayout({ title: 'Fixture', active: 'fixture', body });
}

export async function matchFormPage(
  db: D1Database,
  slugParam: string | undefined,
  matchId?: number,
  error?: string
): Promise<string> {
  const tournaments = await listTournaments(db);
  const teams = await listTeams(db, true);
  const m = matchId != null ? await getMatch(db, matchId) : null;
  const t = m ? tournaments.find((x) => x.id === m.tournament_id) : (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0];

  const teamOptions = (selected: number | null | undefined) =>
    `<option value="" ${selected == null ? 'selected' : ''}>Por definir</option>` +
    teams
      .map((tm) => `<option value="${tm.id}" ${tm.id === selected ? 'selected' : ''}>${esc(tm.name)}</option>`)
      .join('');

  const body = `
${flash('error', error)}
${pageHead(m ? `Editar partido #${m.id}` : 'Nuevo partido')}
<section class="block"><div class="card form-card"><div class="card-body">
  <form method="post" action="${m ? `/admin/fixture/${m.id}` : '/admin/fixture/nuevo'}">
    <div class="field">
      <label>Torneo</label>
      <select name="tournament_id">${tournaments
        .map((x) => `<option value="${x.id}" ${t && x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select>
    </div>
    <div class="form-row">
      <div class="field"><label>Fecha (jornada)</label><input type="number" name="round" min="1" value="${m?.round ?? ''}"></div>
      <div class="field"><label>Zona</label><input type="text" name="zone" value="${esc(m?.zone ?? '')}" placeholder="A, B, …"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Local</label><select name="home_team_id">${teamOptions(m?.home_team_id)}</select></div>
      <div class="field"><label>Visitante</label><select name="away_team_id">${teamOptions(m?.away_team_id)}</select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Día</label><input type="date" name="played_on" value="${esc(m?.played_on ?? '')}"></div>
      <div class="field"><label>Hora</label><input type="time" name="kickoff_time" value="${esc(m?.kickoff_time ?? '')}"></div>
      <div class="field"><label>Cancha</label><input type="text" name="venue" value="${esc(m?.venue ?? '')}"></div>
    </div>
    <div class="form-row">
      <div class="field">
        <label>Estado</label>
        <select name="status">
          ${['scheduled', 'played', 'postponed', 'suspended', 'walkover']
            .map((s) => `<option value="${s}" ${m?.status === s ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
      </div>
    </div>
    <p class="hint">El resultado y los goles se cargan desde la <a href="/admin/planilla${m ? `/${m.id}` : ''}">planilla del partido</a>.</p>
    <button class="btn btn-primary" type="submit">Guardar</button>
    <a class="btn btn-ghost" href="/admin/fixture">Cancelar</a>
  </form>
</div></div></section>`;
  return adminLayout({ title: 'Partido', active: 'fixture', body });
}

/* ============================== PLANILLA (carga de resultado) ============================== */

export async function sheetListPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout({ title: 'Planilla', active: 'planilla', body: `${pageHead('Planilla')}<div class="card"><div class="card-body">Primero creá un torneo y su fixture.</div></div>` });
  }
  const t = tournaments[0]!;
  const [view, pendingMatches] = await Promise.all([
    loadTournamentView(db, { id: t.id, includeInactiveTeams: true }),
    matchIdsWithPendingSubmissions(db),
  ]);
  const matches = view?.matches ?? [];
  const teams = view?.teams ?? [];
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));

  const pending = matches
    .filter((m) => m.status !== 'played' && m.status !== 'walkover' && m.status !== 'bye')
    .sort((a, b) => (a.played_on || '9999').localeCompare(b.played_on || '9999') || a.id - b.id);
  const done = matches
    .filter((m) => m.status === 'played' || m.status === 'walkover')
    .sort((a, b) => (b.played_on || '').localeCompare(a.played_on || '') || b.id - a.id)
    .slice(0, 20);

  const row = (m: Match) => {
    const h = m.home_team_id != null ? teamMap.get(m.home_team_id) : null;
    const a = m.away_team_id != null ? teamMap.get(m.away_team_id) : null;
    const score = m.status === 'played' || m.status === 'walkover' ? `${m.home_goals}-${m.away_goals}` : (m.kickoff_time || '');
    return `<tr>
    <td><span class="muted small">${m.round != null ? 'F' + m.round : ''}${m.bracket_round ? ' · ' + esc(BRACKET_LABELS[m.bracket_round] ?? '') : ''}</span></td>
    <td><div class="flex">${crest(h, 'sm')} ${esc(h?.name ?? 'Por definir')} <span class="faint">vs</span> ${esc(a?.name ?? 'Por definir')} ${crest(a, 'sm')}${pendingMatches.has(m.id) ? ' <span class="badge amber">Entrega</span>' : ''}</div></td>
    <td class="num">${esc(score)}</td>
    <td>${m.played_on ? esc(formatDateShort(m.played_on)) : ''}</td>
    <td class="actions-cell"><a class="btn btn-primary btn-sm" href="/admin/planilla/${m.id}">Cargar planilla</a></td>
  </tr>`;
  };

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Planillas')}
<section class="block"><div class="card">${`<div class="card-head"><h2>Pendientes</h2><span class="muted small">${pending.length} partidos</span></div>`}
  <div class="table-wrap"><table class="data">
  <thead><tr><th></th><th>Partido</th><th class="num">Res.</th><th>Día</th><th></th></tr></thead>
  <tbody>${pending.map(row).join('') || '<tr><td colspan="5" class="empty-note">Nada pendiente 🎉</td></tr>'}</tbody>
  </table></div>
</div></section>
<section class="block"><div class="card">
  <div class="card-head"><h2>Últimos cargados</h2><span class="muted small">${esc(t.name)}</span></div>
  <div class="table-wrap"><table class="data">
  <thead><tr><th></th><th>Partido</th><th class="num">Res.</th><th>Día</th><th></th></tr></thead>
  <tbody>${done.map(row).join('') || '<tr><td colspan="5" class="empty-note">Todavía no hay resultados.</td></tr>'}</tbody>
  </table></div>
</div></section>`;
  return adminLayout({ title: 'Planilla', active: 'planilla', body });
}

export async function sheetPage(db: D1Database, matchId: number, msg?: string, error?: string): Promise<string> {
  const m = await getMatch(db, matchId);
  if (!m) {
    return adminLayout({ title: 'Planilla', active: 'planilla', body: `${pageHead('Planilla')}<div class="error-box">Partido inexistente.</div>` });
  }
  const [teams, events] = await Promise.all([listTeams(db, true), listEvents(db, m.id)]);
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : null;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : null;

  const [homePlayers, awayPlayers] = await Promise.all([
    home ? listPlayers(db, home.id, true) : Promise.resolve([]),
    away ? listPlayers(db, away.id, true) : Promise.resolve([]),
  ]);

  const playerOptions = (list: typeof homePlayers) =>
    list
      .map((p) => `<option value="${p.id}">${p.number != null ? `#${p.number} ` : ''}${esc(p.name)}</option>`)
      .join('');

  const evRows = (side: 'home' | 'away') => {
    const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
    const list = events.filter((e) => e.team_id === teamId);
    return list
      .map(
        (e) => `<tr>
      <td>${e.minute != null ? `${e.minute}'` : ''}</td>
      <td>${e.type === 'goal' ? '⚽ Gol' : e.type === 'own_goal' ? '🔁 En contra' : e.type === 'yellow' ? '🟨 Amarilla' : '🟥 Roja'}</td>
      <td>${(() => {
        const p = e.player_id;
        const all = [...homePlayers, ...awayPlayers];
        const pl = p != null ? all.find((x) => x.id === p) : null;
        return pl ? esc(pl.name) : '—';
      })()}</td>
      <td class="actions-cell">
        <form method="post" action="/admin/planilla/${m.id}/evento/eliminar" style="display:inline">
          <input type="hidden" name="event_id" value="${e.id}">
          <button class="btn btn-danger btn-sm">✕</button>
        </form>
      </td>
    </tr>`
      )
      .join('');
  };

  const evForm = (side: 'home' | 'away') => {
    const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
    const label = side === 'home' ? (home?.name ?? 'Local') : (away?.name ?? 'Visitante');
    const players = side === 'home' ? homePlayers : awayPlayers;
    // Una lista por gol (hasta el tope): se muestran según la cantidad elegida.
    const goalList = (i: number) => {
      const opts = [
        '<option value="">Elegí…</option>',
        `<option value="own">🔁 En contra (gol para ${esc(label)})</option>`,
        ...players.map((p) => `<option value="${p.id}">${p.number != null ? `#${p.number} ` : ''}${esc(p.name)}</option>`),
      ].join('');
      return `<div class="field" data-pick hidden><label>Gol ${i + 1}</label><select name="g${i + 1}">${opts}</select></div>`;
    };
    const pickLists = players.length ? Array.from({ length: MAX_GOALS }, (_, i) => goalList(i)).join('') : '';
    return `<div class="card-body">
  <h3 class="zone-title">${esc(label)}</h3>
  <form method="post" action="/admin/planilla/${m.id}/goles" data-goal-form>
    <input type="hidden" name="team_id" value="${teamId ?? ''}">
    <strong class="uppercase">Carga rápida de goles</strong>
    <div class="field mt-3">
      <label>¿Cuántos goles hizo?</label>
      <div class="goal-count">
        ${['1', '2', '3', '4']
          .map(
            (v) =>
              `<label class="radio-chip"><input type="radio" name="count" value="${v}" ${v === '1' ? 'checked' : ''}> ${v}</label>`
          )
          .join('')}
        <label class="radio-chip"><input type="radio" name="count" value="more"> Más</label>
        <input type="number" name="count_more" min="5" max="20" value="5" style="width:72px" title="Cantidad si elegís Más">
      </div>
    </div>
    <div class="field">
      <label>¿Quién los hizo?</label>
      <div class="goal-picks">${pickLists}</div>
      ${players.length ? '' : '<p class="hint">Sin jugadores: sumalos en la sección Jugadores.</p>'}
    </div>
    <p class="hint">Con “En contra” el gol suma para ${esc(label)}. Si un jugador hizo más de un gol, elegilo en dos listas.</p>
    <button class="btn btn-primary btn-sm" type="submit">⚽ Cargar goles</button>
  </form>
  <script>
    (function () {
      var form = document.querySelector('form[data-goal-form]');
      if (!form) return;
      var radios = form.querySelectorAll('input[name="count"]');
      var lists = form.querySelectorAll('[data-pick]');
      var sync = function () {
        var n = 1;
        for (var i = 0; i < radios.length; i++) {
          if (radios[i].checked) { n = radios[i].value === 'more' ? lists.length : parseInt(radios[i].value, 10); break; }
        }
        for (var j = 0; j < lists.length; j++) lists[j].hidden = j >= n;
      };
      for (var r = 0; r < radios.length; r++) radios[r].addEventListener('change', sync);
      sync();
    })();
  </script>
  <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
  <form method="post" action="/admin/planilla/${m.id}/evento">
    <input type="hidden" name="team_id" value="${teamId ?? ''}">
    <div class="form-row">
      <div class="field" style="max-width:130px">
        <label>Evento</label>
        <select name="type">
          <option value="goal">⚽ Gol</option>
          <option value="own_goal">🔁 En contra</option>
          <option value="yellow">🟨 Amarilla</option>
          <option value="red">🟥 Roja</option>
        </select>
      </div>
      <div class="field" style="max-width:90px"><label>Min (opt.)</label><input type="number" name="minute" min="0" max="130"></div>
      <div class="field grow"><label>Jugador</label><select name="player_id" required><option value="">Elegí…</option>${playerOptions(players)}</select></div>
    </div>
    <button class="btn btn-ghost btn-sm" type="submit">+ Agregar evento</button>
  </form>
  <div class="mt-3"><div class="table-wrap"><table class="data">
    <thead><tr><th>Min</th><th>Evento</th><th>Jugador</th><th></th></tr></thead>
    <tbody>${evRows(side) || '<tr><td colspan="4" class="empty-note">Sin eventos</td></tr>'}</tbody>
  </table></div></div>
</div>`;
  };

  const submissionsBlock = await pendingForMatchBlock(db, m, teamMap);
  // Marcador derivado de los eventos: la fuente de verdad de los goles es la
  // carga de abajo; acá solo se muestra y se explica.
  const goalsScore = scoreFromEvents(
    events.map((e) => ({ teamId: e.team_id, type: e.type })),
    m.home_team_id,
    m.away_team_id
  );
  const body = `
${flash('success', msg)}${flash('error', error)}
${pageHead(`Planilla · ${home?.name ?? 'Por definir'} vs ${away?.name ?? 'Por definir'}`, { href: `/partido/${m.id}`, label: 'Ver ficha pública ↗' })}
<section class="block"><div class="card"><div class="card-body">
  <form method="post" action="/admin/planilla/${m.id}">
    <div class="form-row">
      <div class="field">
        <label>Estado del partido</label>
        <select name="status">
          ${['scheduled', 'played', 'postponed', 'suspended', 'walkover']
            .map((s) => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${{ scheduled: 'Programado', played: 'Jugado', postponed: 'Postergado', suspended: 'Suspendido', walkover: 'Walkover' }[s] ?? s}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field"><label>Fecha jugado</label><input type="date" name="played_on" value="${esc(m.played_on ?? '')}"></div>
      <div class="field"><label>Hora</label><input type="time" name="kickoff_time" value="${esc(m.kickoff_time ?? '')}"></div>
      <div class="field"><label>Cancha</label><input type="text" name="venue" value="${esc(m.venue ?? '')}"></div>
    </div>
    <p class="hint" style="margin:4px 0 0"><strong>Marcador:</strong> ${esc(home?.name ?? 'Local')} ${goalsScore.home} — ${goalsScore.away} ${esc(away?.name ?? 'Visitante')} <span class="faint">(se arma solo con los goles y en contra cargados abajo)</span></p>
    <div class="form-row">
      <div class="field"><label>Puntos local (override)</label><input type="number" name="home_points" min="0" max="3" value="${m.home_points ?? ''}" placeholder="auto"></div>
      <div class="field"><label>Puntos visitante (override)</label><input type="number" name="away_points" min="0" max="3" value="${m.away_points ?? ''}" placeholder="auto"></div>
    </div>
    <div class="field"><label>Notas</label><textarea name="notes" style="min-height:60px">${esc(m.notes ?? '')}</textarea></div>
    <button class="btn btn-primary" type="submit">Guardar planilla</button>
  </form>
</div></div></section>
${submissionsBlock}
<section class="block grid-2">
  <div class="card">${evForm('home')}</div>
  <div class="card">${evForm('away')}</div>
</section>`;
  return adminLayout({ title: 'Planilla', active: 'planilla', body });
}

/* ============================== FECHAS (día/hora/cancha) ============================== */

/** Hora desde la config del torneo (lista desplegable); campo libre si no hay config. */
function kickoffCell(m: Match, kickoffs: string[]): string {
  if (kickoffs.length === 0) {
    return `<input type="time" name="t_${m.id}" value="${esc(m.kickoff_time)}" style="width:110px">`;
  }
  const opts: string[] = ['', ...(m.kickoff_time && !kickoffs.includes(m.kickoff_time) ? [m.kickoff_time, ...kickoffs] : kickoffs)];
  const o = opts
    .map((v) => `<option value="${esc(v)}" ${v === m.kickoff_time ? 'selected' : ''}>${v ? esc(v) : '—'}</option>`)
    .join('');
  return `<select name="t_${m.id}" style="width:110px">${o}</select>`;
}

/** Cancha desde la config del torneo (lista desplegable); campo libre si no hay config. */
function venueCell(m: Match, venues: string[]): string {
  if (venues.length === 0) {
    return `<input type="text" name="v_${m.id}" value="${esc(m.venue)}" placeholder="Cancha" style="width:130px">`;
  }
  const opts: string[] = ['', ...(m.venue && !venues.includes(m.venue) ? [m.venue, ...venues] : venues)];
  const o = opts
    .map((v) => `<option value="${esc(v)}" ${v === m.venue ? 'selected' : ''}>${v ? esc(v) : '— sin cancha —'}</option>`)
    .join('');
  return `<select name="v_${m.id}" style="width:130px">${o}</select>`;
}

export async function roundsSchedulePage(db: D1Database, slugParam: string | undefined, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout({ title: 'Fechas', active: 'fixture', body: `${pageHead('Fechas')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  const view = await loadTournamentView(db, { id: t.id, includeInactiveTeams: true });
  const matches = view?.matches ?? [];
  const teams = view?.teams ?? [];
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  // Calendario del torneo: para partidos aún sin día, la página muestra la
  // fecha planificada de su jornada (se consolida al "Guardar fecha").
  const schedule = scheduleOf(t.config);

  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    if (m.round == null) continue;
    const arr = byRound.get(m.round);
    if (arr) arr.push(m);
    else byRound.set(m.round, [m]);
  }

  const sections = [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const rows = (byRound.get(r) ?? [])
        .map(
          (m) => `<tr>
      <td>${esc(teamMap.get(m.home_team_id ?? -1)?.name ?? '—')} <span class="faint">vs</span> ${esc(teamMap.get(m.away_team_id ?? -1)?.name ?? '—')}</td>
      <td><input type="date" name="d_${m.id}" value="${esc(m.played_on || plannedRoundDate(schedule, r))}"></td>
      <td>${kickoffCell(m, schedule.kickoffs)}</td>
      <td>${venueCell(m, schedule.venues)}</td>
    </tr>`
        )
        .join('');
      return `<form method="post" action="/admin/fechas/guardar"><input type="hidden" name="tournament_id" value="${t.id}"><input type="hidden" name="round" value="${r}"><h3 class="zone-title">Fecha ${r}</h3><div class="card"><div class="table-wrap"><table class="data">
    <thead><tr><th>Partido</th><th>Día</th><th>Hora</th><th>Cancha</th></tr></thead>
    <tbody>${rows}</tbody>
    </table></div></div><div class="row-between mt-2">
      <button class="btn btn-primary btn-sm" type="submit">Guardar fecha ${r}</button>
      <span style="display:flex;gap:6px;align-items:center">
        <input type="number" name="shift_days" value="0" min="-30" max="30" style="width:64px" title="Días a correr el inicio de la fecha (0 = solo re-slotea hora y cancha)">
        <button class="btn btn-ghost btn-sm" type="submit" formaction="/admin/fechas/regenerar" formmethod="post" title="Re-slotea hora y cancha de los pendientes (esquivando la cancha y hora ocupadas ese día) y verifica que no se dupliquen; el número corre el día de todos los pendientes" onclick="return confirm('Se van a pisar hora y cancha de la fecha ${r} con el patrón del torneo. ¿Continuar?')">↻ Regenerar fecha</button>
      </span>
    </div></form>`;
    })
    .join('');

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Días, horas y canchas')}
${tournaments.length > 1 ? `<form method="get" action="/admin/fechas"><select name="t" onchange="this.form.submit()">${tournaments.map((x) => `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></form>` : ''}
${sections || '<div class="card"><div class="card-body">Fixture vacío.</div></div>'}`;
  return adminLayout({ title: 'Fechas', active: 'fixture', body });
}

/* ============================== SUSPENSIONES (admin) ============================== */

export async function suspensionsAdminPage(db: D1Database, slugParam: string | undefined, msg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout({ title: 'Suspensiones', active: 'suspensiones', body: `${pageHead('Suspensiones')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  const view = await loadTournamentView(db, { id: t.id, includeInactiveTeams: true, events: true });
  const matches = view?.matches ?? [];
  const teams = view?.teams ?? [];
  const events = view?.events ?? [];
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const rules = rulesOf(t);
  const maxRound = matches.reduce((acc, m) => Math.max(acc, m.round ?? 0), 0);
  const suspensions = computeSuspensions(events, matches, rules, maxRound);

  const rows: string[] = [];
  for (const s of suspensions) {
    const p = await db.prepare('SELECT * FROM players WHERE id = ?1').bind(s.playerId).first<{ name: string }>();
    const team = teamMap.get(s.teamId);
    rows.push(`<tr>
    <td><strong>${esc(p?.name ?? '—')}</strong></td>
    <td>${esc(team?.name ?? '—')}</td>
    <td>${esc(s.reason)}</td>
    <td class="num">${s.matches}</td>
    <td class="muted small">${s.asOfRound != null ? `Fecha ${s.asOfRound}` : ''}</td>
  </tr>`);
  }

  const body = `
${flash('success', msg)}
${pageHead('Suspensiones')}
<div class="card"><div class="card-body">
  <p class="hint">Roja = ${rules.redSuspensionMatches} partido(s). Amarillas: cada ${rules.yellowAccumulation || '—'} acumuladas = 1 partido ${rules.yellowAccumWindow ? `(ventana de ${rules.yellowAccumWindow} fechas)` : '(acumulación total)'}. Configurable en el torneo.</p>
</div></div>
<section class="block"><div class="card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Jugador</th><th>Equipo</th><th>Motivo</th><th class="num">Partidos</th><th></th></tr></thead>
  <tbody>${rows.join('') || '<tr><td colspan="5" class="empty-note">Sin suspensiones 🎉</td></tr>'}</tbody>
</table></div></div></section>`;
  return adminLayout({ title: 'Suspensiones', active: 'suspensiones', body });
}

/* Exportados para handlers */
export { slugify, generateRoundRobin, generateDoubleRoundRobin, shuffled, parseRules };
