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
import { picksFromEvents, scorerOptions, MAX_GOALS } from '../lib/sheet.ts';
import { rulesOf } from '../lib/rules.ts';
import { EMPTY_ZONES, zonesOf } from '../lib/zones.ts';
import { teamIdsOfTournament, participantsOrAllTeams, participantsWithoutZone } from '../lib/participation.ts';
import { sanctionsForTournament, SANCTION_MEASURES, SANCTION_MEASURE_LABELS, closeFulfilledSanctions } from '../lib/sanctions.ts';
import type { SanctionRow, SanctionStatus } from '../lib/sanctions.ts';
import { combineDiscipline, playerEligibility, hasHardBlock, type DisciplineEntry, type PlayerEligibility } from '../lib/discipline.ts';
import type { PlayerSuspension } from '../lib/suspensions.ts';
import { remainingSuspensionMatches } from '../lib/suspensions.ts';
import { leagueNow } from '../lib/live.ts';
import {
  buildCrossoverPairs,
  crossoverRoundsOf,
  parseCrossoverConfig,
  CROSSOVER_RULES,
  parseCrossoverRule,
  matchesForStandings,
} from '../lib/crossover.ts';
import {
  PLAYOFF_FORMATS,
  parsePlayoffConfig,
  pendingLeagueCount,
  playoffFormatLabel,
} from '../lib/playoff.ts';
import { buildMakeUpPlan, postponedMatches, suggestMakeUpRound } from '../lib/oversub.ts';
import { computeStandings, groupBy } from '../lib/standings.ts';
import { loadTournamentView } from '../lib/tournamentView.ts';
import type { SubmissionEventRow } from '../lib/delegates.ts';
import { delegateShareText, generateDelegateCode } from '../lib/delegates.ts';
import { waLink } from '../lib/share.ts';
import { pendingForMatchBlock, submissionsAdminPage } from './adminEntregas.ts';
import { crest, crossoverBadge } from './match.ts';
import {
  BRAND_SVG,
  dashboardShell,
  icon,
  type NavItem,
  type NavGroup,
  type TournamentPickerData,
  type DashQuickAction,
  type DashActivityItem,
} from './components.ts';
import { planFixture, groupByFixtureRound, planSummary, type PlannedMatch } from '../lib/planifier.ts';
import { orderMatchesForDisplay } from '../lib/order.ts';
import { isCrossoverMatch } from '../lib/crossover.ts';
import { isTeamDisciplined, type EligibilityInput } from '../lib/discipline.ts';
import { sanctionEffectsOf } from '../lib/sanctionEffects.ts';
import type { PointAdjustment } from '../lib/standings.ts';

/* ============================== ELEGIBILIDAD (compartido) ============================== */

/**
 * Arma el paquete de disciplina activa de un partido, listo para
 * playerEligibility(): suspensiones automáticas + sanciones manuales del
 * torneo, con las jornadas jugadas reales. Devuelve null si el partido no
 * tiene torneo (nada que evaluar, no se inventa).
 */
export async function disciplineForMatch(
  db: D1Database,
  match: Match
): Promise<EligibilityInput | null> {
  const view = await loadTournamentView(db, {
    id: match.tournament_id,
    includeInactiveTeams: true,
    events: true,
  });
  if (!view) return null;
  const rules = rulesOf(view.tournament);
  const maxRound = view.matches.reduce((acc, mm) => Math.max(acc, mm.round ?? 0), 0);
  const autos = computeSuspensions(view.events, view.matches, rules, maxRound);
  const today = leagueNow().date;
  const playedRounds = view.matches
    .filter((mm) => mm.status === 'played' || mm.status === 'walkover')
    .map((mm) => mm.round ?? 0)
    .filter((r) => r > 0);
  // Round del incidente de cada manual: el último round con partido del
  // equipo en la fecha del incidente (mismo criterio que suspensionsAdminPage).
  const incidentRoundOf = (s: SanctionRow): number | null => {
    if (!s.team_id) return null;
    const rounds = view.matches
      .filter((mm) => (mm.home_team_id === s.team_id || mm.away_team_id === s.team_id) && mm.played_on === s.incident_date)
      .map((mm) => mm.round)
      .filter((r): r is number => r != null);
    return rounds.length ? Math.max(...rounds) : null;
  };
  // Fase 8: cierre automático de sanciones cumplidas. Se ejecuta en este
  // punto de consulta (idempotente, solo si hay algo que cerrar) para que
  // la elegibilidad siempre lea estados reales.
  await closeFulfilledSanctions(db, view.tournament.id, {
    playedRounds,
    today,
    incidentRoundOf,
  });
  const allSanctions = await sanctionsForTournament(db, view.tournament.id);
  const { active } = combineDiscipline(
    autos.map((s) => ({ tournamentId: view.tournament.id, suspension: s, servedRemaining: null })),
    allSanctions.map((s) => ({ sanction: s, incidentRound: incidentRoundOf(s), playedRounds, today }))
  );
  return {
    active,
    match,
    playedRounds,
    tournamentMatches: view.matches,
  };
}

/**
 * Ajustes de puntos derivados de sanciones de equipo (Fase 7B): cada medida
 * activa de pérdida de puntos se convierte en un ajuste negativo para las
 * tablas. Solo aplica al torneo indicado; los expulsados se marcan aparte.
 */
export async function teamEffectsAdjustments(db: D1Database, tournamentId: number): Promise<PointAdjustment[]> {
  const sanctions = await sanctionsForTournament(db, tournamentId);
  if (sanctions.length === 0) return [];
  const today = leagueNow().date;
  const { active } = combineDiscipline(
    [],
    sanctions.map((s) => ({ sanction: s, incidentRound: null, playedRounds: [], today }))
  );
  return sanctionEffectsOf(active).adjustments;
}

/** Aviso de disciplina de EQUIPO (no suspende jugadores individuales). */
export function teamDisciplineNotice(input: EligibilityInput | null, teamId: number | null): string {
  if (!input || teamId == null) return '';
  if (!isTeamDisciplined(input.active, teamId)) return '';
  const entries = input.active.filter((e) => e.scope === 'team' && e.teamId === teamId);
  const detail = entries.map((e) => esc(e.reason)).join(' · ');
  return `<div class="error-box" data-team-discipline>⚠ <strong>Disciplina de equipo:</strong> el equipo tiene una sanción activa (${detail}). No suspende a los jugadores, pero el partido queda sujeto a lo que resuelva el tribunal.</div>`;
}

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

/**
 * Navegación del panel en 6 secciones (diseño UX aprobado): Inicio,
 * Competencia (antes del torneo), Operación (cada semana), Equipos,
 * Estadísticas y Administración (tribunal). Estadísticas todavía no tiene
 * página propia: el enlace queda preparado para /admin/estadisticas.
 */
export function adminGroupsNav(opts: { pending?: number; unassigned?: number }): NavGroup[] {
  return [
    { label: 'Inicio', href: '/admin', match: 'admin', items: [] },
    {
      label: 'Competencia',
      items: [
        { href: '/admin/torneos', label: 'Torneos', match: 'torneos' },
        { href: '/admin/fixture', label: 'Fixture y llaves', match: 'fixture' },
      ],
    },
    {
      label: 'Operación',
      items: [
        ...(opts.unassigned ? [{ href: '/admin/fechas', label: 'Fechas', match: 'fechas', badge: opts.unassigned } as NavItem] : [{ href: '/admin/fechas', label: 'Fechas', match: 'fechas' } as NavItem]),
        { href: '/admin/planilla', label: 'Resultados', match: 'planilla' },
        ...(opts.pending ? [{ href: '/admin/entregas', label: 'Entregas', match: 'entregas', badge: opts.pending } as NavItem] : [{ href: '/admin/entregas', label: 'Entregas', match: 'entregas' } as NavItem]),
      ],
    },
    {
      label: 'Equipos',
      items: [
        { href: '/admin/equipos', label: 'Equipos', match: 'equipos' },
        { href: '/admin/jugadores', label: 'Jugadores', match: 'jugadores' },
        { href: '/admin/delegados', label: 'Delegados', match: 'delegados' },
      ],
    },
    { label: 'Estadísticas', href: '/admin/estadisticas', match: 'estadisticas', items: [] },
    {
      label: 'Administración',
      items: [
        { href: '/admin/ajustes', label: 'Ajustes de puntos', match: 'ajustes' },
        { href: '/admin/suspensiones', label: 'Suspensiones', match: 'suspensiones' },
      ],
    },
  ];
}

/**
 * Layout común del panel: TODAS las pantallas /admin/* usan el mismo shell
 * del dashboard (sidebar + topbar), reutilizando dashboardShell(). Con `db`
 * resuelve además los datos del topbar: selector global de torneo, pendientes
 * de Entregas y fechas sin agendar. Sin `db` (login, vista previa) renderiza
 * el shell sin selector.
 */
