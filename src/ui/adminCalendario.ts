// Panel: calendario operativo del fixture (Fase 15).
//
// Reúne, por jornada, el estado real de cada partido (jugado, pendiente,
// reprogramado, postergado) con la fecha/hora/cancha vigente y un acceso
// directo a planilla, resultado y reprogramación. Es de solo lectura: no
// genera fixture ni reprograma (eso vive en Fixture, Fechas y la planilla).

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import type { Match, Team } from '../lib/types.ts';
import { listTournaments, matchRescheduleHistory } from '../lib/queries.ts';
import { loadTournamentView } from '../lib/tournamentView.ts';
import { crossoverRoundsOf } from '../lib/crossover.ts';
import { isCrossoverMatch } from '../lib/crossover.ts';
import { orderMatchesForDisplay } from '../lib/order.ts';
import { statusIsReadOnly } from '../lib/status.ts';
import type { RescheduleRecord } from '../lib/reschedule.ts';
import {
  calendarSummaryLine,
  countByState,
  filterMatches,
  MATCH_STATE_FILTERS,
  MATCH_STATE_LABELS,
  MATCH_STATE_TONES,
  matchState,
  needsScheduling,
  parseCalendarFilters,
  rescheduleDetail,
  rescheduleChangeLine,
  roundsOfMatches,
  type CalendarFilters,
  type MatchState,
  type MatchStateFilter,
} from '../lib/calendar.ts';
import { adminLayout } from './admin.ts';
import { emptyNote, icon } from './components.ts';
import { crest } from './match.ts';

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