export async function adminLayout(
  db: D1Database | null,
  opts: { title: string; active: string; body: string }
): Promise<string> {
  let pending: number | undefined;
  let unassigned: number | undefined;
  let picker: TournamentPickerData | undefined;
  if (db) {
    const tournaments = await listTournaments(db);
    const active = tournaments.find((t) => t.status === 'active') ?? tournaments[0];
    const [pend, unass] = await Promise.all([
      countPendingSubmissions(db),
      active
        ? db
            .prepare(
              "SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ?1 AND status = 'scheduled' AND (kickoff_time = '' OR venue = '')"
            )
            .bind(active.id)
            .first<{ n: number }>()
        : Promise.resolve(null),
    ]);
    pending = pend || undefined;
    unassigned = unass?.n || undefined;
    picker = {
      tournaments: tournaments.map((t) => ({ slug: t.slug, name: t.name, status: t.status })),
      currentSlug: active?.slug,
    };
  }
  // El contenido clásico de cada página se centra bajo el shell del dashboard
  // (el dashboard de /admin usa su grilla propia, sin este envoltorio).
  return dashboardShell({
    title: opts.title,
    active: opts.active,
    groups: adminGroupsNav({ pending, unassigned }),
    picker,
    search: { action: '/buscar', placeholder: 'Buscar equipos, jugadores, partidos…' },
    pending,
    body: `<div class="admin-page">${opts.body}</div>`,
  });
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

export async function loginPage(error?: string, next?: string): Promise<string> {
  const body = `
<div class="login-wrap">
  ${flash('error', error)}
  <div class="dash-card fgen login-card">
    <div class="login-brand">${BRAND_SVG}</div>
    <span class="dash-kicker" style="text-align:center">Acceso</span>
    <h1 style="text-align:center;font-size:1.35rem">Panel de administración</h1>
    <form method="post" action="/admin/login">
      <input type="hidden" name="next" value="${escUrl(next ?? '/admin')}">
      <div class="field">
        <label for="password">Contraseña</label>
        <input type="password" id="password" name="password" required autofocus autocomplete="current-password">
        <p class="hint">Es la contraseña configurada como secreto ADMIN_PASSWORD en Cloudflare.</p>
      </div>
      <button class="btn btn-primary" type="submit" style="width:100%">Entrar</button>
    </form>
  </div>
</div>`;
  return await adminLayout(null, { title: 'Ingresar', active: 'login', body });
}

/* ============================== DASHBOARD ============================== */

/**
 * Inicio del panel con el diseño de referencia: métricas, tablas y rail
 * de accesos. Mismos datos y rutas que el resumen anterior; el shell con
 * sidebar solo se usa acá (el resto del panel mantiene el layout clásico).
 */
export async function dashboardPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const [tournaments, teams, pending, playersTotal, activeView, latestSubs] = await Promise.all([
    listTournaments(db),
    listTeams(db),
    countPendingSubmissions(db),
    db.prepare('SELECT COUNT(*) AS n FROM players WHERE active = 1').first<{ n: number }>(),
    loadTournamentView(db, { includeInactiveTeams: true, scorers: 5 }),
    pendingSubmissions(db, 5),
  ]);
  const active = activeView?.tournament ?? null;
  const matches = activeView?.matches ?? [];
  const scorers = activeView?.scorers ?? [];

  let matchStats = { total: 0, played: 0, upcoming: 0 };
  if (activeView) {
    matchStats = {
      total: matches.filter((m) => m.status !== 'bye').length,
      played: matches.filter((m) => m.status === 'played' || m.status === 'walkover').length,
      upcoming: matches.filter((m) => m.status === 'scheduled').length,
    };
  }
  const teamMap = new Map((activeView?.teams ?? []).map((tm) => [tm.id, tm]));

  const stat = (label: string, value: string | number, href?: string) => `
  <a class="card" style="padding:16px;color:var(--text)" ${href ? `href="${escUrl(href)}"` : ''}>
    <div class="hero-kicker">${esc(label)}</div>
    <div style="font-family:var(--font-head);font-size:1.6rem">${esc(String(value))}</div>
  </a>`;

  // Sin torneo activo: mantengo el resumen clásico para no inventar datos.
  if (!active) {
    const body = `
${flash('success', msg)}${flash('error', errMsg)}
${pageHead('Resumen', { href: '/admin/torneos/nuevo', label: '+ Nuevo torneo' })}
<section class="block grid-2">
  ${stat('Torneos', tournaments.length, '/admin/torneos')}
  ${stat('Equipos', teams.length, '/admin/equipos')}
  ${stat('Entregas pendientes', pending, '/admin/entregas')}
</section>
<section class="block"><div class="card"><div class="card-body">
  <strong>Atajos:</strong>
  <a href="/admin/planilla">cargar un resultado</a> ·
  <a href="/admin/entregas">aprobar entregas de delegados</a> ·
  <a href="/admin/fixture">generar fixture</a> ·
  <a href="/admin/jugadores">cargar plantilla</a>
</div></div></section>`;
    return await adminLayout(db, { title: 'Panel', active: 'admin', body });
  }

  /* ----- Datos de las secciones (mismas consultas que las otras páginas) ----- */
  // Sanciones de equipo con pérdida de puntos: entran en las tablas del panel.
  const dashFx = active ? await teamEffectsAdjustments(db, active.id) : [];
  const standings = computeStandings(
    matchesForStandings(matches, active.config),
    (activeView?.teams ?? []).filter((tm) => tm.active).map((tm) => ({ id: tm.id, name: tm.name })),
    rulesOf(active),
    dashFx
  );
  const zonesCfg = zonesOf(active.config);
  const zoneOfTeam = new Map<number, string>();
  if (zonesCfg.enabled) {
    for (const z of zonesCfg.zones) for (const id of z.teamIds) zoneOfTeam.set(id, z.name);
  } else {
    for (const m of matches) {
      if (m.zone) {
        if (m.home_team_id != null) zoneOfTeam.set(m.home_team_id, m.zone);
        if (m.away_team_id != null) zoneOfTeam.set(m.away_team_id, m.zone);
      }
    }
  }
  const zoneOfStandings = (id: number) => zoneOfTeam.get(id) ?? '';
  const byZone = groupBy(
    standings.map((r) => ({ row: r, zone: zoneOfStandings(r.teamId) })),
    (x) => x.zone
  );
  const top = [...byZone.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([, rows]) => rows.slice(0, 6))
    .slice(0, 8);

  const today = new Date().toISOString().slice(0, 10);
  const upcomingAll = matches
    .filter((m) => m.status === 'scheduled' && m.home_team_id != null && m.away_team_id != null)
    .sort((a, b) => (a.played_on || '9999').localeCompare(b.played_on || '9999') || a.id - b.id);
  const upcoming = upcomingAll.slice(0, 4);
  const recent = matches
    .filter((m) => (m.status === 'played' || m.status === 'walkover') && m.home_team_id != null && m.away_team_id != null)
    .sort((a, b) => (b.played_on || '').localeCompare(a.played_on || '') || b.id - a.id)
    .slice(0, 5);
  const roundsPlayed = new Set(matches.filter((m) => m.status === 'played' || m.status === 'walkover').map((m) => m.round)).size;
  const roundsTotal = new Set(matches.filter((m) => m.status !== 'bye' && m.round != null).map((m) => m.round)).size;
  const goalsAll = matches
    .filter((m) => m.status === 'played' || m.status === 'walkover')
    .reduce((acc, m) => acc + m.home_goals + m.away_goals, 0);

  /* ----- Renders de secciones ----- */
  const metrics = [
    { ic: 'users', tone: 'green', label: 'Equipos', num: String(teams.length), sub: `de ${teams.filter((t) => t.active).length} activos`, href: '/admin/equipos', pct: teams.length ? Math.round((teams.filter((t) => t.active).length / teams.length) * 100) : 0 },
    { ic: 'shield', tone: 'blue', label: 'Jugadores', num: String(playersTotal?.n ?? 0), sub: 'registrados', href: '/admin/jugadores', pct: 100 },
    { ic: 'calendar', tone: 'violet', label: 'Partidos', num: String(matchStats.total), sub: `${matchStats.played} jugados`, href: '/admin/fixture', pct: matchStats.total ? Math.round((matchStats.played / matchStats.total) * 100) : 0 },
    { ic: 'trophy', tone: 'amber', label: 'Jornadas', num: String(roundsPlayed), sub: roundsTotal ? `de ${roundsTotal}` : 'sin fixture', href: '/admin/fixture', pct: roundsTotal ? Math.round((roundsPlayed / roundsTotal) * 100) : 0 },
  ]
    .map(
      (s) => `<a class="dash-metric m-${s.tone}" href="${escUrl(s.href)}">
  <span class="dash-metric-ico">${icon(s.ic as 'users', 18)}</span>
  <span class="dash-metric-tx"><span class="dash-metric-lbl">${s.label}</span><span class="dash-metric-num">${s.num}</span><span class="dash-metric-sub">${esc(s.sub)}</span></span>
  <span class="dash-metric-bar"><span style="width:${Math.min(100, Math.max(2, s.pct))}%"></span></span>
</a>`
    )
    .join('');

  const standingsRows = top.length
    ? top
        .map(
          ({ row: r }) => `<tr>
  <td><span class="pos-num">${standings.findIndex((x) => x.teamId === r.teamId) + 1}</span></td>
  <td><span class="team-cell">${crest(teamMap.get(r.teamId))}<span class="tname">${esc(teamMap.get(r.teamId)?.name ?? '—')}</span></span></td>
  <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
  <td class="num">${r.goalsFor}</td><td class="num">${r.goalsAgainst}</td>
  <td class="num"><strong>${r.points}</strong></td>
</tr>`
        )
        .join('')
    : `<tr><td colspan="9" class="empty-note">Todavía no hay partidos.</td></tr>`;

  const upcomingRows = upcoming.length
    ? upcoming
        .map(
          (m) => `<a class="dash-next-row" href="/admin/planilla/${m.id}">
  <span class="dash-next-when">${esc(formatDateShort(m.played_on)) || 'A definir'}${m.kickoff_time ? ` · ${esc(m.kickoff_time)}` : ''}</span>
  <span class="dash-next-vs"><span class="team-cell sm">${crest(teamMap.get(m.home_team_id ?? -1), 'sm')}<span class="tname">${esc(teamMap.get(m.home_team_id ?? -1)?.name ?? '—')}</span></span><span class="vs">vs</span><span class="team-cell sm away">${crest(teamMap.get(m.away_team_id ?? -1), 'sm')}<span class="tname">${esc(teamMap.get(m.away_team_id ?? -1)?.name ?? '—')}</span></span></span>
  ${m.venue ? `<span class="dash-next-venue">${esc(m.venue)}</span>` : ''}
</a>`
        )
        .join('')
    : `<div class="empty-note">No hay partidos programados.</div>`;

  const recentRows = recent.length
    ? recent
        .map(
          (m) => `<a class="dash-result" href="/admin/planilla/${m.id}">
  <span class="dash-res-date">${esc(formatDateShort(m.played_on)) || '—'}</span>
  <span class="team-cell sm">${crest(teamMap.get(m.home_team_id ?? -1), 'sm')}<span class="tname">${esc(teamMap.get(m.home_team_id ?? -1)?.name ?? '—')}</span></span>
  <span class="dash-res-score">${m.home_goals} - ${m.away_goals}</span>
  <span class="team-cell sm away">${crest(teamMap.get(m.away_team_id ?? -1), 'sm')}<span class="tname">${esc(teamMap.get(m.away_team_id ?? -1)?.name ?? '—')}</span></span>
</a>`
        )
        .join('')
    : `<div class="empty-note">Sin resultados todavía.</div>`;

  const scorersRows = scorers.length
    ? scorers
        .map(
          (s, i) => `<div class="dash-scorer"><span class="pos-num pod${i < 3 ? String(i + 1) : ''}">${i + 1}</span><span class="tname">${esc(s.player_name)}</span><span class="muted small">${esc(s.team_name)}</span><span class="strong">${s.goals}</span></div>`
        )
        .join('')
    : `<div class="empty-note">Sin goles todavía.</div>`;

  const activity: DashActivityItem[] = latestSubs.map((s) => ({
    icon: 'list',
    tone: 'blue' as const,
    when: formatDateShort(s.played_on) || '—',
    title: `Entrega de ${s.team_name}`,
    detail: `${s.home_goals} - ${s.away_goals} vs ${teamMap.get(s.home_team_id ?? -1)?.name ?? '?'} / ${teamMap.get(s.away_team_id ?? -1)?.name ?? '?'}`,
  }));

  const quickActions: DashQuickAction[] = [
    { href: '/admin/torneos/nuevo', label: 'Nuevo torneo', icon: 'trophy', tone: 'green' },
    { href: '/admin/equipos/nuevo', label: 'Agregar equipo', icon: 'users', tone: 'blue' },
    { href: '/admin/planilla', label: 'Cargar resultado', icon: 'list', tone: 'violet' },
    { href: '/admin/fixture', label: 'Fixture', icon: 'calendar', tone: 'green' },
    { href: '/admin/suspensiones', label: 'Suspensiones', icon: 'card', tone: 'danger' },
    { href: '/admin/estadisticas', label: 'Estadísticas', icon: 'chart', tone: 'amber' },
  ];
  const quick = quickActions
    .map(
      (a) => `<a class="dash-quick" href="${escUrl(a.href)}"><span class="dash-quick-ico q-${a.tone}">${icon(a.icon as 'users', 16)}</span><span>${esc(a.label)}</span></a>`
    )
    .join('');
  const torneoCard = `<a class="dash-torneo" href="/admin/fixture?t=${escUrl(active.slug)}">
  <span class="dash-torneo-ico">${icon('trophy', 20)}</span>
  <span class="dash-torneo-tx"><strong>${esc(active.name)}</strong><span class="dash-torneo-status"><span class="dot"></span>${active.status === 'active' ? 'En curso' : active.status === 'draft' ? 'Borrador' : 'Finalizado'}</span></span>
  <span class="chev">›</span>
</a>`;
  const statusCard =
    pending > 0
      ? `<div class="dash-status st-warn">${icon('bell', 15)}<span><strong>${pending} entrega${pending === 1 ? '' : 's'} por revisar</strong><em>Los delegados cargaron resultados que esperan tu aprobación.</em></span></div>`
      : `<div class="dash-status st-ok">${icon('shield', 15)}<span><strong>Todo en orden</strong><em>No hay entregas pendientes de revisión.</em></span></div>`;

  const dashBody = `
${flash('success', msg)}${flash('error', errMsg)}
<section class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">DASHBOARD ADMINISTRADOR</span>
    <h1>Hola, <span class="hl">Administrador</span></h1>
    <p>Resumen general de la liga y actividad reciente.</p>
  </div>
  ${active.status === 'active' ? `<span class="dash-pill">${icon('clock', 13)} En curso</span>` : ''}
</section>
<section class="dash-metrics">${metrics}</section>
<div class="dash-grid">
  <div class="dash-col-main">
    <section class="dash-card dash-card-table">
      <div class="dash-card-head"><h2>${icon('trophy', 16)} Tabla de posiciones</h2><a href="/admin/fixture">Ver completa →</a></div>
      <div class="table-wrap"><table class="data standings">
        <thead><tr><th>#</th><th>Equipo</th><th class="num">PJ</th><th class="num">PG</th><th class="num">PE</th><th class="num">PP</th><th class="num">GF</th><th class="num">GC</th><th class="num">Pts</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table></div>
    </section>
    <section class="dash-card">
      <div class="dash-card-head"><h2>${icon('list', 16)} Resultados recientes</h2><a href="/admin/planilla">Ver todos →</a></div>
      ${recentRows}
    </section>
  </div>
  <div class="dash-col-mid">
    <section class="dash-card">
      <div class="dash-card-head"><h2>${icon('calendar', 16)} Próximos partidos</h2><a href="/admin/fechas">Ver todos →</a></div>
      ${upcomingRows}
    </section>
    <section class="dash-card">
      <div class="dash-card-head"><h2>${icon('ball', 16)} Goles por torneo</h2><span class="muted small">${goalsAll} en el torneo</span></div>
      ${scorersRows}
    </section>
  </div>
  <div class="dash-col-side">
    ${torneoCard}
    <section class="dash-card">
      <div class="dash-card-head"><h2>${icon('bolt', 16)} Accesos rápidos</h2></div>
      <div class="dash-quick-grid">${quick}</div>
    </section>
    <section class="dash-card">
      <div class="dash-card-head"><h2>${icon('bell', 16)} Actividad reciente</h2><a href="/admin/entregas">Ver todo →</a></div>
      ${activity || `<div class="empty-note">Sin entregas pendientes.</div>`}
    </section>
    ${statusCard}
  </div>
</div>`;

  return dashboardShell({
    title: 'Panel — ZonaLiga',
    active: 'admin',
    groups: adminGroupsNav({ pending: pending || undefined }),
    picker: {
      tournaments: tournaments.map((t) => ({ slug: t.slug, name: t.name, status: t.status })),
      currentSlug: active.slug,
    },
    torneo: { name: active.name, season: active.season, status: active.status, slug: active.slug },
    search: { action: '/buscar', placeholder: 'Buscar equipos, jugadores, partidos…' },
    pending: pending || undefined,
    quickActions,
    activity,
    status:
      pending > 0
        ? { tone: 'warn', title: `${pending} entrega${pending === 1 ? '' : 's'} por revisar`, detail: 'Los delegados cargaron resultados que esperan tu aprobación.' }
        : { tone: 'ok', title: 'Todo en orden', detail: 'No hay entregas pendientes de revisión.' },
    body: dashBody,
  });
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
  return adminLayout(db, { title: 'Entregas', active: 'entregas', body: inner });
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
  const total = tournaments.length;
  const enCurso = tournaments.filter((t) => t.status === 'active').length;
  const borradores = tournaments.filter((t) => t.status === 'draft').length;
  const finalizados = tournaments.filter((t) => t.status === 'finished').length;
  // Mismo criterio que el selector global: activo, si no, el primero.
  const currentSlug = tournaments.find((t) => t.status === 'active')?.slug ?? tournaments[0]?.slug;
  const metric = (label: string, sub: string, value: number, tone: string, ico: string) => `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico as 'trophy', 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;
  const cards = tournaments
    .map((t) => {
      const live = t.slug === currentSlug;
      const cls = (live ? 'live ' : '') + (t.status === 'draft' ? 'draft' : t.status === 'finished' ? 'fin' : '');
      const creado = formatDateShort(t.created_at.slice(0, 10));
      return `<article class="tcard ${cls.trim()}" data-nombre="${esc(t.name.toLowerCase())}" data-estado="${esc(t.status)}">
    <span class="tcard-ico">${icon('trophy', 20)}</span>
    <div class="tcard-tx">
      <div class="tcard-top">
        <strong>${esc(t.name)}</strong>
        ${badge(t.status)}
        ${t.slug === currentSlug ? `<span class="tcard-tag">${icon('ball', 11)} Seleccionado</span>` : ''}
      </div>
      <div class="tcard-meta">
        ${t.season ? `<span>${icon('calendar', 13)} Temporada ${esc(t.season)}</span>` : ''}
        <span>${icon('list', 13)} ${esc(formatLabel(t.format))}</span>
        ${creado ? `<span>${icon('clock', 13)} Desde ${creado}</span>` : ''}
      </div>
    </div>
    <div class="tcard-acts">
      <a class="btn btn-ghost btn-sm" href="/?t=${escUrl(t.slug)}" title="Ver en el sitio">Ver</a>
      <a class="btn btn-primary btn-sm" href="/admin/torneos/${t.id}">Editar</a>
      <form method="post" action="/admin/torneos/${t.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar torneo y todos sus partidos?')">
        <button class="tcard-ghost" type="submit" title="Eliminar torneo" aria-label="Eliminar torneo">✕</button>
      </form>
    </div>
  </article>`;
    })
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Competencia</span>
    <h1>Torneos</h1>
    <p>Creá, configurá y seguí el estado de cada competencia de la liga.</p>
  </div>
  <a class="btn btn-primary" href="/admin/torneos/nuevo">+ Nuevo torneo</a>
</div>
<div class="dash-metrics">
  ${metric('Total', 'competencias', total, 'm-blue', 'list')}
  ${metric('En curso', 'en juego', enCurso, 'm-green', 'ball')}
  ${metric('Borradores', 'por configurar', borradores, 'm-amber', 'calendar')}
  ${metric('Finalizados', 'archivados', finalizados, 'm-violet', 'shield')}
</div>
<section class="block"><div class="card" style="padding:14px">
  <div class="tpage-filters">
    <div class="tpage-search">${icon('search', 15)}<input id="tSearch" type="search" placeholder="Buscar torneo por nombre…" aria-label="Buscar torneo"></div>
    <div class="tpage-tabs" role="group" aria-label="Filtrar por estado">
      <button type="button" class="tpage-tab on" data-estado="">Todos</button>
      <button type="button" class="tpage-tab" data-estado="active">En curso</button>
      <button type="button" class="tpage-tab" data-estado="draft">Borradores</button>
      <button type="button" class="tpage-tab" data-estado="finished">Finalizados</button>
    </div>
  </div>
</div></section>
<section class="block"><div class="tpage-list" id="tList">
  ${cards || '<div class="empty-note">Sin torneos. Creá el primero.</div>'}
  <div class="empty-note" id="tEmpty" style="display:none">Ningún torneo coincide con el filtro.</div>
</div></section>
<script>
  (function () {
    var list = document.getElementById('tList');
    var input = document.getElementById('tSearch');
    if (!list || !input) return;
    var tabs = [].slice.call(document.querySelectorAll('.tpage-tab'));
    var cards = [].slice.call(list.querySelectorAll('.tcard'));
    var vacio = document.getElementById('tEmpty');
    function sync() {
      var q = (input.value || '').trim().toLowerCase();
      var est = '';
      tabs.forEach(function (b) { if (b.classList.contains('on')) est = b.getAttribute('data-estado') || ''; });
      var visibles = 0;
      cards.forEach(function (c) {
        var ok = (!est || c.getAttribute('data-estado') === est) && (!q || (c.getAttribute('data-nombre') || '').indexOf(q) !== -1);
        c.style.display = ok ? '' : 'none';
        if (ok) visibles++;
      });
      if (vacio) vacio.style.display = visibles ? 'none' : '';
    }
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        sync();
      });
    });
    input.addEventListener('input', sync);
  })();
</script>`;
  return adminLayout(db, { title: 'Torneos', active: 'torneos', body });
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
  const zones = t ? zonesOf(t.config) : EMPTY_ZONES;
  const activeTeams = (await listTeams(db, true)).filter((tm) => tm.active);
  const savedParticipants = id != null ? await teamIdsOfTournament(db, id) : [];
  const participantSet = new Set([...savedParticipants, ...zones.zones.flatMap((z) => z.teamIds)]);
  // Detectar participantes sin zona cuando las zonas están activas: solo aviso,
  // no inventa zona ni quita la participación.
  const sinZona = participantsWithoutZone(savedParticipants, zones)
    .map((tid) => activeTeams.find((tm) => tm.id === tid)?.name ?? `#${tid}`);
  const zoneRows = activeTeams
    .map((tm) => {
      const zi = zones.zones.findIndex((z) => z.teamIds.includes(tm.id)) + 1;
      const opts =
        '<option value="">—</option>' +
        zones.zones
          .map(
            (z, i) => `<option value="${i + 1}" ${zi === i + 1 ? 'selected' : ''}>${esc(z.name)}</option>`
          )
          .join('');
      return `<tr>
      <td>${esc(tm.name)}</td>
      <td class="num"><input type="checkbox" name="participate_${tm.id}" data-participate ${participantSet.has(tm.id) ? 'checked' : ''} style="width:auto"></td>
      <td><select name="zone_of_${tm.id}" data-zone-select ${zi > 0 ? '' : 'disabled'}>${opts}</select></td>
    </tr>`;
    })
    .join('');
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
    <h3 class="zone-title">Zonas</h3>
    <div class="field">
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0">
        <input type="checkbox" id="zones_enabled" name="zones_enabled" ${zones.enabled ? 'checked' : ''} style="width:auto">
        Dividir en zonas manualmente
      </label>
      <p class="hint">Los equipos de una zona solo se cruzan entre sí. Las canchas y horarios son compartidos: los partidos de todas las zonas de una fecha se reparten intercalados en la misma lista de canchas (ej.: 10:00 Zona A, 10:00 Zona B, 11:00 Zona A…).</p>
    </div>
    <div id="zones-config">
      <div class="field">
        <label for="zone_names">Nombres de zonas (uno por línea, 2 a 8)</label>
        <textarea id="zone_names" name="zone_names" rows="3" placeholder="A\nB">${esc(zones.zones.map((z) => z.name).join('\n'))}</textarea>
      </div>
      ${sinZona.length ? `<p class="hint" style="color:var(--warn,#f59e0b)">⚠ Participan sin zona: ${esc(sinZona.join(', '))}. Asignales zona acá o no van a entrar al fixture.</p>` : ''}
      <div class="table-wrap"><table class="data zones-table">
        <thead><tr><th>Equipo</th><th class="num">Participa</th><th>Zona</th></tr></thead>
        <tbody>${zoneRows || '<tr><td colspan="3" class="empty-note">Sin equipos activos todavía.</td></tr>'}</tbody>
      </table></div>
    </div>
    <h3 class="zone-title">Canchas y horarios</h3>
    ${scheduleFields(schedule)}
    <h3 class="zone-title">Reglas de puntuación y sanciones</h3>
    ${rulesFields(rules)}
    <button class="btn btn-primary" type="submit">Guardar</button>
    <a class="btn btn-ghost" href="/admin/torneos">Cancelar</a>
  </form>
  <script>
  (function () {
    var cb = document.getElementById('zones_enabled');
    var box = document.getElementById('zones-config');
    var ta = document.getElementById('zone_names');
    if (!cb || !box) return;
    function syncBox() { box.style.display = cb.checked ? '' : 'none'; }
    cb.addEventListener('change', syncBox);
    syncBox();
    // Mockup de participación: el checkbox habilita/deshabilita el selector
    // de zona de su fila. (La persistencia llega tras aprobar el diseño.)
    var rows = Array.prototype.slice.call(document.querySelectorAll('input[data-participate]'));
    rows.forEach(function (p) {
      var sel = p.closest('tr').querySelector('select[data-zone-select]');
      function syncPart() { if (sel) sel.disabled = !p.checked; }
      p.addEventListener('change', syncPart);
    });
    if (!ta) return;
    var selects = Array.prototype.slice.call(document.querySelectorAll('select[data-zone-select]'));
    function syncSelects() {
      var names = ta.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);
      selects.forEach(function (sel) {
        var prev = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
        sel.innerHTML = '';
        var none = document.createElement('option');
        none.value = ''; none.textContent = 'Sin zona';
        sel.appendChild(none);
        names.forEach(function (n, i) {
          var o = document.createElement('option');
          o.value = String(i + 1); o.textContent = n;
          sel.appendChild(o);
          if (n === prev) sel.value = o.value;
        });
      });
    }
    ta.addEventListener('input', syncSelects);
    syncSelects();
  })();
  </script>
</div></div></section>`;
  return adminLayout(db, { title: isEdit ? 'Editar torneo' : 'Nuevo torneo', active: 'torneos', body });
}

/* ============================== EQUIPOS ============================== */

export async function teamsAdminPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const teams = await listTeams(db, true);
  const activos = teams.filter((tm) => tm.active).length;
  const inactivos = teams.length - activos;
  const metric = (label: string, sub: string, value: number, tone: string, ico: string) => `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico as 'users', 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;
  const cards = teams
    .map((tm) => {
      const badgeHtml = tm.active
        ? '<span class="badge green">Activo</span>'
        : '<span class="badge ghost">Inactivo</span>';
      // <strong>Nombre</strong>…/admin/equipos/ID">Editar: lo parsean los
      // scripts de seed (seed-dev/prod) y fix-zonas; no cambiar la estructura.
      return `<article class="tcard pcard ${tm.active ? '' : 'off'}" data-nombre="${esc(tm.name.toLowerCase())}" data-activo="${tm.active ? '1' : '0'}">
    <span class="tcard-ico pcrest">${crest(tm, 'sm')}</span>
    <div class="tcard-tx">
      <div class="tcard-top"><a href="/equipos/${escUrl(tm.slug)}"><strong>${esc(tm.name)}</strong></a>${badgeHtml}</div>
      <div class="tcard-meta">
        <span>Nombre corto: ${esc(tm.short_name || '···')}</span>
        <span>${tm.active ? 'Participa de la liga' : 'No participa de la liga'}</span>
      </div>
    </div>
    <div class="tcard-acts">
      <a class="btn btn-ghost btn-sm" href="/equipos/${escUrl(tm.slug)}" title="Ver en el sitio">Ver</a>
      <a class="btn btn-primary btn-sm" href="/admin/equipos/${tm.id}">Editar</a>
      <form method="post" action="/admin/equipos/${tm.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar equipo? Se borran sus jugadores.')">
        <button class="tcard-ghost" type="submit" title="Eliminar equipo" aria-label="Eliminar equipo">✕</button>
      </form>
    </div>
  </article>`;
    })
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Equipos</span>
    <h1>Equipos</h1>
    <p>Los clubes que participan de la liga, con su escudo y su nombre corto para las tablas.</p>
  </div>
  <a class="btn btn-primary" href="/admin/equipos/nuevo">+ Nuevo equipo</a>
</div>
<div class="dash-metrics">
  ${metric('Total', 'equipos', teams.length, 'm-blue', 'list')}
  ${metric('Activos', 'jugando la liga', activos, 'm-green', 'users')}
  ${metric('Inactivos', 'fuera de la liga', inactivos, 'm-amber', 'shield')}
</div>
<section class="block"><div class="card" style="padding:14px">
  <div class="tpage-filters">
    <div class="tpage-search">${icon('search', 15)}<input id="tSearch" type="search" placeholder="Buscar equipo por nombre…" aria-label="Buscar equipo"></div>
    <div class="tpage-tabs" role="group" aria-label="Filtrar por estado">
      <button type="button" class="tpage-tab on" data-activo="">Todos</button>
      <button type="button" class="tpage-tab" data-activo="1">Activos</button>
      <button type="button" class="tpage-tab" data-activo="0">Inactivos</button>
    </div>
  </div>
</div></section>
<section class="block"><div class="tpage-list" id="tList">
  ${cards || '<div class="empty-note">Sin equipos todavía. Creá el primero.</div>'}
  <div class="empty-note" id="tEmpty" style="display:none">Ningún equipo coincide con el filtro.</div>
</div></section>
<script>
  (function () {
    var list = document.getElementById('tList');
    var input = document.getElementById('tSearch');
    if (!list || !input) return;
    var tabs = [].slice.call(document.querySelectorAll('.tpage-tab'));
    var cards = [].slice.call(list.querySelectorAll('.tcard'));
    var vacio = document.getElementById('tEmpty');
    function sync() {
      var q = (input.value || '').trim().toLowerCase();
      var act = '';
      tabs.forEach(function (b) { if (b.classList.contains('on')) act = b.getAttribute('data-activo') || ''; });
      var visibles = 0;
      cards.forEach(function (c) {
        var ok = (act === '' || c.getAttribute('data-activo') === act) && (!q || (c.getAttribute('data-nombre') || '').indexOf(q) !== -1);
        c.style.display = ok ? '' : 'none';
        if (ok) visibles++;
      });
      if (vacio) vacio.style.display = visibles ? 'none' : '';
    }
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        sync();
      });
    });
    input.addEventListener('input', sync);
  })();