/** Métrica del panel (mismo marcado que las del dashboard). */
function metric(label: string, sub: string, value: number, tone: string, ico: 'calendar' | 'ball' | 'clock' | 'list' | 'whistle'): string {
  return `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico, 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;
}

/** Distintivo del estado operativo de un partido. */
function stateBadge(state: MatchState): string {
  return `<span class="badge ${MATCH_STATE_TONES[state]}">${esc(MATCH_STATE_LABELS[state])}</span>`;
}

/** Query string de los filtros, para los links (Aplicar / Limpiar / atajos). */
function filtersHref(slug: string, f: CalendarFilters, over: Partial<CalendarFilters> = {}): string {
  const merged: CalendarFilters = { ...f, ...over };
  const params = new URLSearchParams();
  params.set('t', slug);
  if (merged.zone) params.set('zona', merged.zone);
  if (merged.round != null) params.set('jornada', String(merged.round));
  if (merged.state) params.set('estado', merged.state);
  return `/admin/calendario?${params.toString()}`;
}

export async function calendarioAdminPage(
  db: D1Database,
  slugParam: string | undefined,
  filtersRaw: { zona?: string; jornada?: string; estado?: string } = {},
  msg?: string,
  errMsg?: string
): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, {
      title: 'Calendario',
      active: 'calendario',
      body: `<div class="dash-hero"><div class="dash-hero-tx"><span class="dash-kicker">Operación</span><h1>Calendario</h1></div></div><div class="card"><div class="card-body">Primero creá un torneo.</div></div>`,
    });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  const view = await loadTournamentView(db, { id: t.id, includeInactiveTeams: true });
  const matches = view?.matches ?? [];
  const teams: Team[] = view?.teams ?? [];
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));

  // Historial de reprogramaciones (Fase 13): define qué partidos son
  // "reprogramado" y de dónde viene el cambio vigente.
  const history = await matchRescheduleHistory(db, t.id);
  const rescheduled = new Set(history.keys());

  const filters = parseCalendarFilters(filtersRaw);
  const zones = [...new Set(matches.map((m) => m.zone.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'es', { numeric: true })
  );
  const rounds = roundsOfMatches(matches);
  const counts = countByState(matches, rescheduled);
  const filtered = filterMatches(matches, filters, rescheduled);

  const crossoverRounds = crossoverRoundsOf(t.config);
  const readOnly = statusIsReadOnly(t.status);

  // Agrupado por jornada, con el mismo orden de siempre (hora → cancha).
  const byRound = new Map<number, Match[]>();
  const sinJornada: Match[] = [];
  for (const m of filtered) {
    if (m.round == null) {
      sinJornada.push(m);
      continue;
    }
    const arr = byRound.get(m.round);
    if (arr) arr.push(m);
    else byRound.set(m.round, [m]);
  }
  const roundKeys = [...byRound.keys()].sort((a, b) => a - b);

  /** Fila de un partido: estado, vigente y accesos rápidos. */
  const row = (m: Match): string => {
    const state = matchState(m, rescheduled);
    const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : null;
    const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : null;
    const records = history.get(m.id);
    const detail = rescheduleDetail(m, records);
    const zona = m.zone || (isCrossoverMatch(m) ? '<span class="muted">Cruce</span>' : '<span class="faint">—</span>');
    const bracket = m.bracket_round ? ` · ${esc(m.bracket_round)}` : '';
    const falta = needsScheduling(m)
      ? '<div class="hint" style="margin:0">Falta definir día, hora o cancha.</div>'
      : '';
    // Solo tiene sentido ofrecer reprogramar si el partido se puede mover.
    const sePuedeMover = state !== 'jugado' && state !== 'libre' && !readOnly;
    const planillaHref = `/admin/planilla/${m.id}`;
    const acciones = [
      state === 'jugado'
        ? `<a class="btn btn-ghost btn-sm" href="/partido/${m.id}">Resultado</a>`
        : `<a class="btn btn-primary btn-sm" href="${planillaHref}">Planilla</a>`,
      state === 'jugado'
        ? `<a class="btn btn-ghost btn-sm" href="${planillaHref}">Planilla</a>`
        : '',
      sePuedeMover ? `<a class="btn btn-ghost btn-sm" href="${planillaHref}#reprogramar">Reprogramar</a>` : '',
      `<a class="btn btn-ghost btn-sm" href="/admin/fixture/${m.id}/editar">Editar</a>`,
    ]
      .filter(Boolean)
      .join(' ');
    const historial = (records?.length ?? 0) > 0
      ? `<details class="cal-hist"><summary>Historial (${records!.length})</summary><ul class="cal-hist-list">${records!
          .map(
            (r: RescheduleRecord) => `<li>
        <span class="muted small">${esc(formatDateShort(r.created_at.slice(0, 10)))}</span> ${esc(
              rescheduleChangeLine(r)
            )}
        <span class="muted small">— ${esc(r.reason)}</span>
      </li>`
          )
          .join('')}</ul></details>`
      : '';
    return `<tr data-match="${m.id}"${state === 'reprogramado' ? ' class="cal-row-repro"' : ''}>
      <td class="num">${m.id}</td>
      <td><div class="flex">${crest(home, 'sm')} ${esc(home?.name ?? 'Por definir')} <span class="faint">vs</span> ${esc(away?.name ?? 'Por definir')} ${crest(away, 'sm')}</div></td>
      <td class="small">${zona}${bracket}</td>
      <td>${stateBadge(state)}${falta}</td>
      <td>${detail ? `<div class="cal-vigente">${detail}</div>` : `<div class="cal-vigente">${esc(m.played_on ? formatDateShort(m.played_on) || m.played_on : 'día a definir')} · ${esc(m.kickoff_time || 'hora a definir')} · ${esc(m.venue || 'sin cancha')}</div>`}${historial}</td>
      <td class="actions-cell">${acciones}</td>
    </tr>`;
  };

  const table = (list: Match[], label: string): string => `
  <div class="dash-card-head"><h2>${esc(label)}</h2><span class="muted small">${list.length} partido${list.length === 1 ? '' : 's'}</span></div>
  <div class="table-wrap"><table class="data cal-table">
    <thead><tr><th class="num">#</th><th>Partido</th><th>Zona</th><th>Estado</th><th>Fecha vigente</th><th></th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody>
  </table></div>`;

  const sections = roundKeys
    .map((r) => {
      const list = orderMatchesForDisplay(byRound.get(r)!, { tournamentId: t.id, round: r });
      const day = list.find((m) => m.played_on)?.played_on ?? '';
      const st = countByState(list, rescheduled);
      const badges = [
        crossoverRounds.has(r) ? '<span class="badge green">Cruce entre zonas</span>' : '',
        st.jugado > 0 ? `<span class="badge green">${st.jugado} jugado(s)</span>` : '',
        st.pendiente > 0 ? `<span class="badge info">${st.pendiente} pendiente(s)</span>` : '',
        st.reprogramado > 0 ? `<span class="badge amber">${st.reprogramado} reprogramado(s)</span>` : '',
        st.postergado > 0 ? `<span class="badge amber">${st.postergado} postergado(s)</span>` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<section class="block"><h3 class="zone-title">Fecha ${r}${day ? ` · ${esc(formatDateShort(day))}` : ''} ${badges}</h3><div class="dash-card">${table(list, `Partidos de la fecha ${r}`)}</div></section>`;
    })
    .join('');

  const sinJornadaBlock = sinJornada.length
    ? `<section class="block"><h3 class="zone-title">Sin fecha asignada</h3><div class="dash-card">${table(
        orderMatchesForDisplay(sinJornada, { tournamentId: t.id, round: null }),
        'Partidos sin fecha'
      )}</div></section>`
    : '';

  // Barra de filtros: torneo, zona/grupo, jornada y estado.
  const sel = (name: string, label: string, options: string[], current: string, extra = ''): string =>
    `<div class="field"><label>${esc(label)}</label><select name="${name}" ${extra}>${options.join('')}</select></div>`;
  const filterForm = `
<form method="get" action="/admin/calendario" class="form-row">
  <input type="hidden" name="t" value="${escUrl(t.slug)}">
  ${sel(
    'zona',
    'Zona / grupo',
    ['<option value="">Todas</option>', ...zones.map((z) => `<option value="${esc(z)}" ${z === filters.zone ? 'selected' : ''}>${esc(z)}</option>`)],
    filters.zone
  )}
  ${sel(
    'jornada',
    'Jornada',
    [
      '<option value="">Todas</option>',
      ...rounds.map((r) => `<option value="${r}" ${r === filters.round ? 'selected' : ''}>Fecha ${r}</option>`),
    ],
    filters.round == null ? '' : String(filters.round)
  )}
  ${sel(
    'estado',
    'Estado',
    [
      '<option value="">Todos</option>',
      ...MATCH_STATE_FILTERS.map(
        (s) => `<option value="${s}" ${s === filters.state ? 'selected' : ''}>${esc(MATCH_STATE_LABELS[s])}</option>`
      ),
    ],
    filters.state
  )}
  <div class="field" style="align-self:flex-end"><button class="btn btn-primary" type="submit">Aplicar</button></div>
  <div class="field" style="align-self:flex-end">
    <a class="btn btn-ghost" href="${filtersHref(t.slug, filters, { zone: '', round: null, state: '' })}">Limpiar</a>
  </div>
</form>`;

  // Atajos por estado: un link por estado con su propio conteo.
  const shortcuts = `<div class="tpage-tabs" role="group" aria-label="Filtrar por estado">
    <a class="tpage-tab${filters.state === '' ? ' on' : ''}" href="${filtersHref(t.slug, filters, { state: '' })}">Todos</a>
    ${MATCH_STATE_FILTERS.map(
      (s) =>
        `<a class="tpage-tab${filters.state === s ? ' on' : ''}" href="${filtersHref(t.slug, filters, { state: s })}">${esc(MATCH_STATE_LABELS[s])} (${counts[s]})</a>`
    ).join('')}
  </div>`;

  const teamPickOptions = tournaments
    .map((x) => `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');

  const readOnlyNote = readOnly
    ? `<div class="warning-box">🔒 Torneo ${t.status === 'archived' ? 'archivado' : 'finalizado'}: el calendario es de solo lectura y los partidos no se pueden reprogramar desde acá.</div>`
    : '';

  const body = `
${flash('success', msg)}${flash('error', errMsg)}${readOnlyNote}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Operación</span>
    <h1>Calendario</h1>
    <p>El fixture jornada por jornada: qué está jugado, qué falta y qué se reprogramó, con la fecha vigente de cada partido.</p>
  </div>
  ${
    tournaments.length > 1
      ? `<form method="get" action="/admin/calendario" class="pselect"><label for="calPick">Torneo</label><div class="tpage-search pselect-box">${icon('trophy', 15)}<select id="calPick" name="t" onchange="this.form.submit()">${teamPickOptions}</select></div></form>`
      : ''
  }
</div>
<div class="dash-metrics">
  ${metric('Partidos', 'en el torneo', matches.length, 'm-blue', 'list')}
  ${metric('Jugados', 'con resultado cargado', counts.jugado, 'm-green', 'ball')}
  ${metric('Pendientes', 'a jugar', counts.pendiente, 'm-amber', 'clock')}
  ${metric('Reprogramados', 'con nueva fecha', counts.reprogramado, 'm-amber', 'calendar')}
</div>
<section class="block"><div class="card" style="padding:14px">
  <div class="tpage-filters">${shortcuts}</div>
  ${filterForm}
  <p class="hint">${esc(calendarSummaryLine(counts, filtered.length, matches.length))}. Para cambiar día, hora o cancha usá <a href="/admin/fechas?t=${escUrl(t.slug)}">Fechas</a> o la <a href="/admin/fixture?t=${escUrl(t.slug)}">página de Fixture</a>.</p>
</div></section>
${sections}${sinJornadaBlock}${
    filtered.length === 0
      ? `<section class="block"><div class="card"><div class="card-body">${emptyNote(
          matches.length === 0 ? 'Todavía no hay fixture: generá uno en Fixture.' : 'Ningún partido coincide con el filtro.'
        )}</div></div></section>`
      : ''
  }
<p class="hint">Los partidos reprogramados muestran siempre la fecha, la hora y la cancha vigentes, y abajo el historial de cambios con su motivo (registrado al reprogramar, en la Fase 13).</p>`;

  return adminLayout(db, { title: 'Calendario', active: 'calendario', body });
}