</script>`;
  return adminLayout(db, { title: 'Equipos', active: 'equipos', body });
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
  return adminLayout(db, { title: isEdit ? 'Editar equipo' : 'Nuevo equipo', active: 'equipos', body });
}

/* ============================== JUGADORES ============================== */

export async function playersAdminPage(db: D1Database, selectedTeamId?: number, msg?: string, errMsg?: string): Promise<string> {
  const teams = await listTeams(db, true);
  const selectedId = selectedTeamId ?? teams[0]?.id;
  const players = selectedId != null ? await listPlayers(db, selectedId, true) : [];
  const team = teams.find((tm) => tm.id === selectedId) ?? null;

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

  // Métricas reales del equipo seleccionado: plantilla y desglose por posición
  // (solo jugadores activos, mismo criterio del listado público).
  const POS_LABEL: Record<string, string> = { AR: 'arqueros', DF: 'defensores', MED: 'mediocampistas', DEL: 'delanteros' };
  const POS_TONE: Record<string, string> = { AR: 'm-amber', DF: 'm-blue', MED: 'm-violet', DEL: 'm-green' };
  const porPos = POSITION_ORDER.map((pos) => ({
    pos,
    n: players.filter((p) => p.position === pos && p.active).length,
  }));

  const metric = (label: string, sub: string, value: number, tone: string, ico: string) => `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico as 'users', 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;

  const cards = players
    .map(
      (p) => `<article class="tcard pcard ${p.active ? '' : 'off'}">
    <span class="pnum">${p.number != null ? esc(String(p.number)) : '—'}</span>
    <div class="tcard-tx">
      <div class="tcard-top"><strong>${esc(p.name)}</strong>${p.active ? '' : '<span class="badge ghost">Baja</span>'}</div>
      <div class="tcard-meta"><span>${p.position ? `<span class="pchip ${esc(p.position)}">${esc(p.position)}</span>` : 'Sin posición'}</span></div>
    </div>
    <div class="tcard-acts">
      <form method="post" action="/admin/jugadores/${p.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar jugador?')">
        <button class="tcard-ghost" type="submit" title="Eliminar jugador" aria-label="Eliminar jugador">✕</button>
      </form>
    </div>
  </article>`
    )
    .join('');

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Equipos</span>
    <h1>Jugadores</h1>
    <p>La plantilla de cada equipo: camiseta, nombre y posición.</p>
  </div>
  <form method="get" action="/admin/jugadores" class="pselect">
    <label for="teamPick">Equipo</label>
    <div class="tpage-search pselect-box">
      ${icon('users', 15)}
      <select id="teamPick" name="team" onchange="this.form.submit()">${teamOptions || '<option value="">Sin equipos — cargá equipos primero</option>'}</select>
    </div>
  </form>
</div>
${team
    ? `<div class="dash-metrics pmetrics">
  ${metric('Jugadores', `plantilla de ${team.name}`, players.length, 'm-blue', 'list')}
  ${porPos.map((x) => metric(x.pos, POS_LABEL[x.pos] ?? '', x.n, POS_TONE[x.pos] ?? 'm-green', 'shield')).join('')}
</div>`
    : ''}
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('bolt', 16)} Agregar jugador${team ? ` a ${esc(team.name)}` : ''}</h2></div>
  ${selectedId != null
    ? `<form method="post" action="/admin/jugadores" class="padd">
    <input type="hidden" name="team_id" value="${selectedId}">
    <div class="field grow"><label>Nombre</label><input type="text" name="name" required placeholder="Nombre y apellido"></div>
    <div class="field" style="max-width:90px"><label>#</label><input type="number" name="number" min="1" max="99"></div>
    <div class="field" style="max-width:130px"><label>Posición</label><select name="position">${positionOptions('')}</select></div>
    <button class="btn btn-primary" type="submit">+ Agregar</button>
  </form>`
    : '<div class="empty-note">Cargá un equipo primero para poder sumar jugadores.</div>'}
</div></section>
<section class="block"><div class="tpage-list">
  ${cards || `<div class="empty-note">Sin jugadores en este equipo.</div>`}
</div></section>`;
  return adminLayout(db, { title: 'Jugadores', active: 'jugadores', body });
}

/* ============================== FIXTURE ============================== */

export async function fixtureAdminPage(db: D1Database, slugParam: string | undefined, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, { title: 'Fixture', active: 'fixture', body: `${pageHead('Fixture')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
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

  // Zonas y fechas de zona: se necesitan acá (destinos del plan) y en el
  // cuadro de fechas libres de abajo.
  const crossoverRounds = crossoverRoundsOf(t.config);
  const activeTeamRows = teams.filter((x) => x.active);
  const regularKeys = roundKeys.filter((r) => !crossoverRounds.has(r));
  const crossoverKeys = roundKeys.filter((r) => crossoverRounds.has(r));
  const juegaEn = (teamId: number, round: number): boolean =>
    (byRound.get(round) ?? []).some((m) => m.home_team_id === teamId || m.away_team_id === teamId);

  // Fecha de cruce entre zonas: formulario + vista previa (solo con 2 zonas).
  const zones = zonesOf(t.config);
  const crossovers = parseCrossoverConfig(t.config);

  // Cuadro de fechas libres por equipo: en qué fechas cada equipo no tiene
  // partido asignado. Las fechas de zona van primero (F); las de cruce entre
  // zonas (C) van aparte, porque ahí solo juegan los emparejados y el resto
  // libra por diseño (no cuentan como carga desigual). Ordenado por más
  // fechas libres de zona, para ver si la carga quedó equilibrada.
  let freeDatesBlock = '';
  // Sugerencia ⭐ para el cuadro: la fecha con más equipos libres que aún
  // tiene partidos pendientes (la misma regla que usa la reposición).
  const sugerida = suggestMakeUpRound(byRound, regularKeys, activeTeamRows.map((x) => x.id));
  const libranPorEquipo = activeTeamRows
    .map((team) => ({
      team,
      libres: regularKeys.filter((r) => !juegaEn(team.id, r)),
    }))
    .filter((row) => row.libres.length > 0)
    .sort((a, b) => b.libres.length - a.libres.length || a.team.name.localeCompare(b.team.name));
  // Alerta de carga despareja: alguien con 2 o más fechas libres que el que
  // menos tiene (la tabla ordena de más a menos libres).
  const minLibres = libranPorEquipo[libranPorEquipo.length - 1]?.libres.length ?? 0;
  const desparejos = libranPorEquipo.filter((row) => row.libres.length >= minLibres + 2);
  const alertaDespareja =
    desparejos.length > 0
      ? `<div class="warning-box">⚠️ Carga despareja: ${desparejos
          .slice(0, 5)
          .map((row) => esc(row.team.name))
          .join(', ')}${desparejos.length > 5 ? ` y ${desparejos.length - 5} más` : ''} con ${desparejos[0]!.libres.length} fecha(s) libres, mientras hay equipos con solo ${minLibres}. Revisá los postergados y dónde los agendás.</div>`
      : '';
  if (libranPorEquipo.length > 0) {
    const cSep = 'border-left:1px dashed currentColor';
    const head = regularKeys
      .map((r) =>
        r === sugerida
          ? `<th style="text-align:center" title="Sugerida para agendar la reposición: es la fecha con más equipos libres que aún tiene partidos pendientes">F${r} ⭐</th>`
          : `<th style="text-align:center">F${r}</th>`
      )
      .join('');
    const headC = crossoverKeys
      .map(
        (r) =>
          `<th style="text-align:center;${cSep}" title="Fecha ${r} — Cruce entre zonas: solo juegan los emparejados"><span class="muted">C${r}</span></th>`
      )
      .join('');
    const rows = libranPorEquipo
      .map(
        (row) =>
          `<tr><td>${esc(row.team.name)}</td>${regularKeys
            .map((r) =>
              row.libres.includes(r)
                ? '<td style="text-align:center">□</td>'
                : '<td style="text-align:center"><span class="faint">—</span></td>'
            )
            .join('')}${crossoverKeys
            .map((r) =>
              juegaEn(row.team.id, r)
                ? `<td style="text-align:center;${cSep}"><span class="faint">—</span></td>`
                : `<td style="text-align:center;${cSep}">□</td>`
            )
            .join('')}</tr>`
      )
      .join('');
    const totals = regularKeys
      .map((r) => {
        const n = libranPorEquipo.filter((row) => row.libres.includes(r)).length;
        return `<td style="text-align:center">${n > 0 ? n : '<span class="faint">0</span>'}</td>`;
      })
      .join('');
    // En los cruces cuenta TODOS los activos: un equipo sin fechas libres de
    // zona (ni siquiera aparece en la tabla) también puede librar un cruce.
    const totalsC = crossoverKeys
      .map((r) => {
        const n = activeTeamRows.filter((team) => !juegaEn(team.id, r)).length;
        return `<td style="text-align:center;${cSep}">${n > 0 ? n : '<span class="faint">0</span>'}</td>`;
      })
      .join('');
    const sugNote =
      sugerida != null
        ? `<p class="hint">⭐ F${sugerida} es la sugerida para reciclar los postergados: es la fecha con más equipos libres que todavía tiene partidos pendientes.</p>`
        : '<p class="hint">Ninguna fecha tiene partidos pendientes para reciclar postergados: usá “Agendar fecha de reposición” para crear una fecha nueva al final.</p>';
    freeDatesBlock = `
<section class="block"><div class="card"><div class="card-body">
  <strong>Fechas libres por equipo</strong>
  ${alertaDespareja}
  <p class="hint">En qué fechas cada equipo no tiene partido asignado: por postergados sin reprogramar o porque la fecha tiene impar. Ordenado por más fechas libres de zona; los cruces (C) van aparte.</p>
  <div class="table-wrap"><table class="data">
    <thead><tr><th>Equipo</th>${head}${headC}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td><strong>Libres por fecha</strong></td>${totals}${totalsC}</tr></tfoot>
  </table></div>
  ${sugNote}
  <p class="hint">□ = fecha libre · <span class="muted">C</span> = cruce entre zonas: solo juegan los emparejados, el resto libra por diseño · ${libranPorEquipo.length} equipo(s) con fechas libres. Para llenar una fecha con lugar: “Agendar fecha de reposición” (arriba) o <a href="/admin/fixture/nuevo?t=${escUrl(t.slug)}">+ Partido suelto</a>.</p>
</div></div></section>`;
  }
  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    activeTeamRows.map((x) => ({ id: x.id, name: x.name })),
    rulesOf(t),
    await teamEffectsAdjustments(db, t.id)
  );
  const twoZones = zones.enabled && zones.zones.length === 2;
  // Playoff (llave opcional entre zonas): se habilita con todo jugado.
  const playoff = parsePlayoffConfig(t.config);
  let playoffBlock = '';
  if (twoZones) {
    if (playoff) {
      playoffBlock = `
<section class="block"><div class="card"><div class="card-body">
  <strong>Playoff generado</strong>
  <p class="hint">${esc(playoffFormatLabel(playoff.format))} — fecha ${playoff.round}. Los partidos de la llave aparecen abajo y en el sitio público, en la sección Llaves / Playoffs. Para rearmar la fase regular usá “Regenerar cruce”: la llave no se toca.</p>
</div></div></section>`;
    } else {
      const pending = pendingLeagueCount(matches);
      const noFixture = matches.length === 0;
      const ready = !noFixture && pending === 0;
      const statusNote = noFixture
        ? '<div class="warning-box">Primero generá el fixture: el playoff se arma cuando todas las fechas de zona estén jugadas.</div>'
        : pending > 0
          ? `<div class="warning-box">Faltan ${pending} partido(s) por jugar para habilitar el playoff.</div>`
          : '<p class="hint">✓ Todas las fechas de zona están jugadas: el playoff está listo para generar.</p>';
      playoffBlock = `
<section class="block"><div class="card"><div class="card-body">
  <strong>Playoff (llave opcional entre zonas)</strong>
  <p class="hint">Se genera cuando todas las fechas están jugadas. El ganador de la llave queda como campeón del torneo y los partidos no cuentan para la tabla de posiciones.</p>
  ${statusNote}
  <form method="post" action="/admin/fixture/playoff" class="form-row">
    <input type="hidden" name="tournament_id" value="${t.id}">
    <div class="field grow">
      <label>Formato</label>
      <select name="format">${PLAYOFF_FORMATS.map(
        (f) => `<option value="${f.value}">${esc(f.label)}</option>`
      ).join('')}</select>
    </div>
    <div class="field" style="align-self:flex-end">
      <button class="btn btn-primary" type="submit" ${ready ? '' : 'disabled'} onclick="return confirm('Se genera la llave del playoff según la tabla actual. ¿Continuar?')">Generar playoff</button>
    </div>
  </form>
</div></div></section>`;
    }
  }

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
      // Misma mezcla estable que el sitio público: la hora manda, el azar
      // desempata (si no, siempre encabeza la zona generada primero).
      const list = orderMatchesForDisplay(byRound.get(r)!, { tournamentId: t.id, round: r });
      const rows = list
        .map((m) => {
          const h = m.home_team_id != null ? teamMap.get(m.home_team_id)?.name : (m.home_source ? `→ ${m.home_source}` : 'Por definir');
          const a = m.away_team_id != null ? teamMap.get(m.away_team_id)?.name : (m.away_source ? `→ ${m.away_source}` : 'Por definir');
          return `<tr>
      <td class="num">${m.id}</td>
      <td>${esc(h ?? 'Por definir')} <span class="faint">vs</span> ${esc(a ?? 'Por definir')}</td>
      <td>${esc(m.zone || '')}${m.bracket_round ? ' ' + esc(BRACKET_LABELS[m.bracket_round] ?? m.bracket_round) : ''}${isCrossoverMatch(m) ? ' ' + crossoverBadge() : ''}</td>
      <td>${m.played_on ? esc(formatDateShort(m.played_on)) : ''} ${esc(m.kickoff_time || '')}</td>
      <td>${esc(m.venue || '')}</td>
      <td class="actions-cell">
        <a class="btn btn-ghost btn-sm" href="/admin/planilla/${m.id}">Planilla</a>
        <form method="post" action="/admin/fixture/${m.id}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar partido?')">
          <button class="tcard-ghost" type="submit" title="Eliminar partido" aria-label="Eliminar partido">✕</button>
        </form>
      </td>
    </tr>`;
        })
        .join('');
      const postp = list.filter((m) => m.status === 'postponed').length;
      const badges = [
        crossoverRounds.has(r) ? '<span class="badge green">Cruce entre zonas</span>' : '',
        postp > 0 ? `<span class="badge amber">${postp} postergado(s)</span>` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<h3 class="zone-title">Fecha ${r}${badges ? ' ' + badges : ''}</h3><div class="card"><div class="table-wrap"><table class="data">
    <thead><tr><th>ID</th><th>Partido</th><th>Zona / Ronda</th><th>Día y hora</th><th>Cancha</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
    })
    .join('');

  const teamPickOptions = tournaments
    .map((x) => `<option value="${escUrl(x.slug)}" ${x.slug === t.slug ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}${blockNote}${gapsNote}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Competencia</span>
    <h1>Fixture</h1>
    <p>Generá el fixture, revisá cada fecha y administrá los partidos del torneo.</p>
  </div>
  <form method="get" action="/admin/fixture" class="pselect">
    <label for="fxPick">Torneo</label>
    <div class="tpage-search pselect-box">
      ${icon('trophy', 15)}
      <select id="fxPick" name="t" onchange="this.form.submit()">${teamPickOptions}</select>
    </div>
  </form>
  <a class="btn btn-primary" href="/admin/fixture/nuevo?t=${t.slug}">+ Partido suelto</a>
</div>
<section class="block"><div class="dash-card fgen">
  <div class="dash-card-head"><h2>${icon('calendar', 16)} Generar fixture automático</h2><a href="/admin/fechas?t=${escUrl(t.slug)}">Asignar día, hora y cancha →</a></div>
  <form method="post" action="/admin/fixture/previsualizar" class="form-row">
    <input type="hidden" name="tournament_id" value="${t.id}">
    <div class="field grow">
      <label>Formato del torneo</label>
      <select name="mode">
        <option value="single">Ida (una vuelta)</option>
        <option value="double">Ida y vuelta</option>
      </select>
    </div>
${
  twoZones
    ? `<div class="field">
      <label>Regla de cruce</label>
      <select name="crossover_rule">${CROSSOVER_RULES.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join('')}</select>
    </div>
    <div class="field" style="align-self:flex-end">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="crossover_counts" style="width:auto"> Los cruces suman puntos</label>
    </div>
    <div class="field">
      <label>Cruces entre zonas</label>
      <select name="crossover_include">
        <option value="con">Con cruces (mezclados en el fixture)</option>
        <option value="sin">Sin cruces (solo partidos de zona)</option>
      </select>
    </div>
    <div class="field">
      <label>Fecha del cruce</label>
      <input type="number" name="crossover_round" min="1" placeholder="auto" style="width:90px">
    </div>`
    : ''
}
    <div class="field" style="align-self:flex-end">
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" type="submit" ${genBlocked ? 'disabled' : ''}>Preparar vista previa</button>
        <button class="btn btn-ghost" type="submit" formaction="/admin/fixture/regenerar" onclick="return confirm('Se rearman SOLO los cruces pendientes: los partidos jugados y sus resultados quedan intactos. ¿Continuar?')">↻ Regenerar cruce</button>
      </span>
    </div>
  </form>
  <p class="hint">Usa los equipos activos (${teams.filter((x) => x.active).length}). <strong>Generar</strong> arma todo de cero: con la opción de cruces eliges si hay fecha de cruce entre zonas, con qué regla y en qué fecha (vacío = automática, la primera libre después de las fechas de zona). Para cambiar un cruce ya generado hay que regenerar el fixture. <strong>Regenerar cruce</strong> es otra cosa: rearma solo los pendientes cuando entró un equipo nuevo, conservando lo jugado.</p>
  ${
    twoZones && crossovers.length
      ? `<p class="hint">Cruce vigente: fecha ${crossovers[0]!.round} · ${esc(crossovers[0]!.rule)}${crossovers[0]!.counts ? ' · suma puntos' : ' · no suma'}. Se reemplaza al generar de nuevo.</p>`
      : ''
  }
</div></section>
${playoffBlock}
${freeDatesBlock}
${roundSections || '<section class="block"><div class="card"><div class="card-body">Fixture vacío. Generá uno automático o agregá partidos.</div></div></section>'}`;
  return adminLayout(db, { title: 'Fixture', active: 'fixture', body });
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

  // Opciones por torneo: solo participantes. Mapa torneo → equipos para que
  // el JS actualice los selects al cambiar el torneo sin recargar la página.
  // Un equipo que ya figura en el partido (editando) entra igual, aunque hoy
  // no participe: no se rompe lo existente.
  const perTournament = new Map<number, Map<number, string>>();
  for (const x of tournaments) {
    const { teams: pool } = await participantsOrAllTeams(db, x.id);
    perTournament.set(x.id, new Map(pool.map((tm) => [tm.id, tm.name])));
  }
  if (m?.tournament_id != null && !perTournament.has(m.tournament_id)) {
    perTournament.set(m.tournament_id, new Map(teams.map((tm) => [tm.id, tm.name])));
  }
  const optionsFor = (tid: number, selected: number | null | undefined): string => {
    const pool = perTournament.get(tid) ?? new Map(teams.map((tm) => [tm.id, tm.name]));
    if (selected != null && !pool.has(selected)) pool.set(selected, teams.find((tm) => tm.id === selected)?.name ?? `#${selected}`);
    return (
      `<option value="" ${selected == null ? 'selected' : ''}>Por definir</option>` +
      [...pool.entries()]
        .map(([id, name]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`)
        .join('')
    );
  };
  const teamOptions = (selected: number | null | undefined) => optionsFor(t?.id ?? 0, selected);
  const teamsJson = esc(
    JSON.stringify([...perTournament.entries()].map(([tid, pool]) => ({ id: tid, teams: [...pool.entries()].map(([id, name]) => ({ id, name })) })))
  );

  const body = `
${flash('error', error)}
${pageHead(m ? `Editar partido #${m.id}` : 'Nuevo partido')}
<section class="block"><div class="card form-card"><div class="card-body">
  <script type="application/json" id="match-teams-data">${teamsJson}</script>
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
  <script>
  (function () {
    // Al cambiar el torneo, local y visitante muestran solo sus participantes.
    var data = JSON.parse(document.getElementById('match-teams-data').textContent);
    var form = document.querySelector('form[action*="/fixture"]');
    if (!form) return;
    var tsel = form.querySelector('select[name="tournament_id"]');
    var home = form.querySelector('select[name="home_team_id"]');
    var away = form.querySelector('select[name="away_team_id"]');
    if (!tsel || !home || !away) return;
    function byId(tid) { return data.find(function (x) { return x.id === Number(tid); }); }
    function fill(sel, pool, keep) {
      var current = keep != null ? String(keep) : sel.value;
      sel.innerHTML = '<option value=""' + (current === '' || !pool.some(function (p) { return String(p.id) === current; }) ? ' selected' : '') + '>Por definir</option>';
      pool.forEach(function (p) {
        var o = document.createElement('option');
        o.value = String(p.id); o.textContent = p.name;
        if (String(p.id) === current) o.selected = true;
        sel.appendChild(o);
      });
    }
    function sync() {
      var pool = (byId(tsel.value) || { teams: [] }).teams;
      // Al rearmar, si el valor actual ya no está en el pool, cae a "Por definir".
      fill(home, pool);
      fill(away, pool);
    }
    tsel.addEventListener('change', sync);
  })();
  </script>
</div></div></section>`;
  return adminLayout(db, { title: 'Partido', active: 'fixture', body });
}

/* ============================== PLANILLA (carga de resultado) ============================== */

export async function sheetListPage(db: D1Database, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, { title: 'Planilla', active: 'planilla', body: `${pageHead('Planilla')}<div class="card"><div class="card-body">Primero creá un torneo y su fixture.</div></div>` });
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
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Operación</span>
    <h1>Planillas</h1>
    <p>Cargá resultados, autores de gol y tarjetas de cada partido del torneo.</p>
  </div>
</div>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('clock', 16)} Pendientes</h2><span class="muted small">${pending.length} partido${pending.length === 1 ? '' : 's'}</span></div>
  <div class="table-wrap"><table class="data planillas-pend">
  <thead><tr><th></th><th>Partido</th><th class="num">Res.</th><th>Día</th><th></th></tr></thead>
  <tbody>${pending.map(row).join('') || '<tr><td colspan="5" class="empty-note">Nada pendiente 🎉</td></tr>'}</tbody>
  </table></div>
</div></section>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('shield', 16)} Últimos cargados</h2><span class="muted small">${esc(t.name)}</span></div>
  <div class="table-wrap"><table class="data planillas-done">
  <thead><tr><th></th><th>Partido</th><th class="num">Res.</th><th>Día</th><th></th></tr></thead>
  <tbody>${done.map(row).join('') || '<tr><td colspan="5" class="empty-note">Todavía no hay resultados.</td></tr>'}</tbody>
  </table></div>
</div></section>`;
  return adminLayout(db, { title: 'Planilla', active: 'planilla', body });
}

export async function sheetPage(db: D1Database, matchId: number, msg?: string, error?: string): Promise<string> {
  const m = await getMatch(db, matchId);
  if (!m) {
    return adminLayout(db, { title: 'Planilla', active: 'planilla', body: `${pageHead('Planilla')}<div class="error-box">Partido inexistente.</div>` });
  }
  const [teams, events] = await Promise.all([listTeams(db, true), listEvents(db, m.id)]);
  const teamMap = new Map(teams.map((tm) => [tm.id, tm]));
  const home = m.home_team_id != null ? teamMap.get(m.home_team_id) : null;
  const away = m.away_team_id != null ? teamMap.get(m.away_team_id) : null;

  const [homePlayers, awayPlayers] = await Promise.all([
    home ? listPlayers(db, home.id, true) : Promise.resolve([]),
    away ? listPlayers(db, away.id, true) : Promise.resolve([]),
  ]);

  // Elegibilidad: disciplina combinada del torneo evaluada para este partido.
  const eligibility = await disciplineForMatch(db, m);
  const suspended = new Map<number, PlayerEligibility>();
  if (eligibility) {
    for (const p of [...homePlayers, ...awayPlayers]) {
      const el = playerEligibility(eligibility, p.id);
      if (!el.eligible) suspended.set(p.id, el);
    }
  }
  const suspendedBadge = (playerId: number): string => {
    const el = suspended.get(playerId);
    if (!el) return '';
    const parts = el.reasons.map((r) => {
      const origen = r.source === 'auto' ? 'Automática' : 'Manual';
      const rest = r.remaining != null ? ` · ${r.remaining} fecha${r.remaining === 1 ? '' : 's'}` : '';
      const rev = r.needsReview ? ' · revisar' : '';
      return `${origen}: ${esc(r.reason)}${rest}${rev}`;
    });
    return ` 🚫 Suspendido (${parts.join(' | ')})`;
  };
  const suspendedNotice = (sidePlayers: typeof homePlayers, sideName: string): string => {
    const list = sidePlayers.filter((p) => suspended.has(p.id));
    if (list.length === 0) return '';
    const rows = list
      .map((p) => `<li><strong>${esc(p.name)}</strong> — ${suspendedBadge(p.id).replace(' 🚫 Suspendido ', '')}</li>`)
      .join('');
    return `<div class="error-box" data-suspended-notice><strong>Jugadores suspendidos · ${esc(sideName)}:</strong><ul>${rows}</ul><p class="hint" style="margin:0">No pueden ser incluidos en eventos de este partido.</p></div>`;
  };

  const playerOptions = (list: typeof homePlayers) =>
    list
      .map(
        (p) =>
          `<option value="${p.id}">${p.number != null ? `#${p.number} ` : ''}${esc(p.name)}${suspendedBadge(p.id)}</option>`
      )
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

  // Listas de autores DENTRO del form principal: un <select> por gol,
  // prellenado con lo que ya está cargado del equipo. Se despliegan solas
  // según la cantidad de goles declarada (mini-script al pie del form).
  const goalPicks = (side: 'home' | 'away') => {
    const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
    const label = side === 'home' ? (home?.name ?? 'Local') : (away?.name ?? 'Visitante');
    const players = side === 'home' ? homePlayers : awayPlayers;
    const prefix = side === 'home' ? 'hg' : 'ag';
    const pre = picksFromEvents(
      events.map((e) => ({ teamId: e.team_id, type: e.type, playerId: e.player_id })),
      teamId
    );
    const goalSelect = (i: number) => {
      const sel = pre[i] ?? '';
      const opts = scorerOptions({ index: i, teamName: label, players })
        .map((o) => {
          const pid = Number(o.value);
          const extra = Number.isInteger(pid) && pid > 0 ? suspendedBadge(pid) : '';
          return `<option value="${o.value}"${o.value !== '' && o.value === sel ? ' selected' : ''}>${esc(o.label)}${extra}</option>`;
        })
        .join('');
      return `<div class="field" data-pick><label>Gol ${i + 1} · ${esc(label)}</label><select name="${prefix}${i + 1}">${opts}</select></div>`;
    };
    return `<div class="goal-picks" data-goal-picks="${prefix}">${Array.from({ length: MAX_GOALS }, (_, i) => goalSelect(i)).join('')}</div>`;
  };

  const evBlock = (side: 'home' | 'away') => {
    const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
    const players = side === 'home' ? homePlayers : awayPlayers;
    const sideName = side === 'home' ? (home?.name ?? 'Local') : (away?.name ?? 'Visitante');
    return `<div class="dash-card">
  <div class="dash-card-head"><h2>${icon('card', 16)} Eventos · ${esc(sideName)}</h2></div>
  ${suspendedNotice(players, sideName)}
  ${teamDisciplineNotice(eligibility, teamId)}
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
  const body = `
${flash('success', msg)}${flash('error', error)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Operación</span>
    <h1>Planilla · ${esc(home?.name ?? 'Por definir')} vs ${esc(away?.name ?? 'Por definir')}</h1>
    <p>Estado del partido, resultado con autores y eventos, en una sola pantalla.</p>
  </div>
  <a class="btn btn-ghost" href="/partido/${m.id}">Ver ficha pública ↗</a>
</div>
<section class="block"><form method="post" action="/admin/planilla/${m.id}">
  <div class="dash-card">
    <div class="dash-card-head"><h2>${icon('ball', 16)} Estado y resultado</h2></div>
    <div class="form-row">
      <div class="field">
        <label>Estado del partido</label>
        <select name="status">
          ${['scheduled', 'played', 'postponed', 'suspended', 'walkover']
            .map((s) => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${{ scheduled: 'Programado', played: 'Jugado', postponed: 'Postergado', suspended: 'Suspendido', walkover: 'Walkover' }[s] ?? s}</option>`)
            .join('')}
        </select>
      </div>
    </div>
    <div class="dash-sub">Datos del partido</div>
    <div class="form-row">
      <div class="field"><label>Fecha jugado</label><input type="date" name="played_on" value="${esc(m.played_on ?? '')}"></div>
      <div class="field"><label>Hora</label><input type="time" name="kickoff_time" value="${esc(m.kickoff_time ?? '')}"></div>
      <div class="field"><label>Cancha</label><input type="text" name="venue" value="${esc(m.venue ?? '')}"></div>
    </div>
    <div class="dash-sub">Resultado</div>
    <div class="form-row">
      <div class="field"><label>Goles local</label><input type="number" name="home_goals" min="0" max="20" value="${m.home_goals}"></div>
      <div class="field"><label>Goles visitante</label><input type="number" name="away_goals" min="0" max="20" value="${m.away_goals}"></div>
    </div>
    <p class="hint"><strong>¿Quién hizo los goles?</strong> Elegí el autor de cada uno: jugador de la plantilla, “En contra” (gol en el arco propio, suma para el rival) o “Sin autor”.</p>
    <div class="dash-sub">Autores de goles · ${esc(home?.name ?? 'Local')}</div>
    ${goalPicks('home')}
    <div class="dash-sub">Autores de goles · ${esc(away?.name ?? 'Visitante')}</div>
    ${goalPicks('away')}
    <p class="hint">Al guardar, los goles del partido se reemplazan con lo declarado acá: nunca se duplican ni se suman de más. Si un equipo no tiene plantilla cargada, sus goles quedan sin autor (salvo los “En contra”).</p>
    <script>
      (function () {
        function sync(prefix, input) {
          var n = Math.max(0, Math.min(parseInt(input.value || '0', 10) || 0, 20));
          var picks = document.querySelectorAll('[data-goal-picks="' + prefix + '"] [data-pick]');
          for (var i = 0; i < picks.length; i++) picks[i].hidden = i >= n;
        }
        [['hg', 'home_goals'], ['ag', 'away_goals']].forEach(function (pair) {
          var input = document.getElementsByName(pair[1])[0];
          if (!input) return;
          var update = function () { sync(pair[0], input); };
          input.addEventListener('input', update);
          update();
        });
      })();
    </script>
  </div>
  <div class="dash-card" style="margin-top:14px">
    <div class="dash-card-head"><h2>${icon('chart', 16)} Ajustes y notas</h2></div>
    <div class="form-row">
      <div class="field"><label>Puntos local (override)</label><input type="number" name="home_points" min="0" max="3" value="${m.home_points ?? ''}" placeholder="auto"></div>
      <div class="field"><label>Puntos visitante (override)</label><input type="number" name="away_points" min="0" max="3" value="${m.away_points ?? ''}" placeholder="auto"></div>
    </div>
    <div class="field"><label>Notas</label><textarea name="notes" style="min-height:60px">${esc(m.notes ?? '')}</textarea></div>
    <button class="btn btn-primary" type="submit">Guardar planilla</button>
  </div>
</form></section>
${submissionsBlock}
<section class="block grid-2">
${evBlock('home')}
${evBlock('away')}
</section>`;
  return adminLayout(db, { title: 'Planilla', active: 'planilla', body });
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

/**
 * Sección de reposición de partidos postergados (tarjeta naranja del panel
 * de Fechas). La lógica y el POST son los mismos de siempre: solo cambió de
 * pantalla (antes vivía en Fixture). Devuelve vacío si no hay postergados.
 */
function makeUpSectionHtml(
  t: Tournament,
  matches: Match[],
  teams: Team[],
  byRound: Map<number, Match[]>,
  roundKeys: number[]
): string {
  const postponed = postponedMatches(matches);
  if (postponed.length === 0) return '';
  const crossoverRounds = crossoverRoundsOf(t.config);
  const regularKeys = roundKeys.filter((r) => !crossoverRounds.has(r));
  const activeTeamRows = teams.filter((x) => x.active);
  // Sugerencia ⭐: fecha de zona con más equipos libres que todavía tenga
  // partidos pendientes (para reciclar postergados ahí en vez de al final).
  const sugerida = suggestMakeUpRound(byRound, regularKeys, activeTeamRows.map((x) => x.id));
  // Destinos del plan: la sugerida (⭐, preseleccionada), el resto de las
  // fechas con partidos pendientes y una fecha nueva al final.
  const destinos: { round: number | null; label: string }[] = [
    ...(sugerida != null ? [{ round: sugerida as number | null, label: `Reciclar en la fecha ${sugerida} (sugerida ⭐)` }] : []),
    ...regularKeys
      .filter(
        (r) =>
          r !== sugerida &&
          (byRound.get(r) ?? []).some((m) => m.status === 'scheduled' || m.status === 'postponed')
      )
      .map((r) => ({ round: r as number | null, label: `Reciclar en la fecha ${r}` })),
    { round: null, label: 'Fecha nueva al final (según capacidad)' },
  ];
  const schedule = scheduleOf(t.config);
  const maxRound = roundKeys.length ? Math.max(...roundKeys) : 0;
  const plan = buildMakeUpPlan(postponed, maxRound, schedule);
  const equiposLibran = new Set<number>();
  for (const m of postponed) {
    if (m.home_team_id != null) equiposLibran.add(m.home_team_id);
    if (m.away_team_id != null) equiposLibran.add(m.away_team_id);
  }
  const planText = plan
    .map(
      (b) =>
        `Fecha ${b.round}${b.played_on ? ` (${formatDateShort(b.played_on)})` : ''}: ${b.matches.length} partido(s)`
    )
    .join(' · ');
  return `
<section class="block"><div class="dash-card fmakeup">
  <div class="dash-card-head"><h2>${icon('clock', 16)} Partidos postergados pendientes de reposición</h2></div>
  <p class="hint">${postponed.length} partido(s) no entraron en las canchas y horarios del torneo y quedaron pendientes: ${equiposLibran.size} equipo(s) tienen fechas libres hasta que se jueguen. Plan sugerido: ${planText}.</p>
  <form method="post" action="/admin/fixture/reposicion" class="form-row">
    <input type="hidden" name="tournament_id" value="${t.id}">
    <div class="field grow">
      <label>¿Dónde agendar los postergados?</label>
      <select name="destino">${destinos
        .map((d) => `<option value="${d.round ?? 'nueva'}"${d.round === sugerida ? ' selected' : ''}>${esc(d.label)}</option>`)
        .join('')}</select>
    </div>
    <div class="field" style="align-self:flex-end">
      <button class="btn btn-primary" type="submit" onclick="return confirm('Se reubican TODOS los partidos postergados en la fecha elegida (o al final, según la capacidad de canchas). ¿Continuar?')">Agendar fecha de reposición</button>
    </div>
  </form>
  <p class="hint">Alternativa: reprogramalos de a uno acá mismo, con la grilla de arriba o editando cada partido.</p>
</div></section>`;
}

export async function roundsSchedulePage(db: D1Database, slugParam: string | undefined, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, { title: 'Fechas', active: 'fechas', body: `${pageHead('Fechas')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
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
      // Misma mezcla estable que el fixture público: el orden no delata la
      // zona que se generó primero. El guardado usa los ids en el name, así
      // que el orden visual no afecta nada.
      // Manija de arrastre: al soltar una fila sobre otra de la misma fecha
      // se intercambian hora y cancha (el script de abajo hace el cambio en
      // el formulario; nada se guarda hasta apretar "Guardar fecha").
      const rows = orderMatchesForDisplay(byRound.get(r) ?? [], { tournamentId: t.id, round: r })
        .map(
          (m) => `<tr draggable="true" data-match="${m.id}">
      <td class="drag-cell"><span class="drag-handle" title="Arrastrá hasta otra fila de esta fecha para intercambiar horario y cancha (o tocá dos filas)">⋮⋮</span></td>
      <td>${esc(teamMap.get(m.home_team_id ?? -1)?.name ?? '—')} <span class="faint">vs</span> ${esc(teamMap.get(m.away_team_id ?? -1)?.name ?? '—')}</td>
      <td><input type="date" name="d_${m.id}" value="${esc(m.played_on || plannedRoundDate(schedule, r))}"></td>
      <td>${kickoffCell(m, schedule.kickoffs)}</td>
      <td>${venueCell(m, schedule.venues)}</td>
    </tr>`
        )
        .join('');
      return `<form method="post" action="/admin/fechas/guardar"><input type="hidden" name="tournament_id" value="${t.id}"><input type="hidden" name="round" value="${r}"><h3 class="zone-title">Fecha ${r}</h3><div class="dash-card"><div class="table-wrap"><table class="data">
    <thead><tr><th></th><th>Partido</th><th>Día</th><th>Hora</th><th>Cancha</th></tr></thead>
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

  const teamPickOptions = tournaments
    .map((x) => `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');
  const body = `
${flash('success', msg)}${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Operación</span>
    <h1>Fechas</h1>
    <p>Día, hora y cancha de cada fecha: arrastrá para intercambiar y guardá cuando esté listo.</p>
  </div>
  ${tournaments.length > 1 ? `<form method="get" action="/admin/fechas" class="pselect"><label for="fcPick">Torneo</label><div class="tpage-search pselect-box">${icon('trophy', 15)}<select id="fcPick" name="t" onchange="this.form.submit()">${teamPickOptions}</select></div></form>` : ''}
</div>
${sections || '<div class="card"><div class="card-body">Fixture vacío.</div></div>'}
${makeUpSectionHtml(t, matches, teams, byRound, [...byRound.keys()].sort((a, b) => a - b))}
<p class="hint">Arrastrá una fila (⋮⋮) y soltala sobre otra de la <strong>misma fecha</strong> —o tocá una fila y después otra— para intercambiarles horario y cancha. Funciona igual en la computadora y en el celular. Nada se guarda hasta apretar “Guardar fecha”. Si un equipo pidió otro horario, alcanza con arrastrar (o tocar) su partido sobre el que hoy ocupa ese horario.</p>
<script>
  (function () {
    var dragged = null;      // fila en arrastre (mouse o dedo)
    var selected = null;     // fila elegida con el primer toque (fallback)
    var lastDragEnd = 0;     // instante del fin de un arrastre táctil: anula el click sintético

    function field(row, prefix) {
      return row.querySelector('[name="' + prefix + row.getAttribute('data-match') + '"]');
    }
    function applySwap(a, b) {
      ['t_', 'v_'].forEach(function (prefix) {
        var ea = field(a, prefix), eb = field(b, prefix);
        if (!ea || !eb) return;
        var tmp = ea.value;
        ea.value = eb.value;
        eb.value = tmp;
      });
      [a, b].forEach(function (row) {
        row.classList.add('swap-flash');
        setTimeout(function () { row.classList.remove('swap-flash'); }, 900);
      });
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (err) {}
    }
    function sameForm(a, b) { return a.parentElement === b.parentElement; }

    // ---------- Fallback por toques: tocar una fila y después otra ----------
    function clearSelection() {
      if (selected) selected.classList.remove('tap-selected');
      selected = null;
    }

    // ---------- Arrastre táctil desde la manija ----------
    function touchGhost(x, y) {
      var g = document.getElementById('drag-ghost');
      if (!g) {
        g = document.createElement('div');
        g.id = 'drag-ghost';
        g.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:8px;padding:4px 10px;font-size:0.8rem;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,0.25);opacity:0.9;';
        document.body.appendChild(g);
      }
      g.textContent = '↕ intercambiando…';
      g.style.left = x + 14 + 'px';
      g.style.top = y + 14 + 'px';
      g.style.display = 'block';
    }
    function ghostOff() {
      var g = document.getElementById('drag-ghost');
      if (g) g.style.display = 'none';
    }
    function rowUnder(x, y, except) {
      var el = document.elementFromPoint(x, y);
      var row = el ? el.closest('tr[data-match]') : null;
      return row && row !== except ? row : null;
    }

    var forms = document.querySelectorAll('form[action="/admin/fechas/guardar"]');
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        var rows = form.querySelectorAll('tbody tr[data-match]');
        for (var j = 0; j < rows.length; j++) {
          (function (row) {
            // ----- Arrastre con mouse (igual que antes) -----
            row.addEventListener('dragstart', function (e) {
              dragged = row;
              row.classList.add('dragging');
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', row.getAttribute('data-match')); } catch (err) {}
            });
            row.addEventListener('dragend', function () {
              row.classList.remove('dragging');
              for (var k = 0; k < rows.length; k++) rows[k].classList.remove('drop-target');
              dragged = null;
            });
            row.addEventListener('dragover', function (e) {
              // Solo filas de la misma tabla (misma fecha) aceptan el drop.
              if (!dragged || dragged === row || !sameForm(dragged, row)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              row.classList.add('drop-target');
            });
            row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
            row.addEventListener('drop', function (e) {
              e.preventDefault();
              row.classList.remove('drop-target');
              if (dragged && dragged !== row && sameForm(dragged, row)) applySwap(dragged, row);
            });

            // ----- Arrastre con el dedo: solo arrancando desde la manija -----
            // El resto de la fila queda libre para hacer scroll.
            var handle = row.querySelector('.drag-handle');
            if (handle) {
              var t = null; // toque activo
              handle.addEventListener('touchstart', function (e) {
                t = e.changedTouches[0];
                touched = false;
              }, { passive: true });
              handle.addEventListener('touchmove', function (e) {
                if (!t) return;
                var cur = e.changedTouches[0];
                if (!dragged) {
                  var dx = cur.clientX - t.clientX, dy = cur.clientY - t.clientY;
                  if (dx * dx + dy * dy < 144) return; // umbral anti-toque accidental
                  dragged = row;
                  row.classList.add('dragging');
                  clearSelection();
                }
                e.preventDefault(); // sin esto, la página scrollea en vez de arrastrar
                touchGhost(cur.clientX, cur.clientY);
                var over = rowUnder(cur.clientX, cur.clientY, row);
                for (var k = 0; k < rows.length; k++) {
                  rows[k].classList.toggle('drop-target', rows[k] === over);
                }
              }, { passive: false });
              handle.addEventListener('touchend', function (e) {
                var cur = e.changedTouches[0];
                if (dragged === row) {
                  var over = rowUnder(cur.clientX, cur.clientY, row);
                  if (over && sameForm(row, over)) applySwap(row, over);
                  row.classList.remove('dragging');
                  for (var k = 0; k < rows.length; k++) rows[k].classList.remove('drop-target');
                  ghostOff();
                  dragged = null;
                  t = null;
                  lastDragEnd = Date.now(); // el click sintético posterior no debe seleccionar
                }
              });
              handle.addEventListener('touchcancel', function () {
                if (dragged === row) {
                  row.classList.remove('dragging');
                  for (var k = 0; k < rows.length; k++) rows[k].classList.remove('drop-target');
                  ghostOff();
                  dragged = null;
                  t = null;
                }
              });
            }

            // ----- Selección por toques: primera fila marca, segunda intercambia -----
            row.addEventListener('click', function (e) {
              // Los clics que salen de controles reales no seleccionan.
              if (e.target.closest('input, select, button, a')) return;
              if (dragged) return; // arrastre en curso: no es un toque de selección
              if (Date.now() - lastDragEnd < 600) return; // recién terminó un arrastre táctil
              if (!selected) {
                selected = row;
                row.classList.add('tap-selected');
                return;
              }
              if (selected === row) { clearSelection(); return; } // segundo toque en la misma: desmarca
              if (!sameForm(selected, row)) { // otra fecha: cambia la selección
                clearSelection();
                selected = row;
                row.classList.add('tap-selected');
                return;
              }
              var a = selected;
              clearSelection();
              applySwap(a, row);
            });
          })(rows[j]);
        }
      })(forms[i]);
    }
  })();
</script>`;
  return adminLayout(db, { title: 'Fechas', active: 'fechas', body });
}

/* ============================== SUSPENSIONES (admin) ============================== */

export async function suspensionsAdminPage(db: D1Database, slugParam: string | undefined, msg?: string, errMsg?: string): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return adminLayout(db, { title: 'Suspensiones', active: 'suspensiones', body: `${pageHead('Suspensiones')}<div class="card"><div class="card-body">Primero creá un torneo.</div></div>` });
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

  // Disciplina unificada: automáticas + manuales (origen conservado, sin fusión).
  const today = leagueNow().date;
  const playedRounds = matches
    .filter((m) => m.status === 'played' || m.status === 'walkover')
    .map((m) => m.round ?? 0)
    .filter((r) => r > 0);
  const servedRemaining = (s: PlayerSuspension): number | null => {
    const rest = remainingSuspensionMatches(s, matches, maxRound);
    // Si tiene fechas pendientes, son exactamente las que le restan; si no,
    // ya cumplió: 0. null solo si no hay datos de partidos (no debería pasar
    // con un torneo con fixture).
    return rest.length > 0 ? rest.length : 0;
  };
  // Round del incidente de cada manual: el último round con partido del
  // equipo en la fecha del incidente (el incidente puede ser fuera de cancha:
  // si no se puede saber, null y el restante no se inventa).
  const incidentRoundOf = (s: SanctionRow): number | null => {
    if (!s.team_id) return null;
    const rounds = matches
      .filter((m) => (m.home_team_id === s.team_id || m.away_team_id === s.team_id) && m.played_on === s.incident_date)
      .map((m) => m.round)
      .filter((r): r is number => r != null);
    return rounds.length ? Math.max(...rounds) : null;
  };
  // Fase 8: cierre automático de sanciones cumplidas, en el punto donde el
  // tribunal consulta el estado. Idempotente; no toca anuladas ni historial.
  await closeFulfilledSanctions(db, t.id, { playedRounds, today, incidentRoundOf });
  const allSanctions = await sanctionsForTournament(db, t.id);
  const { active: discipline, archive: disciplineArchive } = combineDiscipline(
    suspensions.map((s) => ({ tournamentId: t.id, suspension: s, servedRemaining: servedRemaining(s) })),
    allSanctions.map((s) => ({
      sanction: s,
      incidentRound: incidentRoundOf(s),
      playedRounds,
      today,
    }))
  );

  // Nombres de jugadores sancionados (automáticas + manuales) en una sola tanda.
  // Y plantillas por equipo para el select del modal.
  const playerIds = new Set<number>();
  for (const s of suspensions) playerIds.add(s.playerId);
  for (const s of allSanctions) if (s.player_id != null) playerIds.add(s.player_id);
  const playerName = new Map<number, string>();
  for (const pid of playerIds) {
    const row = await db.prepare('SELECT name FROM players WHERE id = ?1').bind(pid).first<{ name: string }>();
    if (row) playerName.set(pid, row.name);
  }
  const playersOf = new Map<number, { id: number; name: string }[]>();
  for (const tm of teams) {
    const roster = await listPlayers(db, tm.id, true);
    playersOf.set(tm.id, roster.map((p) => ({ id: p.id, name: p.name })));
  }

  // Filas de AUTOMÁTICAS: remaining real calculado por la capa de disciplina
  // (no se recalcula en la UI).
  const autoRows: string = discipline
    .filter((e) => e.source === 'auto')
    .map((e) => {
      const nombre = (e.playerId != null ? playerName.get(e.playerId) : null) ?? '—';
      return `<tr>
      <td>${esc(nombre)}</td>
      <td>${esc(teamMap.get(e.teamId ?? -1)?.name ?? '—')}</td>
      <td>${esc(e.reason)}</td>
      <td class="num">${e.remaining ?? '—'}</td>
      <td><span class="badge red">Activa</span></td>
      <td><span class="badge ghost">Automática</span></td>
    </tr>`;
    })
    .join('');

  const scopeBadge = (scope: 'player' | 'team'): string =>
    scope === 'team' ? '<span class="badge ghost">Equipo</span> ' : '';
  const durationBadge = (d: DisciplineEntry['duration']): string => {
    if (d.kind === 'fechas') return `<span class="badge ghost">${d.amount} fecha${d.amount === 1 ? '' : 's'}</span>`;
    if (d.kind === 'dias') return `<span class="badge ghost">${d.amount} día${d.amount === 1 ? '' : 's'}</span>`;
    return `<span class="badge ghost">Hasta el ${esc(d.untilDate ?? '—')}</span>`;
  };
  // Medida disciplinaria: solo equipos (7B). Para jugador: vacío.
  const measureBadge = (e: DisciplineEntry): string => {
    if (e.measure == null) return '';
    const label = SANCTION_MEASURE_LABELS[e.measure];
    const detail =
      e.measure === 'perdida_puntos' ? ` (${e.duration.amount ?? 0} pt${e.duration.amount === 1 ? '' : 's'})`
      : e.measure === 'suspension_fechas' ? ` (${e.duration.amount ?? 0} fecha${(e.duration.amount ?? 0) === 1 ? '' : 's'})`
      : e.measure === 'suspension_dias' && e.duration.untilDate ? ` (hasta el ${esc(e.duration.untilDate)})`
      : '';
    const tone = e.measure === 'expulsion' ? 'red' : e.measure === 'advertencia' ? 'ghost' : 'amber';
    return `<span class="badge ${tone}">${esc(label)}${detail}</span>`;
  };
  const statusBadge = (status: SanctionStatus, annulReason?: string): string => {
    if (status === 'activa') return '<span class="badge red">Activa</span>';
    if (status === 'cumplida') return '<span class="badge green">Cumplida</span>';
    return `<span class="badge ghost">Anulada</span>${annulReason ? `<div class="small muted">Motivo de anulación: ${esc(annulReason)}</div>` : ''}`;
  };
  const manualRow = (e: DisciplineEntry, inHistory: boolean): string => {
    const name = e.scope === 'team' ? `Equipo ${teamMap.get(e.teamId ?? -1)?.name ?? '—'}` : playerName.get(e.playerId ?? -1) ?? '—';
    const orig = e.sanctionId != null ? allSanctions.find((s) => s.id === e.sanctionId) : undefined;
    const annulCell =
      e.status === 'anulada' && orig?.annul_reason
        ? `<div class="small muted">Motivo de anulación: ${esc(orig.annul_reason)}</div>`
        : '';
    return `<tr>
      <td>${scopeBadge(e.scope)}${esc(name)}${annulCell}</td>
      <td>${esc(teamMap.get(e.teamId ?? -1)?.name ?? '—')}</td>
      <td>${esc(e.reason)}</td>
      <td>${e.measure != null ? measureBadge(e) : durationBadge(e.duration)}</td>
      <td>${esc(e.originDate ?? '—')}</td>
      <td>${statusBadge(e.status)}</td>
      <td><span class="badge amber">Manual</span></td>
      <td class="actions-cell">${
        !inHistory && e.status === 'activa'
          ? `<form method="post" action="/admin/sanciones/${e.sanctionId}/anular" onsubmit="var m = prompt('Motivo de la anulación (obligatorio):'); if (!m || !m.trim()) return false; this.querySelector('input[name=annul_reason]').value = m.trim(); return true;">
              <input type="hidden" name="t" value="${escUrl(t.slug)}">
              <input type="hidden" name="annul_reason" value="">
              <button class="btn btn-danger btn-sm" type="submit" title="Anular con motivo">Anular</button>
            </form>`
          : ''
      }</td>
    </tr>`;
  };
  const manualRows: string = discipline
    .filter((e) => e.source === 'manual')
    .map((e) => manualRow(e, false))
    .join('');
  const historyRows: string = disciplineArchive.map((e) => manualRow(e, true)).join('');

  const teamPickOptions = tournaments
    .map((x) => `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`)
    .join('');
  const metric = (label: string, sub: string, value: number, tone: string, ico: string) => `
  <div class="dash-metric ${tone}">
    <span class="dash-metric-ico">${icon(ico as 'card', 18)}</span>
    <span class="dash-metric-tx"><span class="dash-metric-lbl">${esc(label)}</span><span class="dash-metric-num">${value}</span><span class="dash-metric-sub">${esc(sub)}</span></span>
    <span class="dash-metric-bar"><span></span></span>
  </div>`;
  const categorias = ['Agresión', 'Pelea / desmanes', 'Conducta antideportiva', 'Incidente con árbitro', 'Incidente con otro equipo', 'Incumplimiento reglamentario', 'Otro'];
  const manualActive = discipline.filter((e) => e.source === 'manual');
  const affectedTeams = new Set<number>([...discipline, ...disciplineArchive].map((e) => e.teamId).filter((x): x is number => x != null));
  const body = `
${flash('success', msg)}
${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Administración</span>
    <h1>Suspensiones</h1>
    <p>Las automáticas se calculan con las tarjetas cargadas; las disciplinarias las registra el tribunal de la liga.</p>
  </div>
  <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
    <form method="get" action="/admin/suspensiones" class="pselect">
      <label for="spPick">Torneo</label>
      <div class="tpage-search pselect-box">${icon('trophy', 15)}<select id="spPick" name="t" onchange="this.form.submit()">${teamPickOptions}</select></div>
    </form>
    <button class="btn btn-primary" type="button" onclick="document.getElementById('sanctionModal').showModal()" style="margin-bottom:2px">+ Nueva sanción</button>
  </div>
</div>
<div class="dash-metrics">
  ${metric('Automáticas', 'por tarjetas', suspensions.length, 'm-red', 'card')}
  ${metric('Disciplinarias activas', 'del tribunal', manualActive.length, 'm-amber', 'shield')}
  ${metric('Equipos afectados', 'con sancionados', affectedTeams.size, 'm-blue', 'users')}
</div>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('shield', 16)} Reglas vigentes (automáticas)</h2></div>
  <p class="hint" style="margin:0">Roja = ${rules.redSuspensionMatches} partido(s). Amarillas: cada ${rules.yellowAccumulation || '—'} acumuladas = 1 partido ${rules.yellowAccumWindow ? `(ventana de ${rules.yellowAccumWindow} fechas)` : '(acumulación total)'}. Configurable en el torneo.</p>
</div></section>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('card', 16)} Suspensiones automáticas</h2><span class="badge ghost">${suspensions.length}</span></div>
  ${autoRows
    ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Jugador</th><th>Equipo</th><th>Motivo</th><th class="num">Fechas restantes</th><th>Estado</th><th>Origen</th></tr></thead>
      <tbody>${autoRows}</tbody>
    </table></div>`
    : '<div class="empty-note">Sin suspensiones automáticas 🎉</div>'}
</div></section>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('bolt', 16)} Sanciones disciplinarias</h2><span class="badge amber">${manualActive.length} activa${manualActive.length === 1 ? '' : 's'}</span></div>
  ${manualRows
    ? `<div class="table-wrap"><table class="data">
    <thead><tr><th>Afectado</th><th>Equipo</th><th>Categoría</th><th>Duración</th><th>Incidente</th><th>Estado</th><th>Origen</th><th></th></tr></thead>
    <tbody>${manualRows}</tbody>
  </table></div>`
    : '<div class="empty-note">Sin sanciones del tribunal 🎉</div>'}
  <details style="margin-top:10px" ${disciplineArchive.length ? 'open' : ''}>
    <summary style="cursor:pointer;font-weight:600">Historial (cumplidas y anuladas)${disciplineArchive.length ? ` · ${disciplineArchive.length}` : ''}</summary>
    ${historyRows
      ? `<div class="table-wrap" style="margin-top:8px"><table class="data">
      <thead><tr><th>Afectado</th><th>Equipo</th><th>Categoría</th><th>Duración</th><th>Incidente</th><th>Estado</th><th>Origen</th><th></th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table></div>`
      : '<p class="hint">Todavía no hay sanciones cumplidas ni anuladas.</p>'}
  </details>
</div></section>
<dialog id="sanctionModal" class="dash-modal">
  <form method="post" action="/admin/sanciones" class="dash-card fgen" style="max-width:640px">
    <input type="hidden" name="t" value="${escUrl(t.slug)}">
    <div class="dash-card-head"><h2>${icon('bolt', 16)} Nueva sanción</h2><button class="btn btn-ghost btn-sm" type="button" onclick="this.closest('dialog').close()" title="Cerrar">✕</button></div>
    <div class="form-row">
      <div class="field"><label>Alcance</label><select name="scope" id="skScope"><option value="player">Jugador</option><option value="team">Equipo</option></select></div>
      <div class="field"><label>Torneo</label><select name="tournament_id" disabled><option value="${t.id}" selected>${esc(t.name)}</option></select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Equipo</label><select name="team_id" required>${teams.map((tm) => `<option value="${tm.id}">${esc(tm.name)}</option>`).join('')}</select></div>
      <div class="field" id="skPlayerField"><label>Jugador</label><select name="player_id"><option value="">—</option>${teams
        .map((tm) => `<optgroup label="${esc(tm.name)}">${(playersOf.get(tm.id) ?? []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`)
        .join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="field grow"><label>Categoría</label><select name="category">${categorias.map((cat) => `<option>${esc(cat)}</option>`).join('')}</select></div>
      <div class="field"><label>Fecha del incidente</label><input type="date" name="incident_date" value="${today}"></div>
    </div>
    <div class="form-row">
      <div class="field" id="skMeasureField" style="display:none"><label>Medida</label><select name="measure" id="skMeasure"><option value="">Elegí…</option>${SANCTION_MEASURES.map((m) => `<option value="${m.value}">${esc(m.label)}</option>`).join('')}</select></div>
      <div class="field" id="skDurationField"><label>Duración</label><select name="duration_kind" id="skDuration"><option value="fechas">Fechas</option><option value="dias">Días</option><option value="hasta_fecha">Hasta fecha</option></select></div>
      <div class="field" id="skAmountField"><label>Cantidad</label><input type="number" name="amount" min="1" max="100" placeholder="Ej: 2"></div>
      <div class="field" id="skUntilField" style="display:none"><label>Hasta (inclusive)</label><input type="date" name="until_date"></div>
    </div>
    <p class="hint" id="skMeasureHint" style="display:none;margin:0"></p>
    <div class="field"><label>Descripción</label><input type="text" name="description" placeholder="Qué pasó (visible en el sitio)"></div>
    <div class="field"><label>Observaciones</label><input type="text" name="notes" placeholder="Notas internas (no se publican)"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-ghost" type="button" onclick="this.closest('dialog').close()">Cancelar</button>
      <button class="btn btn-primary" type="submit">Registrar sanción</button>
    </div>
  </form>
  <script>
  (function () {
    var dlg = document.getElementById('sanctionModal');
    if (!dlg) return;
    var scope = dlg.querySelector('#skScope');
    var playerField = dlg.querySelector('#skPlayerField');
    var measureField = dlg.querySelector('#skMeasureField');
    var measure = dlg.querySelector('#skMeasure');
    var measureHint = dlg.querySelector('#skMeasureHint');
    var durationField = dlg.querySelector('#skDurationField');
    var duration = dlg.querySelector('#skDuration');
    var amountField = dlg.querySelector('#skAmountField');
    var untilField = dlg.querySelector('#skUntilField');
    var hints = ${JSON.stringify(Object.fromEntries(SANCTION_MEASURES.map((m) => [m.value, m.hint])))};
    function sync() {
      var isTeam = scope.value === 'team';
      var m = measure ? measure.value : '';
      playerField.style.display = isTeam ? 'none' : '';
      measureField.style.display = isTeam ? '' : 'none';
      measureHint.style.display = isTeam && m && hints[m] ? '' : 'none';
      if (isTeam && m && hints[m]) measureHint.textContent = hints[m];
      if (!isTeam) {
        durationField.style.display = '';
        amountField.style.display = duration.value === 'hasta_fecha' ? 'none' : '';
        untilField.style.display = duration.value === 'hasta_fecha' ? '' : 'none';
        return;
      }
      // En equipos los campos dependen de la medida elegida.
      durationField.style.display = 'none';
      amountField.style.display = m === 'perdida_puntos' || m === 'suspension_fechas' ? '' : 'none';
      untilField.style.display = m === 'suspension_dias' ? '' : 'none';
      if (m === 'perdida_puntos') amountField.querySelector('label').textContent = 'Puntos a restar';
      else if (m === 'suspension_fechas') amountField.querySelector('label').textContent = 'Fechas de suspensión';
      else amountField.querySelector('label').textContent = 'Cantidad';
    }
    scope.addEventListener('change', sync);
    if (measure) measure.addEventListener('change', sync);
    duration.addEventListener('change', sync);
    sync();
  })();
  </script>
</dialog>`;
  return adminLayout(db, { title: 'Suspensiones', active: 'suspensiones', body });
}

/* ============================== VISTA PREVIA DEL FIXTURE ============================== */

const KIND_LABEL: Record<PlannedMatch['kind'], string> = {
  zona: '',
  global: '',
  cruce: 'Cruce',
};

/**
 * Página de vista previa: muestra el borrador guardado (día, cancha y hora
 * por partido) y los botones Confirmar / Descartar. Nada se toca hasta que
 * el admin confirma.
 */
export async function fixturePreviewPage(opts: {
  tournamentId: number;
  tournamentSlug: string;
  tournamentName: string;
  summary: string;
  payload: string;
  createdAt: string;
  teamNames: Map<number, string>;
}): Promise<string> {
  let plan: PlannedMatch[] = [];
  let crossoverOverflow: number[] = [];
  let crossoverAnchor: number | null = null;
  try {
    const parsed: unknown = JSON.parse(opts.payload);
    // Payload nuevo: { matches, crossover, crossoverOverflow }. Payload
    // viejo: array plano (sin declaración de cruce ni desborde).
    if (Array.isArray(parsed)) {
      plan = parsed as PlannedMatch[];
    } else if (parsed && typeof parsed === 'object') {
      const o = parsed as { matches?: unknown; crossover?: { round?: number } | null; crossoverOverflow?: unknown };
      if (Array.isArray(o.matches)) plan = o.matches as PlannedMatch[];
      if (typeof o.crossover?.round === 'number') crossoverAnchor = o.crossover.round;
      if (Array.isArray(o.crossoverOverflow)) {
        crossoverOverflow = o.crossoverOverflow.filter((x): x is number => typeof x === 'number');
      }
    }
  } catch {
    plan = [];
  }
  const porFecha = groupByFixtureRound(plan);
  const fechas = [...porFecha.keys()].sort((a, b) => a - b);
  // Estadística de cruces por fecha: en qué fechas quedaron y cuántos son.
  const crucesPorFecha = fechas
    .map((round) => ({ round, n: (porFecha.get(round) ?? []).filter((m) => m.kind === 'cruce').length }))
    .filter((x) => x.n > 0);
  const crucesStat =
    crucesPorFecha.length > 0
      ? `<div class="dash-card"><div class="dash-card-head"><h2>${icon('list', 16)} Cruces por fecha</h2></div><p class="hint" style="margin-top:0">Distribución de los partidos de cruce entre zonas en las fechas del borrador${crossoverAnchor != null ? ` (fecha elegida: ${crossoverAnchor})` : ''}.</p><div class="table-wrap"><table class="data"><thead><tr><th>Fecha</th><th>Cruces</th></tr></thead><tbody>${crucesPorFecha
          .map((x) => `<tr><td>Fecha ${x.round}${crossoverOverflow.includes(x.round) ? ' <span class="badge amber">desbordado</span>' : ''}</td><td>${x.n}</td></tr>`)
          .join('')}</tbody></table></div></div>`
      : '';
  // Aviso de desborde: cruces que no entraron en la fecha elegida y cayeron
  // en fechas siguientes (por falta de slots o equipos ya ocupados).
  const overflowNote =
    crossoverOverflow.length > 0
      ? `<div class="warning-box">⚠️ La fecha del cruce elegida (${crossoverAnchor ?? '—'}) no alcanzó para todos: ${crossoverOverflow
          .map((r) => `Fecha ${r}`)
          .join(', ')} quedaron cruces fuera de la fecha elegida. Si querés que entren todos ahí, elegí otra fecha con más lugares o generá sin cruces.</div>`
      : '';
  const sections = fechas
    .map((round) => {
      const list = porFecha.get(round)!;
      const day = list[0]?.day ?? '';
      const nombre = (id: number): string => opts.teamNames.get(id) ?? `#${id}`;
      const rows = list
        .map((m) => {
          const tipo =
            m.kind === 'cruce'
              ? `<span class="badge amber" title="Cruce entre zonas: no suma a la tabla de zona">Cruce${m.counts ? ' (cuenta)' : ''}</span>`
              : esc(m.zone || '');
          return `<tr><td>${tipo}</td><td>${esc(nombre(m.home))} <span class="faint">vs</span> ${esc(nombre(m.away))}</td><td>${esc(m.venue || '')}</td><td>${esc(m.kickoff || '')}</td></tr>`;
        })
        .join('');
      return `<h3 class="zone-title">Fecha ${round}${day ? ` — ${esc(formatDateShort(day))}` : ''} <span class="faint small">(${list.length} partido(s))</span></h3>
<div class="dash-card"><div class="table-wrap"><table class="data">
  <thead><tr><th>Tipo</th><th>Equipos</th><th>Cancha</th><th>Hora</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div></div>`;
    })
    .join('');
  const cuando = opts.createdAt ? 'generada ' + esc(opts.createdAt) : 'recién';
  const body = `
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Competencia</span>
    <h1>Vista previa — ${esc(opts.tournamentName)}</h1>
    <p>Revisá el borrador antes de aplicarlo: nada cambia hasta que confirmes (${cuando}).</p>
  </div>
  <a class="btn btn-ghost" href="/admin/fixture?t=${escUrl(opts.tournamentSlug)}">← Volver al fixture</a>
</div>
<section class="block"><div class="dash-card fgen">
  <div class="dash-card-head"><h2>${icon('calendar', 16)} Resumen del borrador</h2></div>
  <strong>${esc(opts.summary)}</strong>
  ${overflowNote}
  <p class="hint">Revisá las fechas de abajo. Al confirmar se reemplaza TODO el fixture actual (solo se puede si no hay partidos jugados). Al descartar no cambia nada.</p>
  <span style="display:flex;gap:8px;flex-wrap:wrap">
    <form method="post" action="/admin/fixture/confirmar" style="display:inline">
      <input type="hidden" name="tournament_id" value="${opts.tournamentId}">
      <input type="hidden" name="t" value="${escUrl(opts.tournamentSlug)}">
      <button class="btn btn-primary" type="submit" onclick="return confirm('Se reemplaza TODO el fixture actual por la vista previa. ¿Continuar?')">✓ Confirmar y guardar fixture</button>
    </form>
    <form method="post" action="/admin/fixture/descartar" style="display:inline">
      <input type="hidden" name="tournament_id" value="${opts.tournamentId}">
      <input type="hidden" name="t" value="${escUrl(opts.tournamentSlug)}">
      <button class="btn btn-ghost" type="submit">✕ Descartar</button>
    </form>
  </span>
</div></section>
${
  crucesStat
    ? `<section class="block">${crucesStat}</section>
`
    : ''
}${sections || '<section class="block"><div class="card"><div class="card-body">El borrador está vacío o ilegible: volvé a preparar la vista previa.</div></div></section>'}`;
  return await adminLayout(null, { title: 'Vista previa del fixture', active: 'fixture', body });
}

/* Exportados para handlers */
export { slugify, generateRoundRobin, generateDoubleRoundRobin, shuffled, parseRules };
