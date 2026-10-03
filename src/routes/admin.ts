// Rutas del panel admin: auth + handlers CRUD.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import {
  clearSessionCookieHeader,
  createSessionToken,
  getSessionCookie,
  getSessionRole,
  hashPassword,
  safeEqual,
  sessionCookieHeader,
  sessionSecret,
} from '../lib/auth.ts';
import { slugify } from '../lib/slug.ts';
import { canAccessSportsAdmin } from '../lib/portalAccess.ts';
import type { EventType, Match } from '../lib/types.ts';
import { regeneratePairings, verifyPairings, slotConflicts, playedCount } from '../lib/fixture.ts';
import { resolveGoalPlan, picksWithoutRoster, MAX_GOALS, type GoalPick } from '../lib/sheet.ts';
import { eventBelongsToMatch, validateEventForm, validateSheetForm, splitRoster, isMatchStatus, EVENT_TYPE_LABELS, MATCH_STATUSES, MATCH_STATUS_LABELS } from '../lib/matchOps.ts';
import {
  ACTOR_ADMIN,
  cleanReason,
  delegateActor,
  diffEvents,
  diffMatch,
  eventChange,
  goalAuthorsChange,
  goalAuthorsLabel,
  insertMatchChanges,
  listMatchChanges,
  needsCancelReason,
  cancelReasonError,
} from '../lib/matchChanges.ts';
import { generateDelegateCode } from '../lib/delegates.ts';
import {
  roundSlots,
  scheduleFromForm,
  scheduleOf,
  regenerateRound,
  isRegenerable,
  plannedRoundDate,
  scheduleCapacity,
} from '../lib/schedule.ts';
import { zonesFromForm, zonesOf, validateZones } from '../lib/zones.ts';
import {
  type CompetitionConfig,
  type CompetitionFormat,
  DEFAULT_TIEBREAKERS,
  LOCALIA_MODES,
  PLAYOFF_START_ROUNDS,
  PLAYOFF_TIEBREAKS,
  TIEBREAKER_KEYS,
  ALL_FORMATS,
  competitionConfigJson,
  distributeGroups,
  formatHasGroups,
  formatHasPlayoffs,
  formatHasTable,
  isLegacyFormat,
  legacyToCompetitionFormat,
  parseCompetitionConfig,
  PLAYOFF_START_LABELS,
  PLAYOFF_START_SIZE,
} from '../lib/competition.ts';
import { validateCompetitionConfig } from '../lib/competitionRules.ts';
import { buildZonedFixture, interleaveSlots, shuffled } from '../lib/fixture.ts';
import {
  buildCrossoverPairs,
  crossoverConfigJson,
  crossoverRoundsOf,
  parseCrossoverConfig,
  parseCrossoverRule,
  matchesForStandings,
  type CrossoverDate,
} from '../lib/crossover.ts';
import {
  buildPlayoffPlan,
  parsePlayoffConfig,
  parsePlayoffFormat,
  playoffConfigJson,
  pendingLeagueCount,
  playoffFormatLabel,
  resolveAdvancements,
} from '../lib/playoff.ts';
import { buildMakeUpPlan, postponedMatches, overflowOfRound, pickDeferred, splitOverflowByZone } from '../lib/oversub.ts';
import {
  fixtureBlockedReason,
  matchEditsBlockedReason,
  participationBlockedReason,
  statusBlocksMatchEdits,
  statusBlocksParticipation,
  statusTransitionBlocked,
  transitionBlockedReason,
} from '../lib/status.ts';
import { planReschedule, type RescheduleRecord } from '../lib/reschedule.ts';
import {
  duplicateNumberMessage,
  playerRemovalPlan,
  teamDeletionPlan,
  validatePlayer,
  validateTeam,
} from '../lib/roster.ts';
import {
  buildBracketPlan,
  bracketConfigJson,
  bracketHasPlayed,
  entrantsFromGroupTables,
  entrantsFromTable,
  parseBracketConfig,
  type GroupTable,
} from '../lib/playoffsBracket.ts';
import { planFixture, planSummary } from '../lib/planifier.ts';
import { CROSSOVER_NOTE, CROSSOVER_NOTE_COUNTS } from '../lib/crossover.ts';
import { computeStandings } from '../lib/standings.ts';
import { rulesOf } from '../lib/rules.ts';
import { resolveTournament } from '../lib/tournamentView.ts';
import { getMatch, getPlayer, getTeam, listEvents, listPlayers, playerUsage, teamUsage } from '../lib/queries.ts';
import { playerEligibility, eligibilityErrorMessage, type PlayerEligibility } from '../lib/discipline.ts';
import { getSubmission } from '../lib/submissions.ts';
import { deleteAdjustment, insertAdjustment, parseAdjustment } from '../lib/adjustments.ts';
import {
  annulSanction,
  getSanction,
  insertSanction,
  parseAnnulment,
  parseSanction,
} from '../lib/sanctions.ts';
import {
  fixturePoolOfTournament,
  teamIdsOfTournament,
  participatingIdsFromForm,
  participantsOrAllTeams,
  participantsWithoutZone,
  replaceTournamentParticipation,
  zonedTeamIdsFromForm,
} from '../lib/participation.ts';
import { adjustmentsAdminPage } from '../ui/adminAjustes.ts';
import { calendarioAdminPage } from '../ui/adminCalendario.ts';
import { delegadosAdminPage, estadisticasAdminPage } from '../ui/adminStats.ts';
import * as admin from '../ui/admin.ts';

export const adminRoutes = new Hono<{ Bindings: Env }>();

export async function isAdmin(c: any): Promise<boolean> {
  const role = await getSessionRole(getSessionCookie(c.req.raw), sessionSecret(c.env));
  if (!role) return false;
  if (role === 'ADMIN') return true;
  return canAccessSportsAdmin(role, c.env.COMMUNITY_MANAGER_SPORTS_ADMIN);
}

/** Torneo del selector de Ajustes (por slug, o el activo). */
async function resolveTournamentForAdjustment(db: D1Database, slug?: string) {
  return resolveTournament(db, slug);
}

adminRoutes.use('*', async (c, next) => {
  const path = c.req.path;
  const isLogin = path === '/admin/login' || path === '/admin/logout';
  if (isLogin) return next();
  if (await isAdmin(c)) return next();
  return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
});

adminRoutes.get('/login', async (c) => {
  const next = c.req.query('next');
  return c.html(await admin.loginPage(undefined, next));
});

adminRoutes.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const password = String(form['password'] ?? '');
  const next = typeof form['next'] === 'string' ? form['next'] : '/admin';
  const adminPassword = sessionSecret(c.env);
  const communityPassword = c.env.COMMUNITY_MANAGER_PASSWORD;
  const [hashA, hashAdmin, hashCommunity] = await Promise.all([
    hashPassword(password),
    hashPassword(adminPassword),
    hashPassword(communityPassword || '\u0000community-manager-disabled'),
  ]);
  const role = safeEqual(hashA, hashAdmin)
    ? 'ADMIN'
    : communityPassword && safeEqual(hashA, hashCommunity)
      ? 'COMMUNITY_MANAGER'
      : null;
  if (!role) {
    return c.html(admin.loginPage('Contraseña incorrecta', next), 401);
  }
  const token = await createSessionToken(adminPassword, role);
  c.header('Set-Cookie', sessionCookieFor(token));
  const portalNext = next === '/portal-admin' || next.startsWith('/portal-admin/');
  const sportsNext = next === '/admin' || next.startsWith('/admin/');
  if (role === 'COMMUNITY_MANAGER') {
    const canUseRequestedArea =
      portalNext || (sportsNext && canAccessSportsAdmin(role, c.env.COMMUNITY_MANAGER_SPORTS_ADMIN));
    return c.redirect(canUseRequestedArea ? next : '/portal-admin');
  }
  return c.redirect(sportsNext ? next : '/admin');
});

function sessionCookieFor(token: string): string {
  // En localhost Secure no bloquea la cookie en Chrome/Firefox modernos (excepción para http://localhost).
  return sessionCookieHeader(token);
}

adminRoutes.get('/ayuda', (c) =>
  admin.helpPage(c.env.DB, c.req.query('q') ?? '').then((h) => c.html(h))
);

adminRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader());
  return c.redirect('/admin/login');
});

adminRoutes.get('/', (c) => admin.dashboardPage(c.env.DB, c.req.query('msg') ?? undefined, c.req.query('err') ?? undefined).then((html) => c.html(html)));

/* ---------- Delegados (vista consolidada) ---------- */

adminRoutes.get('/delegados', async (c) =>
  c.html(await delegadosAdminPage(c.env.DB, c.req.query('msg'), c.req.query('err')))
);

/* ---------- Estadísticas del torneo ---------- */

adminRoutes.get('/estadisticas', async (c) =>
  c.html(await estadisticasAdminPage(c.env.DB, c.req.query('t'), c.req.query('tab')))
);

/* ---------- Torneos ---------- */

adminRoutes.get('/torneos', (c) => admin.tournamentsPage(c.env.DB, c.req.query('msg'), c.req.query('err')).then((h) => c.html(h)));

adminRoutes.get('/torneos/nuevo', (c) => admin.tournamentFormPage(c.env.DB).then((h) => c.html(h)));

adminRoutes.post('/torneos', async (c) => {
  const f = await c.req.parseBody();
  const name = String(f['name'] ?? '').trim();
  if (!name) return c.html(await admin.tournamentFormPage(c.env.DB, undefined, 'El nombre es obligatorio'), 400);
  let slug = slugify(name);
  const existing = await c.env.DB.prepare('SELECT id FROM tournaments WHERE slug = ?1').bind(slug).first();
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;
  const rules = readRules(f);
  // Fase 10: configuración de competencia + validación. En un torneo nuevo
  // todavía no hay participantes guardados, así que el chequeo de "mínimo 2
  // equipos" lo hace la validación estructural del formato.
  const { comp, errors: compErrors } = competitionFromForm(f);
  if (compErrors.length > 0) {
    return c.html(
      await admin.tournamentFormPage(c.env.DB, undefined, compErrors.join(' ')),
      400
    );
  }
  const config = { ...rules, ...scheduleFromForm(f), zones: zonesFromForm(f), competition: competitionConfigJson(comp) };
  const res = await c.env.DB.prepare(
    'INSERT INTO tournaments (name, slug, season, format, config, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  )
    // El formato de la columna pasa a ser el de la configuración de
    // competencia; también se guarda tal cual en config.competition.format.
    .bind(name, slug, String(f['season'] ?? ''), comp.format, JSON.stringify(config), String(f['status'] ?? 'draft'))
    .run();
  // Participantes: los marcados "Participa" MÁS los que tienen zona elegida
  // (la zona conserva al equipo aunque su casilla venga desmarcada). Solo
  // cuenta si las zonas vienen activas: con zonas apagadas, los zone_of_* son
  // restos del DOM oculto y no deben forzar participación.
  const newId = res.meta.last_row_id;
  const zoned = f['zones_enabled'] ? zonedTeamIdsFromForm(f) : [];
  const ids = [...new Set([...participatingIdsFromForm(f), ...zoned])];
  await replaceTournamentParticipation(c.env.DB, newId, ids);
  return c.redirect('/admin/torneos?msg=' + encodeURIComponent('Torneo creado'));
});

adminRoutes.get('/torneos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  return c.html(await admin.tournamentFormPage(c.env.DB, id));
});

adminRoutes.post('/torneos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const name = String(f['name'] ?? '').trim();
  if (!name) return c.html(await admin.tournamentFormPage(c.env.DB, id, 'El nombre es obligatorio'), 400);
  // Preserva las fechas de cruce ya generadas: se guardan en la misma config
  // y este form no las toca.
  const prevRow = await c.env.DB.prepare('SELECT config, status, format FROM tournaments WHERE id = ?1').bind(id).first<{ config: string; status: string; format: string }>();
  // Fase 12C: transición de estado validada (el ciclo no vuelve hacia atrás).
  const fromStatus = prevRow?.status ?? 'draft';
  const toStatus = String(f['status'] ?? fromStatus);
  if (statusTransitionBlocked(fromStatus, toStatus)) {
    return c.html(
      await admin.tournamentFormPage(c.env.DB, id, transitionBlockedReason(fromStatus, toStatus)),
      400
    );
  }
  const rules = readRules(f);
  const prevConfigJson = prevRow?.config ?? '{}';
  const prevKeep = {
    ...crossoverConfigJson(parseCrossoverConfig(prevConfigJson)),
    ...playoffConfigJson(parsePlayoffConfig(prevConfigJson)),
  };
  // Fase 10: configuración de competencia + validación + bloqueos por estado.
  // El form viejo (tests y flujos que aún no mandan comp_format) conserva la
  // config que ya tenía el torneo: la estructura no cambia si no se toca.
  const prevComp = parseCompetitionConfig(prevConfigJson, prevRow?.format ?? 'round_robin');
  const formSendsCompetition = String(f['comp_format'] ?? '') !== '';
  const teamCount = (await teamIdsOfTournament(c.env.DB, id)).length;
  const { comp, errors: compErrors } = formSendsCompetition
    ? competitionFromForm(f, teamCount)
    : { comp: prevComp, errors: [] as string[] };
  if (structureChangeBlocked(prevRow?.status ?? 'draft', prevComp, comp)) {
    const estado = prevRow?.status === 'registrations' ? 'en inscripciones' : 'en curso';
    return c.html(
      await admin.tournamentFormPage(c.env.DB, id, `El torneo está ${estado}: la estructura competitiva (formato, grupos, playoffs) queda congelada. Podés ajustar puntos, desempates y localía.`),
      400
    );
  }
  if (compErrors.length > 0) {
    return c.html(await admin.tournamentFormPage(c.env.DB, id, compErrors.join(' ')), 400);
  }
  const config = { ...rules, ...scheduleFromForm(f), zones: zonesFromForm(f), ...prevKeep, competition: competitionConfigJson(comp) };
  await c.env.DB.prepare('UPDATE tournaments SET name = ?1, season = ?2, format = ?3, config = ?4, status = ?5 WHERE id = ?6')
    // El formato de la columna pasa a ser el de la configuración de
    // competencia (el form viejo no manda comp_format y conserva el previo).
    .bind(name, String(f['season'] ?? ''), comp.format, JSON.stringify(config), String(f['status'] ?? 'draft'), id)
    .run();
  // Participación al día en la misma edición: marcados "Participa" + los que
  // tienen zona (la zona conserva al equipo aunque su casilla esté apagada),
  // siempre que las zonas vengan activas en este guardado.
  // Batch atómico: queda la lista exacta del formulario, sin duplicados.
  // Fase 12C: si el estado (nuevo o anterior) bloquea participantes y el
  // torneo YA TIENE inscriptos, la participación queda EXACTAMENTE como
  // estaba: ni altas ni bajas. Un torneo sin inscriptos guardados (recién
  // creado, incluso directo en activo) acepta la carga inicial del form.
  const beforeIds = await teamIdsOfTournament(c.env.DB, id);
  if (beforeIds.length > 0 && (statusBlocksParticipation(toStatus) || statusBlocksParticipation(fromStatus))) {
    await replaceTournamentParticipation(c.env.DB, id, beforeIds);
  } else {
    const zoned = f['zones_enabled'] ? zonedTeamIdsFromForm(f) : [];
    const ids = [...new Set([...participatingIdsFromForm(f), ...zoned])];
    await replaceTournamentParticipation(c.env.DB, id, ids);
  }
  return c.redirect('/admin/torneos?msg=' + encodeURIComponent('Torneo actualizado'));
});

adminRoutes.post('/torneos/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM tournaments WHERE id = ?1').bind(id).run();
  return c.redirect('/admin/torneos?msg=' + encodeURIComponent('Torneo eliminado'));
});

/**
 * Avance automático de la llave: si un partido de playoff quedó decidido (o
 * definido por penales con puntos manuales), completa los equipos del
 * siguiente round que estaban esperando el ganador/perdedor.
 */
async function applyAdvancements(db: D1Database, tournamentId: number): Promise<void> {
  const rows = await db.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id').bind(tournamentId).all<Match>();
  const advancements = resolveAdvancements(rows.results ?? []);
  if (advancements.length === 0) return;
  const stmts: D1PreparedStatement[] = advancements.map((a) =>
    db
      .prepare(
        `UPDATE matches SET ${a.side === 'home' ? 'home_team_id' : 'away_team_id'} = ?1 WHERE id = ?2 AND ${a.side === 'home' ? 'home_team_id' : 'away_team_id'} IS NULL`
      )
      .bind(a.teamId, a.matchId)
  );
  await db.batch(stmts);
}

/**
 * Fase 10: lee la configuración de competencia del formulario y la valida.
 * Devuelve la config normalizada (para guardar) y los errores (en español,
 * listos para mostrar). teamCount = inscriptos actuales; en un torneo nuevo
 * todavía no hay participantes guardados y se pasa undefined.
 */
function competitionFromForm(
  f: Record<string, unknown>,
  teamCount?: number
): { comp: CompetitionConfig; errors: string[] } {
  const rawFormat = String(f['comp_format'] ?? '');
  const format: CompetitionFormat = (ALL_FORMATS as readonly string[]).includes(rawFormat)
    ? (rawFormat as CompetitionFormat)
    : 'TODOS_CONTRA_TODOS';
  const withGroups = formatHasGroups(format);
  const withPlayoffs = formatHasPlayoffs(format);
  const withTable = formatHasTable(format);

  const int = (k: string, fallback: number): number => {
    const n = Math.round(Number(f[k]));
    return Number.isFinite(n) ? n : fallback;
  };

  // Puntos: solo formatos con tabla. Aceptan 0 (reglas raras pero válidas);
  // la validación de negocio vive en validateCompetitionConfig.
  const points = withTable
    ? {
        win: Math.min(100, Math.max(0, int('comp_points_win', 3))),
        draw: Math.min(100, Math.max(0, int('comp_points_draw', 1))),
        loss: Math.min(100, Math.max(0, int('comp_points_loss', 0))),
      }
    : { win: 3, draw: 1, loss: 0 };

  // Desempates: llegan como comp_tb=1..6 (orden de prioridad del form).
  const tiebreakers: string[] = [];
  if (withTable) {
    for (let i = 1; i <= TIEBREAKER_KEYS.length; i++) {
      const v = String(f[`comp_tb_${i}`] ?? '');
      if ((TIEBREAKER_KEYS as readonly string[]).includes(v) && !tiebreakers.includes(v)) tiebreakers.push(v);
    }
  }

  const rawStart = String(f['comp_playoff_start'] ?? '');
  const rawTie = String(f['comp_playoff_tiebreak'] ?? '');
  const comp: CompetitionConfig = {
    format,
    hasPlayoffs: withPlayoffs,
    groupStage: withGroups
      ? {
          count: Math.min(8, Math.max(0, int('comp_groups', 2))),
          qualifiersPerGroup: Math.min(16, Math.max(1, int('comp_qualifiers', 2))),
        }
      : { count: 0, qualifiersPerGroup: 0 },
    playoffs: withPlayoffs
      ? {
          start: (PLAYOFF_START_ROUNDS as readonly string[]).includes(rawStart)
            ? (rawStart as (typeof PLAYOFF_START_ROUNDS)[number])
            : 'SF',
          singleMatch: f['comp_playoff_single'] === 'on',
          thirdPlace: f['comp_playoff_third'] === 'on',
          tiebreak: (PLAYOFF_TIEBREAKS as readonly string[]).includes(rawTie)
            ? (rawTie as (typeof PLAYOFF_TIEBREAKS)[number])
            : 'PENALES',
        }
      : { start: 'SF', singleMatch: false, thirdPlace: false, tiebreak: 'PENALES' },
    points,
    tiebreakers: withTable && tiebreakers.length > 0 ? (tiebreakers as CompetitionConfig['tiebreakers']) : [...DEFAULT_TIEBREAKERS],
    localia: (LOCALIA_MODES as readonly string[]).includes(String(f['comp_localia'] ?? ''))
      ? (String(f['comp_localia']) as CompetitionConfig['localia'])
      : 'ALTERNADA',
  };

  return { comp, errors: validateCompetitionConfig({ comp, teamCount }) };
}

/**
 * Fase 10D: ¿el estado del torneo permite cambiar la estructura competitiva
 * (formato, fases, grupos, playoffs)? BORRADOR: todo. INSCRIPCIONES: solo
 * cambios no estructurales (puntos, desempates, localía, detalles de
 * playoffs). ACTIVO y más: bloqueado.
 */
function structureChangeBlocked(status: string, prev: CompetitionConfig, next: CompetitionConfig): boolean {
  if (status === 'draft' || status === 'registrations') {
    if (status === 'draft') return false;
    // En inscripciones la estructura queda congelada: solo se acepta si el
    // esqueleto competitivo no cambió.
    return (
      prev.format !== next.format ||
      prev.groupStage.count !== next.groupStage.count ||
      prev.groupStage.qualifiersPerGroup !== next.groupStage.qualifiersPerGroup ||
      prev.playoffs.start !== next.playoffs.start ||
      prev.playoffs.singleMatch !== next.playoffs.singleMatch ||
      prev.playoffs.thirdPlace !== next.playoffs.thirdPlace
    );
  }
  // active / finished / archived: estructura congelada.
  return (
    prev.format !== next.format ||
    prev.groupStage.count !== next.groupStage.count ||
    prev.groupStage.qualifiersPerGroup !== next.groupStage.qualifiersPerGroup ||
    prev.playoffs.start !== next.playoffs.start ||
    prev.playoffs.singleMatch !== next.playoffs.singleMatch ||
    prev.playoffs.thirdPlace !== next.playoffs.thirdPlace
  );
}

function readRules(f: Record<string, unknown>) {
  const num = (k: string, fallback: number) => {
    const v = Number(f[k]);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
  };
  return {
    win: num('win', 3),
    draw: num('draw', 1),
    loss: num('loss', 0),
    walkoverGoals: num('walkoverGoals', 3),
    yellowAccumulation: num('yellowAccumulation', 0),
    yellowAccumWindow: num('yellowAccumWindow', 0),
    redSuspensionMatches: num('redSuspensionMatches', 1),
    showAdvanced: f['showAdvanced'] === 'on',
    bonusRules: [],
  };
}

/* ---------- Equipos ---------- */

adminRoutes.get('/equipos', (c) => admin.teamsAdminPage(c.env.DB, c.req.query('msg'), c.req.query('err')).then((h) => c.html(h)));

adminRoutes.get('/equipos/nuevo', (c) => admin.teamFormPage(c.env.DB).then((h) => c.html(h)));

adminRoutes.post('/equipos', async (c) => {
  const f = await c.req.parseBody();
  // Fase 16: la validación vive en el servidor (antes solo el `required` del
  // HTML y un color sin validar que terminaba en un escudo roto).
  const v = validateTeam({
    name: String(f['name'] ?? ''),
    shortName: String(f['short_name'] ?? ''),
    color: String(f['color'] ?? ''),
    logoUrl: String(f['logo_url'] ?? ''),
  });
  if (!v.ok) return c.html(await admin.teamFormPage(c.env.DB, undefined, v.error), 400);
  let slug = slugify(v.value.name);
  const existing = await c.env.DB.prepare('SELECT id FROM teams WHERE slug = ?1').bind(slug).first();
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;
  await c.env.DB.prepare('INSERT INTO teams (name, slug, short_name, color, logo_url, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(v.value.name, slug, v.value.shortName, v.value.color, v.value.logoUrl, f['active'] ? 1 : 0)
    .run();
  return c.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo creado'));
});

adminRoutes.get('/equipos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  return c.html(await admin.teamFormPage(c.env.DB, id, undefined, new URL(c.req.url).origin));
});

/* ---------- Delegado por equipo ---------- */

/** Genera un código único (32^8 combinaciones) sin colisiones. */
async function uniqueDelegateCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const candidate = generateDelegateCode();
    const clash = await db.prepare('SELECT id FROM teams WHERE delegate_code = ?1').bind(candidate).first();
    if (!clash) return candidate;
  }
  return generateDelegateCode(12);
}

adminRoutes.post('/equipos/:id/delegado', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const name = String(form['delegate_name'] ?? '').trim().slice(0, 80);
  const enabled = form['delegate_enabled'] ? 1 : 0;
  const team = await getTeam(c.env.DB, id);
  if (!team) return c.redirect('/admin/equipos?err=' + encodeURIComponent('Equipo inexistente'));
  const code = enabled && !team.delegate_code ? await uniqueDelegateCode(c.env.DB) : team.delegate_code;
  await c.env.DB.prepare('UPDATE teams SET delegate_name = ?1, delegate_enabled = ?2, delegate_code = ?3 WHERE id = ?4')
    .bind(name, enabled, code, id)
    .run();
  return c.redirect(
    `/admin/equipos/${id}?msg=` + encodeURIComponent(enabled ? 'Delegado habilitado' : 'Delegado deshabilitado')
  );
});

adminRoutes.post('/equipos/:id/delegado/codigo', async (c) => {
  const id = Number(c.req.param('id'));
  const code = await uniqueDelegateCode(c.env.DB);
  await c.env.DB.prepare('UPDATE teams SET delegate_code = ?1, delegate_enabled = 1 WHERE id = ?2').bind(code, id).run();
  return c.redirect(`/admin/equipos/${id}?msg=` + encodeURIComponent(`Código del delegado: ${code}`));
});

adminRoutes.post('/equipos/:id/delegado/revocar', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('UPDATE teams SET delegate_code = NULL, delegate_enabled = 0 WHERE id = ?1').bind(id).run();
  return c.redirect(`/admin/equipos/${id}?msg=` + encodeURIComponent('Acceso del delegado revocado'));
});

/* ---------- Entregas de delegados ---------- */

adminRoutes.get('/entregas', async (c) => {
  return c.html(await admin.entregasAdminPage(c.env.DB, c.req.query('msg'), c.req.query('err')));
});

adminRoutes.post('/entregas/:id/aprobar', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const back = String(form['back'] ?? '');
  const dest = back.startsWith('/admin') ? back : '/admin/entregas';
  const applyScore = Boolean(form['apply_score']);
  const applyEvents = Boolean(form['apply_events']);

  const sub = await getSubmission(c.env.DB, id);
  if (!sub) return c.redirect(`${dest}?err=` + encodeURIComponent('Esa entrega no existe'));
  if (sub.review !== 'pending') {
    return c.redirect(`${dest}?err=` + encodeURIComponent('Esa entrega ya fue revisada'));
  }
  const match = await getMatch(c.env.DB, sub.match_id);
  if (!match) return c.redirect(`${dest}?err=` + encodeURIComponent('El partido ya no existe'));
  // Bitácora: la entrega es un cambio más, y dice de quién viene.
  const beforeEvents = await listEvents(c.env.DB, sub.match_id);

  const stmts: D1PreparedStatement[] = [];
  if (applyScore) {
    const notes = sub.notes ? (match.notes ? `${match.notes} | ${sub.notes}` : sub.notes) : match.notes;
    stmts.push(
      c.env.DB.prepare('UPDATE matches SET status = ?1, home_goals = ?2, away_goals = ?3, notes = ?4 WHERE id = ?5')
        .bind(sub.status, sub.home_goals, sub.away_goals, notes, sub.match_id)
    );
  }
  if (applyEvents) {
    // Reemplaza solo los eventos del equipo que entregó: si el rival también
    // entrega, sus eventos se combinan en vez de pisarse.
    stmts.push(c.env.DB.prepare('DELETE FROM events WHERE match_id = ?1 AND team_id = ?2').bind(sub.match_id, sub.team_id));
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO events (match_id, team_id, player_id, type, minute) SELECT ?1, se.team_id, se.player_id, se.type, se.minute FROM submission_events se WHERE se.submission_id = ?2'
      ).bind(sub.match_id, sub.id)
    );
  }
  stmts.push(
    c.env.DB.prepare("UPDATE submissions SET review = 'approved', reviewed_at = datetime('now') WHERE id = ?1").bind(id)
  );
  await c.env.DB.batch(stmts);
  // Si la entrega decide una llave (semifinal), el siguiente round se completa solo.
  await applyAdvancements(c.env.DB, match.tournament_id);
  // El cambio queda asentado como hecho por el equipo delegado, no por el
  // administrador que apretó "aprobar".
  const after = await getMatch(c.env.DB, sub.match_id);
  if (after) {
    const afterEvents = await listEvents(c.env.DB, sub.match_id);
    const ids = new Set<number>();
    for (const e of [...beforeEvents, ...afterEvents]) if (e.player_id != null) ids.add(e.player_id);
    const names = await playerNames(c.env.DB, ids);
    const changes = [
      ...diffMatch(match, after, { teamNames: {} }),
      ...diffEvents(beforeEvents, afterEvents, names, EVENT_TYPE_LABELS),
    ];
    await insertMatchChanges(c.env.DB, after, changes, delegateActor(sub.team_id));
  }

  return c.redirect(`${dest}?msg=` + encodeURIComponent('Entrega aprobada y publicada'));
});

adminRoutes.post('/entregas/:id/rechazar', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const back = String(form['back'] ?? '');
  const dest = back.startsWith('/admin') ? back : '/admin/entregas';
  const note = String(form['review_note'] ?? '').trim().slice(0, 300);
  const sub = await getSubmission(c.env.DB, id);
  if (!sub || sub.review !== 'pending') {
    return c.redirect(`${dest}?err=` + encodeURIComponent('Esa entrega ya fue revisada'));
  }
  await c.env.DB.prepare("UPDATE submissions SET review = 'rejected', reviewed_at = datetime('now'), review_note = ?1 WHERE id = ?2")
    .bind(note, id)
    .run();
  return c.redirect(`${dest}?msg=` + encodeURIComponent('Entrega rechazada'));
});

adminRoutes.post('/equipos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const team = await getTeam(c.env.DB, id);
  if (!team) return c.redirect('/admin/equipos?err=' + encodeURIComponent('Ese equipo no existe.'));
  const v = validateTeam({
    name: String(f['name'] ?? ''),
    shortName: String(f['short_name'] ?? ''),
    color: String(f['color'] ?? ''),
    logoUrl: String(f['logo_url'] ?? ''),
  });
  if (!v.ok) {
    return c.html(await admin.teamFormPage(c.env.DB, id, v.error, new URL(c.req.url).origin), 400);
  }
  await c.env.DB.prepare('UPDATE teams SET name = ?1, short_name = ?2, color = ?3, logo_url = ?4, active = ?5 WHERE id = ?6')
    .bind(v.value.name, v.value.shortName, v.value.color, v.value.logoUrl, f['active'] ? 1 : 0, id)
    .run();
  return c.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo actualizado'));
});

adminRoutes.post('/equipos/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  const team = await getTeam(c.env.DB, id);
  if (!team) return c.redirect('/admin/equipos?err=' + encodeURIComponent('Ese equipo no existe.'));
  // Fase 16: con partidos en el fixture NO se borra. La base los dejaría con
  // el equipo en null ("Por definir") y el torneo quedaría inconsistente. Si
  // dejó de competir, la salida es marcarlo inactivo.
  const usage = await teamUsage(c.env.DB, id);
  const plan = teamDeletionPlan(usage);
  if (!plan.allowed) return c.redirect('/admin/equipos?err=' + encodeURIComponent(plan.error));
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?1').bind(id).run();
  return c.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo eliminado'));
});

/* ---------- Jugadores ---------- */

adminRoutes.get('/jugadores', async (c) => {
  const teamParam = c.req.query('team');
  return c.html(await admin.playersAdminPage(c.env.DB, teamParam ? Number(teamParam) : undefined, c.req.query('msg'), c.req.query('err')));
});

/** Destino de los errores del alta/edición: la pantalla del equipo. */
function playersBack(teamId: number | null, msg?: string, err?: string): string {
  let dest = `/admin/jugadores${teamId != null ? `?team=${teamId}` : ''}`;
  if (msg) dest += (dest.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg);
  if (err) dest += (dest.includes('?') ? '&' : '?') + 'err=' + encodeURIComponent(err);
  return dest;
}

/** ¿Es un id de equipo que existe? (guarda contra claves foráneas rotas) */
async function teamExists(db: D1Database, teamId: number): Promise<boolean> {
  if (!Number.isInteger(teamId) || teamId <= 0) return false;
  return Boolean(await db.prepare('SELECT id FROM teams WHERE id = ?1').bind(teamId).first());
}

adminRoutes.post('/jugadores', async (c) => {
  const f = await c.req.parseBody();
  const teamId = Number(f['team_id']);
  if (!(await teamExists(c.env.DB, teamId))) {
    return c.redirect(playersBack(null, undefined, 'El equipo no existe: elegí uno de la lista.'));
  }
  // Fase 16: la validación vive en el servidor. Antes un dorsal fuera de
  // rango o una posición inválida llegaban a la base y devolvían un 500.
  const v = validatePlayer({
    name: String(f['name'] ?? ''),
    number: String(f['number'] ?? ''),
    position: String(f['position'] ?? ''),
  });
  if (!v.ok) return c.redirect(playersBack(teamId, undefined, v.error));

  const aviso = duplicateNumberMessage(await listPlayers(c.env.DB, teamId, true), v.value.number);
  await c.env.DB.prepare('INSERT INTO players (team_id, name, number, position, active) VALUES (?1, ?2, ?3, ?4, 1)')
    .bind(teamId, v.value.name, v.value.number, v.value.position)
    .run();
  return c.redirect(playersBack(teamId, aviso || 'Jugador agregado', aviso ? undefined : undefined));
});

/** Fase 16: edita nombre, dorsal y posición de un jugador. */
adminRoutes.post('/jugadores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const row = await getPlayer(c.env.DB, id);
  if (!row) return c.redirect(playersBack(null, undefined, 'Ese jugador no existe.'));
  const v = validatePlayer({
    name: String(f['name'] ?? ''),
    number: String(f['number'] ?? ''),
    position: String(f['position'] ?? ''),
  });
  if (!v.ok) return c.redirect(playersBack(row.team_id, undefined, v.error));
  const aviso = duplicateNumberMessage(await listPlayers(c.env.DB, row.team_id, true), v.value.number, id);
  await c.env.DB.prepare('UPDATE players SET name = ?1, number = ?2, position = ?3 WHERE id = ?4')
    .bind(v.value.name, v.value.number, v.value.position, id)
    .run();
  return c.redirect(playersBack(row.team_id, aviso || 'Jugador actualizado', undefined));
});

/**
 * Fase 16: saca un jugador. Con historial (goles, tarjetas o entregas de
 * delegado) se da de BAJA LÓGICA, para que las estadísticas y la planilla no
 * pierdan al autor; sin historial, se elimina de verdad.
 */
adminRoutes.post('/jugadores/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await getPlayer(c.env.DB, id);
  if (!row) return c.redirect(playersBack(null, undefined, 'Ese jugador no existe.'));
  const plan = playerRemovalPlan(row, await playerUsage(c.env.DB, id));
  if (plan.kind === 'disable') {
    await c.env.DB.prepare('UPDATE players SET active = 0 WHERE id = ?1').bind(id).run();
    return c.redirect(playersBack(row.team_id, `${row.name}: dado de baja. ${plan.message}`));
  }
  await c.env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(id).run();
  return c.redirect(playersBack(row.team_id, `${row.name} eliminado de la plantilla.`));
});

/** Fase 16: reactiva un jugador dado de baja. */
adminRoutes.post('/jugadores/:id/reactivar', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await getPlayer(c.env.DB, id);
  if (!row) return c.redirect(playersBack(null, undefined, 'Ese jugador no existe.'));
  if (row.active) return c.redirect(playersBack(row.team_id, `${row.name} ya estaba activo.`));
  await c.env.DB.prepare('UPDATE players SET active = 1 WHERE id = ?1').bind(id).run();
  return c.redirect(playersBack(row.team_id, `${row.name}: de nuevo en la plantilla.`));
});

/* ---------- Fixture ---------- */

adminRoutes.get('/fixture', async (c) => {
  return c.html(await admin.fixtureAdminPage(c.env.DB, c.req.query('t'), c.req.query('msg'), c.req.query('err')));
});

/**
 * Fase 15: calendario operativo. Solo lectura: lista el fixture por jornada
 * con el estado real de cada partido (jugado, pendiente, reprogramado…) y los
 * filtros por torneo, zona/grupo, jornada y estado.
 */
adminRoutes.get('/calendario', async (c) => {
  return c.html(
    await calendarioAdminPage(
      c.env.DB,
      c.req.query('t'),
      { zona: c.req.query('zona'), jornada: c.req.query('jornada'), estado: c.req.query('estado') },
      c.req.query('msg'),
      c.req.query('err')
    )
  );
});

/**
 * Paso 1 del nuevo Generar: arma el plan completo (zona + cruces en la misma
 * bolsa, días únicos, un partido por equipo por día) y lo guarda como
 * borrador. NO toca el fixture: solo redirige a la vista previa.
 */
adminRoutes.post('/fixture/previsualizar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const mode = String(f['mode'] ?? 'single') === 'double' ? 'double' : 'single';
  const rule = parseCrossoverRule(f['crossover_rule']);
  const crossoverCounts = f['crossover_counts'] === 'on' || f['crossover_counts'] === '1';
  // El select de cruces: 'con' (default) incluye la bolsa de cruces; 'sin'
  // arma el fixture solo con los partidos de zona.
  const includeCrossovers = String(f['crossover_include'] ?? 'con') !== 'sin';
  // Fecha del cruce: vacío = automática (la primera libre tras las de zona).
  const crossoverRoundRaw = String(f['crossover_round'] ?? '').trim();
  const crossoverRound = crossoverRoundRaw ? Number(crossoverRoundRaw) : undefined;
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const tRow = await c.env.DB
    .prepare('SELECT slug, config, status, format FROM tournaments WHERE id = ?1')
    .bind(tournamentId)
    .first<{ slug: string; config: string; status: string; format: string }>();
  if (!tRow) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(tRow.slug)}`;
  if (tRow.status === 'finished' || tRow.status === 'archived') {
    return c.redirect(dest + '&err=' + encodeURIComponent(fixtureBlockedReason(tRow.status)));
  }

  // Pool del torneo: SOLO sus equipos participantes (tabla tournament_teams).
  // Torneos viejos sin filas de participación siguen con el pool histórico
  // (todos los activos globales) para no cambiar el comportamiento existente.
  const pool = await fixturePoolOfTournament(c.env.DB, tournamentId);
  const ids = pool ? pool.ids : [];
  if (ids.length < 2) {
    return c.redirect(dest + '&err=' + encodeURIComponent('Necesitás al menos 2 equipos activos'));
  }
  const configJson = tRow.config ?? '{}';
  const schedule = scheduleOf(configJson);

  // Con zonas activas, un participante sin zona no genera partidos de zona
  // (el planificador arma el círculo por zona): se avisa en vez de dejarlo
  // fuera silenciosamente. No inventa zona ni quita la participación.
  const zc = zonesOf(configJson);
  if (zc.enabled) {
    const sinZona = participantsWithoutZone(ids, zc);
    if (sinZona.length > 0) {
      return c.redirect(
        dest +
          '&err=' +
          encodeURIComponent(
            `Participan sin zona: ${sinZona.length} equipo(s). Asignales zona en la edición del torneo o apagá las zonas.`
          )
      );
    }
  }

  let plan;
  try {
    // Fase 11A: el formato de competencia (Fase 10) define las ruedas; el
    // mode del formulario queda solo como fallback para torneos legados.
    const comp = parseCompetitionConfig(configJson, tRow.format);
    const competitionFormat = comp.format;
    // Fase 11B: en formatos por grupos, los participantes se reparten en
    // grupos (serpentina alfabética) y cada grupo juega su round-robin. La
    // 1 rueda es por defecto; 2 con el checkbox "ida y vuelta" del form.
    // Los grupos quedan guardados en la config de zonas del torneo para que
    // posiciones y estadísticas agrupen igual.
    const withGroups = competitionFormat === 'FASE_DE_GRUPOS' || competitionFormat === 'GRUPOS_PLAYOFFS';
    let groups: { name: string; teamIds: number[] }[] | undefined;
    if (withGroups) {
      const count = comp.groupStage.count;
      if (count < 2) {
        return c.redirect(dest + '&err=' + encodeURIComponent('El formato tiene grupos: configurá al menos 2 en el torneo.'));
      }
      groups = distributeGroups(ids, count);
      console.log('E2EDEBUG grupos:', JSON.stringify({ count, idsLen: ids.length, groups: groups.map((g) => ({ n: g.name, len: g.teamIds.length })) }));
      // Los grupos van a la config de zonas del torneo: misma estructura de
      // siempre (posiciones agrupadas, aviso de zonas, etc.).
      const cfg = JSON.parse(configJson || '{}') as Record<string, unknown>;
      cfg['zones'] = { enabled: true, zones: groups };
      await c.env.DB.prepare('UPDATE tournaments SET config = ?1 WHERE id = ?2').bind(JSON.stringify(cfg), tournamentId).run();
    }
    plan = planFixture({
      teamIds: ids,
      configJson,
      mode,
      competitionFormat,
      groups,
      groupStageWheels: withGroups && mode === 'double' ? 2 : 1,
      schedule,
      crossoverRule: rule,
      crossoverCounts,
      includeCrossovers,
      crossoverRound,
    });
  } catch (e) {
    const text = e instanceof Error ? e.message : 'error desconocido';
    return c.redirect(dest + '&err=' + encodeURIComponent(`No se pudo armar el plan: ${text}`));
  }
  const resumen = planSummary(plan, ids);
  const crossoverCount = resumen.cruces;
  const capacity = scheduleCapacity(schedule);
  const summaryText =
    `${resumen.total} partido(s) → ${resumen.rounds} fecha(s) · máx ${resumen.maxPerDay}/día (capacidad ${capacity}) · ` +
    `0 postergados · fechas libres entre ${resumen.libresMin} y ${resumen.libresMax} por equipo` +
    (crossoverCount > 0 ? ` · ${crossoverCount} de cruce incluidos en la bolsa` : '');

  // Borrador: uno por torneo (reemplaza al anterior).
  await c.env.DB
    .prepare(
      "INSERT INTO fixture_drafts (tournament_id, summary, payload, created_at) VALUES (?1, ?2, ?3, datetime('now')) " +
        'ON CONFLICT (tournament_id) DO UPDATE SET summary = ?2, payload = ?3, created_at = datetime(\'now\')'
    )
    // El borrador guarda el plan completo: partidos + la declaración de
    // cruce resuelta (fecha automática incluida) + las fechas de desborde,
    // para que el confirmar aplique exactamente lo que se vio en la vista
    // previa y la página pueda avisar del desborde.
    .bind(
      tournamentId,
      summaryText,
      JSON.stringify({ matches: plan.matches, crossover: plan.crossover, crossoverOverflow: plan.crossoverOverflow })
    )
    .run();

  return c.redirect(`/admin/fixture/vista-previa?t=${encodeURIComponent(tRow.slug)}`);
});

/** Muestra el borrador guardado. */
adminRoutes.get('/fixture/vista-previa', async (c) => {
  const slug = c.req.query('t');
  const t = await resolveTournament(c.env.DB, slug || undefined);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const draft = await c.env.DB
    .prepare('SELECT summary, payload, created_at FROM fixture_drafts WHERE tournament_id = ?1')
    .bind(t.id)
    .first<{ summary: string; payload: string; created_at: string }>();
  if (!draft) return c.redirect(`/admin/fixture?t=${encodeURIComponent(t.slug)}&err=` + encodeURIComponent('No hay vista previa: prepará una primero'));
  // Nombres de equipos para mostrar el plan legible (el payload trae ids).
  const teamRows = await c.env.DB.prepare('SELECT id, name FROM teams').all<{ id: number; name: string }>();
  const teamNames = new Map((teamRows.results ?? []).map((r) => [r.id, r.name]));
  // Fase 11B: con GRUPOS_PLAYOFFS, los clasificados quedan preparados pero
  // las llaves se generan en otra fase.
  const comp = parseCompetitionConfig(t.config, t.format);
  const pendingPlayoffsNote =
    comp.format === 'GRUPOS_PLAYOFFS'
      ? `<div class="warning-box">📌 Formato Grupos + Playoffs: al terminar la fase de grupos clasifican los primeros ${comp.groupStage.qualifiersPerGroup} de cada grupo (${comp.groupStage.count * comp.groupStage.qualifiersPerGroup} equipos). Las llaves de playoffs se generan en su momento — todavía no están implementadas en esta fase.</div>`
      : '';
  return c.html(
    await admin.fixturePreviewPage({
      tournamentId: t.id,
      tournamentSlug: t.slug,
      tournamentName: t.name,
      summary: draft.summary,
      payload: draft.payload,
      createdAt: draft.created_at,
      teamNames,
      pendingPlayoffsNote,
    })
  );
});

/**
 * Paso 2: aplica el borrador EXACTAMENTE como se vio. Mismas guardias que el
 * Generar viejo (sin jugados, torneo activo). Borrar el fixture borra sus
 * events/submissions por cascada; los partidos de cruce viejos también
 * desaparecen (los cruces nuevos ya vienen en el plan).
 */
adminRoutes.post('/fixture/confirmar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const slug = typeof f['t'] === 'string' ? f['t'] : '';
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const tRow = await c.env.DB
    .prepare('SELECT slug, status, config FROM tournaments WHERE id = ?1')
    .bind(tournamentId)
    .first<{ slug: string; status: string; config: string }>();
  if (!tRow) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(tRow.slug)}`;
  if (tRow.status === 'finished' || tRow.status === 'archived') {
    return c.redirect(dest + '&err=' + encodeURIComponent('El torneo está finalizado o archivado: no se puede regenerar el fixture.'));
  }

  // Guardia crítica primero: con partidos jugados no se confirma nada, haya
  // borrador o no (es la protección contra pisar resultados).
  const rows = await c.env.DB.prepare('SELECT status FROM matches WHERE tournament_id = ?1').bind(tournamentId).all<{ status: string }>();
  const jugados = playedCount(rows.results ?? []);
  if (jugados > 0) {
    return c.redirect(
      dest +
        '&err=' +
        encodeURIComponent(
          `El torneo ya tiene ${jugados} partido(s) jugado(s): confirmar los borraría. Usá “Regenerar cruce” para rearmar solo los pendientes.`
        )
    );
  }

  const draft = await c.env.DB
    .prepare('SELECT payload FROM fixture_drafts WHERE tournament_id = ?1')
    .bind(tournamentId)
    .first<{ payload: string }>();
  if (!draft) {
    return c.redirect(dest + '&err=' + encodeURIComponent('No hay vista previa para confirmar: prepará una primero'));
  }
  let plan: { home: number; away: number; zone: string; kind: string; counts?: boolean; day: string; venue: string; kickoff: string; fixtureRound: number }[] = [];
  let planCrossover: CrossoverDate | null = null;
  try {
    const parsed: unknown = JSON.parse(draft.payload);
    // Payload nuevo: { matches, crossover }. Payload viejo: array plano
    // (borradores previos a la unificación; sin declaración de cruce).
    if (Array.isArray(parsed)) {
      plan = parsed as typeof plan;
    } else if (parsed && typeof parsed === 'object') {
      const o = parsed as { matches?: typeof plan; crossover?: CrossoverDate | null };
      if (Array.isArray(o.matches)) plan = o.matches;
      if (o.crossover && typeof o.crossover.round === 'number') {
        planCrossover = { round: o.crossover.round, rule: parseCrossoverRule(o.crossover.rule), counts: o.crossover.counts === true };
      }
    }
  } catch {
    plan = [];
  }
  if (plan.length === 0) {
    return c.redirect(dest + '&err=' + encodeURIComponent('El borrador está vacío: prepará la vista previa de nuevo'));
  }

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare('DELETE FROM events WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?1)').bind(tournamentId)
  );
  stmts.push(c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ?1').bind(tournamentId));
  for (const m of plan) {
    // La marca de cruce viaja en la nota del partido: es lo que usa la tabla,
    // el playoff y la regeneración para tratarlo como cruce (las fechas de
    // la bolsa mezclada ya no bastan para distinguirlos).
    const notes =
      m.kind === 'cruce'
        ? m.counts
          ? CROSSOVER_NOTE_COUNTS
          : CROSSOVER_NOTE
        : '';
    stmts.push(
      c.env.DB
        .prepare(
          'INSERT INTO matches (tournament_id, round, zone, home_team_id, away_team_id, status, played_on, kickoff_time, venue, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
        )
        .bind(
          tournamentId,
          m.fixtureRound,
          m.zone,
          m.home,
          m.away,
          'scheduled',
          m.day,
          m.kickoff,
          m.venue,
          notes
        )
    );
  }
  // La config de cruces se reescribe desde el plan: una fecha = un cruce,
  // declarado por el formulario de generar. Si el plan salió sin cruces
  // (opción "sin cruces"), la declaración se saca: quedarse con ella volvería
  // a meter cruces en la próxima generación sin partidos que la respalden.
  {
    const cfg = JSON.parse(tRow.config ?? '{}') as Record<string, unknown>;
    if (planCrossover) {
      cfg['crossover'] = crossoverConfigJson([planCrossover]).crossover;
    } else {
      delete cfg['crossover'];
    }
    stmts.push(
      c.env.DB.prepare('UPDATE tournaments SET config = ?1 WHERE id = ?2').bind(JSON.stringify(cfg), tournamentId)
    );
  }
  await c.env.DB.batch(stmts);
  await c.env.DB.prepare('DELETE FROM fixture_drafts WHERE tournament_id = ?1').bind(tournamentId).run();
  return c.redirect(dest + '&msg=' + encodeURIComponent(`Fixture guardado: ${plan.length} partido(s) según la vista previa`));
});

/** Tira el borrador sin tocar nada. */
adminRoutes.post('/fixture/descartar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  if (Number.isFinite(tournamentId)) {
    await c.env.DB.prepare('DELETE FROM fixture_drafts WHERE tournament_id = ?1').bind(tournamentId).run();
  }
  const slug = typeof f['t'] === 'string' ? f['t'] : '';
  return c.redirect(`/admin/fixture${slug ? `?t=${encodeURIComponent(slug)}` : ''}&msg=` + encodeURIComponent('Vista previa descartada: el fixture no cambió'));
});

adminRoutes.get('/fixture/nuevo', async (c) => {
  return c.html(await admin.matchFormPage(c.env.DB, c.req.query('t')));
});

adminRoutes.post('/fixture/nuevo', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const home = f['home_team_id'] ? Number(f['home_team_id']) : null;
  const away = f['away_team_id'] ? Number(f['away_team_id']) : null;
  if (!Number.isFinite(tournamentId) || home == null || away == null) {
    return c.html(await admin.matchFormPage(c.env.DB, undefined, undefined, 'Elegí local y visitante'), 400);
  }
  // Fase 12C: en finalizado/archivado no se agregan partidos (solo lectura).
  const statusRow = await c.env.DB
    .prepare('SELECT status FROM tournaments WHERE id = ?1')
    .bind(tournamentId)
    .first<{ status: string }>();
  if (statusRow && statusBlocksMatchEdits(statusRow.status)) {
    return c.html(
      await admin.matchFormPage(c.env.DB, undefined, undefined, matchEditsBlockedReason(statusRow.status)),
      400
    );
  }
  const roundRaw = String(f['round'] ?? '').trim();
  const round = roundRaw ? Number(roundRaw) : null;
  const statusRaw = String(f['status'] ?? 'scheduled').trim();
  if (!isMatchStatus(statusRaw)) {
    return c.html(
      await admin.matchFormPage(c.env.DB, undefined, undefined, invalidStatusMessage(statusRaw)),
      400
    );
  }
  await c.env.DB.prepare(
    'INSERT INTO matches (tournament_id, round, zone, home_team_id, away_team_id, played_on, kickoff_time, venue, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
  )
    .bind(
      tournamentId,
      round,
      String(f['zone'] ?? ''),
      home,
      away,
      String(f['played_on'] ?? ''),
      String(f['kickoff_time'] ?? ''),
      String(f['venue'] ?? ''),
      statusRaw
    )
    .run();
  return c.redirect('/admin/fixture?msg=' + encodeURIComponent('Partido creado'));
});


/**
 * Regenera los cruces a mitad de torneo (equipo nuevo o participante que
 * cambió) SIN tocar lo jugado. Al terminar verifica sobre la base que los
 * partidos nuevos no pisen los ya jugados (cruces, jornadas ni canchas).
 */
adminRoutes.post('/fixture/regenerar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const mode = String(f['mode'] ?? 'single') === 'double' ? 'double' : 'single';
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const t = await resolveTournament(c.env.DB, undefined, tournamentId);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(t.slug)}`;

  const teamRows = await c.env.DB.prepare('SELECT id, name, active FROM teams ORDER BY id').all<{
    id: number;
    name: string;
    active: number;
  }>();
  const names = new Map((teamRows.results ?? []).map((r) => [r.id, r.name]));
  // Solo participantes del torneo (fixturePoolOfTournament: con retrocompatibilidad
  // histórica si el torneo no tiene filas de participación).
  const pool = await fixturePoolOfTournament(c.env.DB, tournamentId);
  const activeTeamIds = pool ? pool.ids : [];
  if (activeTeamIds.length < 2) {
    return c.redirect(`${dest}&err=` + encodeURIComponent('Necesitás al menos 2 equipos activos'));
  }

  const before = await c.env.DB.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id')
    .bind(tournamentId)
    .all<Match>();
  const plan = regeneratePairings({
    existing: before.results ?? [],
    activeTeamIds,
    mode,
    schedule: scheduleOf(t.config),
    zones: zonesOf(t.config),
    crossovers: parseCrossoverConfig(t.config),
  });

  const stmts: D1PreparedStatement[] = [];
  for (const id of plan.removeMatchIds) {
    stmts.push(
      c.env.DB.prepare(
        'DELETE FROM submission_events WHERE submission_id IN (SELECT id FROM submissions WHERE match_id = ?1)'
      ).bind(id)
    );
    stmts.push(c.env.DB.prepare('DELETE FROM submissions WHERE match_id = ?1').bind(id));
    stmts.push(c.env.DB.prepare('DELETE FROM events WHERE match_id = ?1').bind(id));
    // Guarda extra: jamás borrar un partido con resultado.
    stmts.push(
      c.env.DB.prepare("DELETE FROM matches WHERE id = ?1 AND status NOT IN ('played', 'walkover')").bind(id)
    );
  }
  for (const m of plan.create) {
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO matches (tournament_id, round, home_team_id, away_team_id, status, played_on, kickoff_time, venue) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
      ).bind(tournamentId, m.round, m.home, m.away, 'scheduled', m.played_on, m.kickoff_time, m.venue)
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);

  // Verificación real: se relee la base y se chequean los choques.
  const after = await c.env.DB.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id')
    .bind(tournamentId)
    .all<Match>();
  const issues = verifyPairings(
    after.results ?? [],
    mode,
    (id) => names.get(id) ?? `equipo ${id}`,
    crossoverRoundsOf(t.config)
  );
  const resumen = `Cruce regenerado: ${plan.keptMatchIds.length} jugado(s) conservado(s), ${plan.create.length} nuevo(s), ${plan.removeMatchIds.length} pendiente(s) reemplazado(s)`;
  if (issues.length) {
    const detail = issues.slice(0, 6).join(' · ') + (issues.length > 6 ? ' …' : '');
    return c.redirect(`${dest}&err=` + encodeURIComponent(`⚠ ${resumen}. Choques: ${detail}`));
  }
  return c.redirect(
    `${dest}&msg=` + encodeURIComponent(`${resumen}. ✓ Verificado: los nuevos no pisan los jugados`)
  );
});

/**
 * Genera el playoff entre zonas (llave opcional): se habilita cuando todas
 * las fechas de zona están jugadas. Tres formatos (final, semis + final,
 * semis + final + 3er puesto) y queda registrado en la config del torneo.
 */
adminRoutes.post('/fixture/playoff', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const format = parsePlayoffFormat(f['format']);
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const t = await resolveTournament(c.env.DB, undefined, tournamentId);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(t.slug)}`;
  const fail = (msg: string) => c.redirect(`${dest}&err=` + encodeURIComponent(msg));

  // Solo con exactamente 2 zonas configuradas.
  const zones = zonesOf(t.config);
  if (!zones.enabled || zones.zones.length !== 2) {
    return fail('El playoff necesita exactamente 2 zonas configuradas');
  }
  // Una sola llave por torneo.
  if (parsePlayoffConfig(t.config)) {
    return fail('El playoff ya fue generado: está en la sección Llaves / Playoffs del fixture');
  }

  const [teamRows, matchRows] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, active FROM teams ORDER BY id').all<{ id: number; name: string; active: number }>(),
    c.env.DB.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id').bind(tournamentId).all<Match>(),
  ]);
  const matches = matchRows.results ?? [];

  // Guardia: recién cuando todo lo de la fase regular está jugado.
  const pending = pendingLeagueCount(matches);
  if (matches.length === 0) return fail('Primero generá el fixture');
  if (pending > 0) return fail(`Faltan ${pending} partido(s) por jugar para habilitar el playoff`);

  // Tablas por zona (los cruces que no cuentan no ensucian el orden).
  // Solo participantes del torneo (mismo criterio del generador y la regeneración).
  const pool = await fixturePoolOfTournament(c.env.DB, tournamentId);
  const activeIds = new Set(pool ? pool.ids : []);
  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    (teamRows.results ?? []).filter((r) => activeIds.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
    rulesOf(t)
  );
  const tableA = standings.filter((r) => zones.zones[0]!.teamIds.includes(r.teamId) && activeIds.has(r.teamId));
  const tableB = standings.filter((r) => zones.zones[1]!.teamIds.includes(r.teamId) && activeIds.has(r.teamId));

  // La llave va en la fecha siguiente a la última, con los slots del torneo.
  const maxRound = matches.reduce((mx, m) => Math.max(mx, m.round ?? 0), 0);
  const round = maxRound + 1;
  const schedule = scheduleOf(t.config);
  const day = plannedRoundDate(schedule, round);

  let slots;
  try {
    slots = buildPlayoffPlan(tableA, tableB, format, round);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'No se pudo armar el playoff');
  }
  const roundSlotsList = roundSlots(slots.length, schedule);
  const stmts: D1PreparedStatement[] = [];
  for (const [i, s] of slots.entries()) {
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO matches (tournament_id, round, bracket_round, home_team_id, away_team_id, home_source, away_source, status, played_on, kickoff_time, venue) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
      ).bind(
        tournamentId,
        s.round,
        s.bracket_round,
        s.home,
        s.away,
        s.home_source,
        s.away_source,
        'scheduled',
        day,
        roundSlotsList[i]?.kickoff ?? '',
        roundSlotsList[i]?.venue ?? ''
      )
    );
  }
  await c.env.DB.batch(stmts);

  // Registrar en la config del torneo (así "Regenerar" no lo toca y no se
  // puede generar dos veces).
  await c.env.DB
    .prepare('UPDATE tournaments SET config = ?1 WHERE id = ?2')
    .bind(JSON.stringify({ ...JSON.parse(t.config || '{}'), ...playoffConfigJson({ format, round }) }), tournamentId)
    .run();

  return c.redirect(
    `${dest}&msg=` +
      encodeURIComponent(
        `Playoff generado en la fecha ${round} (${playoffFormatLabel(format)}). Se ve en Llaves / Playoffs del fixture.`
      )
  );
});

/**
 * Fase 11C: genera las llaves de playoffs para los formatos de la Fase 10
 * (ELIMINACION_DIRECTA, GRUPOS_PLAYOFFS, LIGA_FASE_FINAL y
 * FASE_REGULAR_PLAYOFFS). Valida la instancia inicial contra los clasificados
 * disponibles y registra la llave en la config del torneo.
 */
adminRoutes.post('/fixture/llaves', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const t = await resolveTournament(c.env.DB, undefined, tournamentId);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(t.slug)}`;
  const fail = (msg: string) => c.redirect(`${dest}&err=` + encodeURIComponent(msg));

  // Estados finales: solo lectura.
  if (t.status === 'finished' || t.status === 'archived') {
    return fail('El torneo está finalizado o archivado: no se pueden generar llaves');
  }
  const comp = parseCompetitionConfig(t.config, t.format);
  if (!formatHasPlayoffs(comp.format)) {
    return fail('El formato del torneo no tiene playoffs');
  }
  // Una sola llave por torneo: no se pisa silenciosamente. La regeneración
  // es una acción explícita (checkbox del form) y solo si no hay resultados.
  const prevBracket = parseBracketConfig(t.config);

  const [teamRows, matchRows] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, active FROM teams ORDER BY id').all<{ id: number; name: string; active: number }>(),
    c.env.DB.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id').bind(tournamentId).all<Match>(),
  ]);
  const matches = matchRows.results ?? [];

  // Regeneración con resultados: prohibida SIEMPRE, incluso con la acción
  // explícita de regeneración (no se borran datos históricos jamás).
  if (bracketHasPlayed(matches)) {
    return fail('La llave ya tiene partidos con resultado: no se puede regenerar sin borrar datos históricos');
  }
  if (prevBracket) {
    if (f['regenerar'] !== '1') {
      return fail('Las llaves ya fueron generadas. Para reemplazarlas, marcá “Regenerar llaves” y confirmá.');
    }
    // Regeneración explícita (solo llaves sin resultado: la guardia de arriba
    // lo garantiza): borra SOLO los partidos de llave pendientes (su events
    // y entregas cascan por cascade) y rearma desde cero.
    const bracketIds = matches.filter((m) => m.bracket_round !== '').map((m) => m.id);
    if (bracketIds.length > 0) {
      await c.env.DB.prepare(`DELETE FROM matches WHERE id IN (${bracketIds.map((_, i) => `?${i + 1}`).join(',')})`)
        .bind(...bracketIds)
        .run();
    }
  }

  const pool = await fixturePoolOfTournament(c.env.DB, tournamentId);
  const activeIds = new Set(pool ? pool.ids : []);
  if (matches.length === 0 && comp.format !== 'ELIMINACION_DIRECTA') {
    return fail('Primero generá el fixture');
  }

  // Fase previa completa: la llave necesita saber quiénes clasifican.
  const pending = pendingLeagueCount(matches);
  if (matches.length > 0 && pending > 0) {
    return fail(`Faltan ${pending} partido(s) por jugar para armar las llaves`);
  }

  const teamNamesRows = (teamRows.results ?? []).filter((r) => activeIds.has(r.id));
  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    teamNamesRows.map((r) => ({ id: r.id, name: r.name })),
    rulesOf(t)
  );

  // Entrantes según el formato:
  // - GRUPOS_PLAYOFFS: los primeros N de cada grupo con cruce cruzado
  //   (1.ºA vs 2.ºB, 1.ºB vs 2.ºA).
  // - LIGA_FASE_FINAL / FASE_REGULAR_PLAYOFFS: los primeros de la tabla.
  // - ELIMINACION_DIRECTA: todos los participantes, ordenados por nombre
  //   (el emparejamiento espejo queda determinista; sin tabla previa es la
  //   convención más clara).
  const need = PLAYOFF_START_SIZE[comp.playoffs.start];
  let entrants: number[];
  if (comp.format === 'GRUPOS_PLAYOFFS') {
    const zonesCfg = zonesOf(t.config);
    if (!zonesCfg.enabled || zonesCfg.zones.length < 2) {
      return fail('Este torneo no tiene grupos: generá primero el fixture de grupos');
    }
    const tables: GroupTable[] = zonesCfg.zones.map((z) => ({
      name: z.name,
      rows: standings.filter((r) => z.teamIds.includes(r.teamId) && activeIds.has(r.teamId)),
    }));
    try {
      entrants = entrantsFromGroupTables(tables, comp.groupStage.qualifiersPerGroup);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'No se pudieron determinar los clasificados');
    }
  } else if (comp.format === 'ELIMINACION_DIRECTA') {
    entrants = teamNamesRows.map((r) => r.id).sort((a, b) => a - b);
  } else {
    entrants = entrantsFromTable(standings, need);
  }

  if (entrants.length < need) {
    return fail(`La instancia inicial (${PLAYOFF_START_LABELS[comp.playoffs.start]}) necesita ${need} equipo(s) y hay ${entrants.length}`);
  }
  entrants = entrants.slice(0, need);

  // La llave empieza en la fecha siguiente a la última del fixture.
  const maxRound = matches.reduce((mx, m) => Math.max(mx, m.round ?? 0), 0);
  const startRound = maxRound + 1;
  const schedule = scheduleOf(t.config);

  let slots;
  try {
    slots = buildBracketPlan({
      start: comp.playoffs.start,
      entrants,
      startRound,
      singleMatch: comp.playoffs.singleMatch,
      thirdPlace: comp.playoffs.thirdPlace,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'No se pudo armar la llave');
  }

  // Slots (cancha × hora) del torneo, por fecha de la llave.
  const roundsOfLlave = [...new Set(slots.map((s) => s.round))].sort((a, b) => a - b);
  const stmts: D1PreparedStatement[] = [];
  for (const r of roundsOfLlave) {
    const day = plannedRoundDate(schedule, r);
    const rs = roundSlots(slots.filter((s) => s.round === r).length, schedule);
    const ofRound = slots.filter((s) => s.round === r);
    for (const [i, s] of ofRound.entries()) {
      stmts.push(
        c.env.DB.prepare(
          'INSERT INTO matches (tournament_id, round, bracket_round, home_team_id, away_team_id, home_source, away_source, status, played_on, kickoff_time, venue) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
        ).bind(
          tournamentId,
          s.round,
          s.bracket_round,
          s.home,
          s.away,
          s.home_source,
          s.away_source,
          'scheduled',
          day,
          rs[i]?.kickoff ?? '',
          rs[i]?.venue ?? ''
        )
      );
    }
  }
  await c.env.DB.batch(stmts);

  // Registrar la llave en la config: así no se puede generar dos veces y
  // "Regenerar cruce" no la toca.
  await c.env.DB
    .prepare('UPDATE tournaments SET config = ?1 WHERE id = ?2')
    .bind(
      JSON.stringify({
        ...JSON.parse(t.config || '{}'),
        ...bracketConfigJson({ format: comp.format, startRound, singleMatch: comp.playoffs.singleMatch, thirdPlace: comp.playoffs.thirdPlace }),
      }),
      tournamentId
    )
    .run();

  const total = slots.length;
  return c.redirect(
    `${dest}&msg=` +
      encodeURIComponent(
        `Llaves generadas: ${total} partido(s) desde la fecha ${startRound} (${PLAYOFF_START_LABELS[comp.playoffs.start]}). Se ven en Llaves / Playoffs del fixture.`
      )
  );
});

/**
 * Fecha de reposición: agenda TODOS los partidos postergados del torneo en
 * fecha(s) nuevas al final del fixture. Reparte los slots disponibles y deja
 * el resto con día "a definir" si no alcanzan.
 */
adminRoutes.post('/fixture/reposicion', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  if (!Number.isFinite(tournamentId)) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  }
  const t = await resolveTournament(c.env.DB, undefined, tournamentId);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(t.slug)}`;
  const fail = (msg: string) => c.redirect(`${dest}&err=` + encodeURIComponent(msg));

  const matchRows = await c.env.DB.prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY id')
    .bind(tournamentId)
    .all<Match>();
  const all = matchRows.results ?? [];
  const postponed = postponedMatches(all);
  if (postponed.length === 0) {
    return fail('No hay partidos postergados para reponer');
  }

  const schedule = scheduleOf(t.config);
  if (scheduleCapacity(schedule) === 0) {
    return fail('Primero cargá canchas y horarios del torneo: sin slots no se puede agendar la reposición');
  }

  // Destino elegido en el formulario: una fecha existente (reciclar) o una
  // fecha nueva al final (comportamiento de siempre).
  const destinoRaw = String(f['destino'] ?? 'nueva').trim();
  const targetRound = destinoRaw !== '' && destinoRaw !== 'nueva' ? Number(destinoRaw) : null;

  if (targetRound != null && Number.isFinite(targetRound)) {
    if (!all.some((m) => m.round === targetRound)) {
      return fail(`La fecha ${targetRound} no existe en el fixture`);
    }
    // Guardia: en la fecha destino no puede jugar un equipo que ya tiene
    // partido agendado ahí (los postergados de esa fecha se reubican solos).
    const agendados = all.filter((m) => m.round === targetRound && m.status === 'scheduled');
    const ocupados = new Set<number>();
    for (const m of agendados) {
      if (m.home_team_id != null) ocupados.add(m.home_team_id);
      if (m.away_team_id != null) ocupados.add(m.away_team_id);
    }
    const chocan = postponed.filter(
      (m) =>
        (m.home_team_id != null && ocupados.has(m.home_team_id)) ||
        (m.away_team_id != null && ocupados.has(m.away_team_id))
    );
    if (chocan.length > 0) {
      return fail(
        `La fecha ${targetRound} ya tiene partidos de ${chocan.length} equipo(s) postergado(s): elegí otra fecha o “Fecha nueva al final”.`
      );
    }
    // Slots libres de la fecha: la grilla canchas×horarios menos la que ya
    // usan los agendados. Si no alcanzan, los últimos quedan con día pero sin
    // cancha/hora (los asigna el admin desde Días, horas y canchas).
    const usados = new Set(agendados.map((m) => `${m.venue}|${m.kickoff_time}`));
    const libres = roundSlots(scheduleCapacity(schedule), schedule).filter(
      (s) => !usados.has(`${s.venue}|${s.kickoff}`)
    );
    const dia = plannedRoundDate(schedule, targetRound);
    const stmts: D1PreparedStatement[] = postponed.map((m, i) => {
      const slot = libres[i];
      return c.env.DB
        .prepare(
          'UPDATE matches SET round = ?1, status = ?2, played_on = ?3, kickoff_time = ?4, venue = ?5 WHERE id = ?6 AND status = ?7'
        )
        .bind(targetRound, 'scheduled', dia, slot?.kickoff ?? '', slot?.venue ?? '', m.id, 'postponed');
    });
    await c.env.DB.batch(stmts);
    const conCancha = Math.min(postponed.length, libres.length);
    const suffix =
      conCancha < postponed.length
        ? ` (${conCancha} con cancha y hora, ${postponed.length - conCancha} sin asignar)`
        : '';
    return c.redirect(
      `${dest}&msg=` +
        encodeURIComponent(`Reposición agendada: ${postponed.length} partido(s) en la fecha ${targetRound}${suffix}`)
    );
  }

  // La reposición va después de la última fecha existente.
  const maxRound = all.reduce((mx, m) => Math.max(mx, m.round ?? 0), 0);
  const plan = buildMakeUpPlan(postponed, maxRound, schedule);

  const stmts: D1PreparedStatement[] = [];
  for (const block of plan) {
    const slots = roundSlots(block.matches.length, schedule);
    for (const [i, m] of block.matches.entries()) {
      stmts.push(
        c.env.DB.prepare(
          'UPDATE matches SET round = ?1, status = ?2, played_on = ?3, kickoff_time = ?4, venue = ?5 WHERE id = ?6 AND status = ?7'
        ).bind(block.round, 'scheduled', block.played_on, slots[i]?.kickoff ?? '', slots[i]?.venue ?? '', m.id, 'postponed')
      );
    }
  }
  await c.env.DB.batch(stmts);

  const first = plan[0]!.round;
  const last = plan[plan.length - 1]!.round;
  const suffix = plan.length > 1 ? ` en ${plan.length} fechas de reposición` : ' en la fecha de reposición';
  return c.redirect(
    `${dest}&msg=` +
      encodeURIComponent(`Reposición agendada: ${postponed.length} partido(s)${suffix} (fecha${plan.length > 1 ? 's' : ''} ${first}–${last})`)
  );
});

adminRoutes.get('/fixture/:id/editar', async (c) => {
  return c.html(
    await admin.matchFormPage(c.env.DB, c.req.query('t'), Number(c.req.param('id')), c.req.query('err'))
  );
});

/**
 * Fase 13: reprograma un partido (día, hora y/o cancha) dejando registro del
 * motivo en match_reschedules. Solo cambia esos tres datos: torneo, jornada,
 * equipos, resultado, eventos y llave quedan intactos.
 */
adminRoutes.post('/fixture/:id/reprogramar', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const m = await getMatch(c.env.DB, id);
  if (!m) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Partido inexistente'));
  const t = await resolveTournament(c.env.DB, undefined, m.tournament_id);
  if (!t) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(t.slug)}`;
  const fail = (msg: string) => c.redirect(`${dest}&err=` + encodeURIComponent(msg));

  const plan = planReschedule({
    match: m,
    tournamentStatus: t.status,
    playedOn: String(f['played_on'] ?? ''),
    kickoffTime: String(f['kickoff_time'] ?? ''),
    venue: String(f['venue'] ?? ''),
    reason: String(f['reason'] ?? ''),
  });
  if (!plan.ok) return fail(plan.error);

  await c.env.DB.batch([
    c.env.DB
      .prepare('UPDATE matches SET played_on = ?1, kickoff_time = ?2, venue = ?3 WHERE id = ?4')
      .bind(plan.playedOn, plan.kickoffTime, plan.venue, id),
    c.env.DB
      .prepare(
        'INSERT INTO match_reschedules (match_id, old_played_on, old_kickoff_time, old_venue, new_played_on, new_kickoff_time, new_venue, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
      )
      .bind(
        id,
        m.played_on,
        m.kickoff_time,
        m.venue,
        plan.playedOn,
        plan.kickoffTime,
        plan.venue,
        String(f['reason'] ?? '').trim()
      ),
  ]);
  const que = plan.venueOnly ? 'cancha actualizada' : 'reprogramado';
  return c.redirect(`${dest}&msg=` + encodeURIComponent(`Partido ${que}: nuevo día ${plan.playedOn || 'a definir'} ${plan.kickoffTime}`.trim() + '. El motivo quedó registrado.'));
});

/** Historial de reprogramaciones de un partido (para la planilla). */
adminRoutes.get('/fixture/:id/reprogramaciones', async (c) => {
  const id = Number(c.req.param('id'));
  const { results } = await c.env.DB
    .prepare('SELECT * FROM match_reschedules WHERE match_id = ?1 ORDER BY id DESC')
    .bind(id)
    .all<RescheduleRecord>();
  return c.json(results ?? []);
});

/** Bitácora del partido: qué cambió, cuándo y qué quedó antes. */
adminRoutes.get('/fixture/:id/bitacora', async (c) => {
  const id = Number(c.req.param('id'));
  return c.json(await listMatchChanges(c.env.DB, id));
});

adminRoutes.post('/fixture/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const before = await getMatch(c.env.DB, id);
  if (!before) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Partido inexistente'));
  // Fase 17: el estado se valida contra lo que la base acepta. Antes se
  // guardaba tal cual y un valor raro terminaba en error 500.
  const statusRaw = String(f['status'] ?? '').trim();
  if (!isMatchStatus(statusRaw)) {
    return c.redirect(`/admin/fixture/${id}/editar?err=` + encodeURIComponent(invalidStatusMessage(statusRaw)));
  }
  // Fase 12C: en finalizado/archivado los partidos son históricos.
  const tRow = await c.env.DB.prepare('SELECT status FROM tournaments WHERE id = ?1').bind(before.tournament_id).first<{ status: string }>();
  if (tRow && statusBlocksMatchEdits(tRow.status)) {
    return c.redirect(`/admin/fixture/${id}/editar?err=` + encodeURIComponent(matchEditsBlockedReason(tRow.status)));
  }
  const roundRaw = String(f['round'] ?? '').trim();
  const round = roundRaw ? Number(roundRaw) : null;
  await c.env.DB.prepare(
    'UPDATE matches SET tournament_id = ?1, round = ?2, zone = ?3, home_team_id = ?4, away_team_id = ?5, played_on = ?6, kickoff_time = ?7, venue = ?8, status = ?9 WHERE id = ?10'
  )
    .bind(
      Number(f['tournament_id']),
      round,
      String(f['zone'] ?? ''),
      f['home_team_id'] ? Number(f['home_team_id']) : null,
      f['away_team_id'] ? Number(f['away_team_id']) : null,
      String(f['played_on'] ?? ''),
      String(f['kickoff_time'] ?? ''),
      String(f['venue'] ?? ''),
      statusRaw,
      id
    )
    .run();
  // Bitácora del partido: solo lo que cambió de verdad.
  const after = await getMatch(c.env.DB, id);
  if (after) {
    const { results } = await c.env.DB.prepare('SELECT id, name FROM teams').all<{ id: number; name: string }>();
    const names: Record<number, string> = {};
    for (const r of results ?? []) names[r.id] = r.name;
    await insertMatchChanges(c.env.DB, after, diffMatch(before, after, { teamNames: names }), ACTOR_ADMIN);
  }
  return c.redirect('/admin/fixture?msg=' + encodeURIComponent('Partido actualizado'));
});

adminRoutes.post('/fixture/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM events WHERE match_id = ?1').bind(id).run();
  await c.env.DB.prepare('DELETE FROM matches WHERE id = ?1').bind(id).run();
  return c.redirect('/admin/fixture?msg=' + encodeURIComponent('Partido eliminado'));
});

/* ---------- Fechas (día/hora/cancha por ronda) ---------- */

adminRoutes.get('/fechas', async (c) => {
  return c.html(await admin.roundsSchedulePage(c.env.DB, c.req.query('t'), c.req.query('msg'), c.req.query('err')));
});

/** Regenera hora y cancha de UNA jornada (y opcionalmente corre el día). */
adminRoutes.post('/fechas/regenerar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const round = Number(f['round']);
  const shift = Math.trunc(Number(f['shift_days'] ?? 0)) || 0;
  if (!Number.isFinite(tournamentId) || !Number.isFinite(round)) {
    return c.redirect('/admin/fechas?err=' + encodeURIComponent('Fecha inexistente'));
  }
  const t = await resolveTournament(c.env.DB, undefined, tournamentId);
  if (!t) return c.redirect('/admin/fechas?err=' + encodeURIComponent('Torneo inexistente'));
  const slugQ = `?t=${encodeURIComponent(t.slug)}`;

  const sel =
    'SELECT id, round, played_on, kickoff_time, venue, status FROM matches WHERE tournament_id = ?1 ORDER BY id';
  const all = ((await c.env.DB.prepare(sel).bind(tournamentId).all<{
    id: number;
    round: number | null;
    played_on: string;
    kickoff_time: string;
    venue: string;
    status: string;
  }>()).results ?? []);
  const roundMatches = all.filter((m) => m.round === round);
  if (roundMatches.length === 0) {
    return c.redirect(`/admin/fechas${slugQ}&err=` + encodeURIComponent(`La fecha ${round} no tiene partidos`));
  }

  // Slots tomados por otros partidos del torneo: el re-sloteo no puede pisarlos.
  const pendingIds = new Set(roundMatches.filter((m) => isRegenerable(m.status)).map((m) => m.id));
  const occupied = new Set(
    all
      .filter((m) => !pendingIds.has(m.id) && m.played_on && m.kickoff_time && m.venue)
      .map((m) => `${m.played_on}|${m.kickoff_time}|${m.venue}`)
  );

  const updates = regenerateRound(roundMatches, scheduleOf(t.config), shift, occupied);
  const stmts: D1PreparedStatement[] = updates.map((u) =>
    c.env.DB.prepare('UPDATE matches SET played_on = ?1, kickoff_time = ?2, venue = ?3 WHERE id = ?4')
      .bind(u.played_on, u.kickoff, u.venue, u.id)
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  const day = shift !== 0 ? (shift > 0 ? ` (+${shift} día${shift > 1 ? 's' : ''})` : ` (${shift} día)`) : '';
  const resumen = `Fecha ${round} regenerada: ${updates.length} partido(s)${day}`;

  // Verificación: que la cancha y el horario no queden duplicados ese día.
  const after = (await c.env.DB.prepare(sel).bind(tournamentId).all<{
    id: number;
    round: number | null;
    played_on: string;
    kickoff_time: string;
    venue: string;
    status: string;
  }>()).results ?? [];
  const conflicts = slotConflicts(after, (m) => m.round === round);
  if (conflicts.length) {
    const detail = conflicts.slice(0, 4).join(' · ') + (conflicts.length > 4 ? ' …' : '');
    return c.redirect(`/admin/fechas${slugQ}&err=` + encodeURIComponent(`⚠ ${resumen}. Choques: ${detail}`));
  }
  return c.redirect(
    `/admin/fechas${slugQ}&msg=` + encodeURIComponent(`${resumen}. ✓ Sin choques de cancha u horario`)
  );
});

adminRoutes.post('/fechas/guardar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  if (!Number.isFinite(tournamentId)) return c.redirect('/admin/fixture');
  const round = Number(f['round']);
  const matches = await c.env.DB.prepare('SELECT id FROM matches WHERE tournament_id = ?1 AND round = ?2')
    .bind(tournamentId, round)
    .all<{ id: number }>();
  const stmts: D1PreparedStatement[] = [];
  for (const m of matches.results ?? []) {
    const d = String(f[`d_${m.id}`] ?? '');
    const t = String(f[`t_${m.id}`] ?? '');
    const v = String(f[`v_${m.id}`] ?? '');
    stmts.push(
      c.env.DB.prepare('UPDATE matches SET played_on = ?1, kickoff_time = ?2, venue = ?3 WHERE id = ?4').bind(d, t, v, m.id)
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.redirect('/admin/fechas?msg=' + encodeURIComponent(`Fecha ${round} guardada`));
});

/* ---------- Planilla ---------- */

adminRoutes.get('/planilla', (c) =>
  admin.sheetListPage(c.env.DB, c.req.query('t'), c.req.query('msg'), c.req.query('err')).then((h) => c.html(h))
);

adminRoutes.get('/planilla/:id', async (c) => {
  return c.html(await admin.sheetPage(c.env.DB, Number(c.req.param('id')), c.req.query('msg'), c.req.query('err')));
});

/** Ids de la plantilla de un equipo (para exigir que un evento sea de ese lado). */
async function rosterIds(db: D1Database, teamId: number | null): Promise<number[]> {
  if (teamId == null) return [];
  const { results } = await db.prepare('SELECT id FROM players WHERE team_id = ?1 AND active = 1').bind(teamId).all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Mensaje para un estado de partido que no existe. */
function invalidStatusMessage(raw: string): string {
  return `Estado inválido: "${raw}". Los estados posibles son: ${MATCH_STATUSES.map((s) => MATCH_STATUS_LABELS[s]).join(', ')}.`;
}

/** Plantilla completa de un equipo (incluidos los dados de baja) para las listas. */
async function rosterPlayers(db: D1Database, teamId: number | null): Promise<{ id: number; name: string; active: number }[]> {
  if (teamId == null) return [];
  const { results } = await db
    .prepare('SELECT id, name, active FROM players WHERE team_id = ?1 ORDER BY name COLLATE NOCASE')
    .bind(teamId)
    .all<{ id: number; name: string; active: number }>();
  return results ?? [];
}

/** Nombres de los jugadores de una lista de partidos, para la bitácora. */
async function playerNames(db: D1Database, ids: ReadonlySet<number>): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (ids.size === 0) return out;
  const list = [...ids];
  const ph = list.map((_, i) => `?${i + 1}`).join(',');
  const { results } = await db
    .prepare(`SELECT id, name FROM players WHERE id IN (${ph})`)
    .bind(...list)
    .all<{ id: number; name: string }>();
  for (const r of results ?? []) out[r.id] = r.name;
  return out;
}

adminRoutes.post('/planilla/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  // El partido entero, no solo tres columnas: la bitácora necesita comparar
  // la versión anterior con la nueva para asentar solo lo que cambió de verdad.
  const mRow = await getMatch(c.env.DB, id);
  if (!mRow) {
    return c.redirect('/admin/planilla?err=' + encodeURIComponent('Partido inexistente'));
  }
  // Fase 17: nada de "as MatchStatus" ni de Number() a ciegas. Se valida cada
  // campo contra lo que la base acepta de verdad y, si algo no cierra, se
  // vuelve con un mensaje en vez de un error 500 del servidor.
  const authored = await c.env.DB
    .prepare("SELECT COUNT(*) AS n FROM events WHERE match_id = ?1 AND type IN ('goal','own_goal') AND player_id IS NOT NULL")
    .bind(id)
    .first<{ n: number }>();
  const sheet = validateSheetForm(f, { authoredGoals: Number(authored?.n ?? 0) });
  if (!sheet.ok) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(sheet.error));
  }
  const { status, homeGoals, awayGoals } = sheet.value;
  // Marcar un partido como Libre es cancelarlo: no se juega nunca y no cuenta
  // para nadie. Se pide el motivo para que quede dicho POR QUÉ.
  const changeReason = cleanReason(f['change_reason']);
  if (needsCancelReason(mRow.status, status) && !changeReason) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(cancelReasonError(status)));
  }
  // Fase 12C: en finalizado/archivado los resultados son históricos.
  const tStatus = await c.env.DB
    .prepare('SELECT status FROM tournaments WHERE id = ?1')
    .bind(mRow.tournament_id)
    .first<{ status: string }>();
  if (tStatus && statusBlocksMatchEdits(tStatus.status)) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(matchEditsBlockedReason(tStatus.status)));
  }

  // Declaración de goles: el marcador del form manda y las listas nombran a
  // los autores. Guardar REEMPLAZA los goles del partido (las tarjetas no se
  // tocan), así cargar de nuevo nunca duplica ni suma.
  const collect = (prefix: string, goals: number): string[] => {
    const raws: string[] = [];
    for (let i = 1; i <= Math.min(goals, MAX_GOALS); i++) raws.push(String(f[`${prefix}${i}`] ?? ''));
    return raws;
  };
  const beforeEvents = await listEvents(c.env.DB, id);
  const sidePlan = async (
    teamId: number | null,
    goals: number,
    prefix: string
  ): Promise<{ ok: true; picks: GoalPick[] } | { ok: false; error: string }> => {
    if (goals === 0 || teamId == null) return { ok: true, picks: [] };
    // Solo se puede elegir a un jugador que NO esté dado de baja... salvo que
    // ya sea el autor de un gol cargado: ese se conserva o el guardado lo
    // perdería en silencio.
    const roster = await rosterPlayers(c.env.DB, teamId);
    const currentAuthors = new Set(
      beforeEvents
        .filter((e) => e.team_id === teamId && (e.type === 'goal' || e.type === 'own_goal'))
        .map((e) => e.player_id)
        .filter((p): p is number => p != null)
    );
    const split = splitRoster(roster, currentAuthors);
    const allowed = split.allowedIds;
    // Sin plantilla no hay listas útiles: anónimos, salvo los "en contra".
    if (allowed.length === 0) return { ok: true, picks: picksWithoutRoster(collect(prefix, goals), goals) };
    return resolveGoalPlan({ goals, raws: collect(prefix, goals), allowed });
  };
  const homePlan = await sidePlan(mRow.home_team_id, homeGoals, 'hg');
  const awayPlan = await sidePlan(mRow.away_team_id, awayGoals, 'ag');
  if (!homePlan.ok) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(`Local: ${homePlan.error}`));
  }
  if (!awayPlan.ok) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(`Visitante: ${awayPlan.error}`));
  }

  const stmts: D1PreparedStatement[] = [];
  const replaceGoals = (teamId: number, picks: GoalPick[]): void => {
    stmts.push(
      c.env.DB.prepare("DELETE FROM events WHERE match_id = ?1 AND team_id = ?2 AND type IN ('goal','own_goal')").bind(id, teamId)
    );
    for (const p of picks) {
      if (p.kind === 'player') {
        stmts.push(c.env.DB.prepare("INSERT INTO events (match_id, team_id, player_id, type) VALUES (?1, ?2, ?3, 'goal')").bind(id, teamId, p.id));
      } else if (p.kind === 'own') {
        stmts.push(c.env.DB.prepare("INSERT INTO events (match_id, team_id, player_id, type) VALUES (?1, ?2, NULL, 'own_goal')").bind(id, teamId));
      } else {
        stmts.push(c.env.DB.prepare("INSERT INTO events (match_id, team_id, player_id, type) VALUES (?1, ?2, NULL, 'goal')").bind(id, teamId));
      }
    }
  };
  // La declaración manda: se reemplaza lo cargado de cada camiseta, siempre
  // a nombre del equipo dueño de la lista (los "en contra" van en su arco).
  if (mRow.home_team_id != null) replaceGoals(mRow.home_team_id, homePlan.picks);
  if (mRow.away_team_id != null) replaceGoals(mRow.away_team_id, awayPlan.picks);

  stmts.push(
    c.env.DB
      .prepare(
        'UPDATE matches SET status = ?1, played_on = ?2, kickoff_time = ?3, venue = ?4, home_goals = ?5, away_goals = ?6, home_points = ?7, away_points = ?8, notes = ?9 WHERE id = ?10'
      )
      .bind(
        status,
        sheet.value.playedOn,
        sheet.value.kickoffTime,
        sheet.value.venue,
        homeGoals,
        awayGoals,
        sheet.value.homePoints,
        sheet.value.awayPoints,
        sheet.value.notes,
        id
      )
  );
  await c.env.DB.batch(stmts);
  // Si el partido decide una llave (semifinal), el siguiente round se completa solo.
  await applyAdvancements(c.env.DB, mRow.tournament_id);
  // Bitácora: SOLO lo que cambió de verdad. Si se abrió y guardó sin tocar nada,
  // la lista viene vacía y no queda una fila de ruido.
  const after = await getMatch(c.env.DB, id);
  if (after) {
    const afterEvents = await listEvents(c.env.DB, id);
    const ids = new Set<number>();
    for (const e of [...beforeEvents, ...afterEvents]) if (e.player_id != null) ids.add(e.player_id);
    const names = await playerNames(c.env.DB, ids);
    const sides = { home: after.home_team_id, away: after.away_team_id };
    const changes = diffMatch(mRow, after, { reason: changeReason });
    const oldAuthors = goalAuthorsLabel(beforeEvents, sides, names);
    const newAuthors = goalAuthorsLabel(afterEvents, sides, names);
    if (oldAuthors !== newAuthors) changes.push(goalAuthorsChange(oldAuthors, newAuthors, changeReason));
    await insertMatchChanges(c.env.DB, after, changes, ACTOR_ADMIN);
  }
  return c.redirect(`/admin/planilla/${id}?msg=` + encodeURIComponent('Planilla guardada'));
});

adminRoutes.post('/planilla/:id/evento', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const mRow = await getMatch(c.env.DB, id);
  if (!mRow) return c.redirect('/admin/planilla?err=' + encodeURIComponent('Partido inexistente'));
  const evStatus = await c.env.DB
    .prepare('SELECT status FROM tournaments WHERE id = ?1')
    .bind(mRow.tournament_id)
    .first<{ status: string }>();
  if (evStatus && statusBlocksMatchEdits(evStatus.status)) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(matchEditsBlockedReason(evStatus.status)));
  }
  // Fase 17: el evento tiene que ser de verdad — tipo válido, equipo de este
  // partido y jugador de esa misma plantilla. Antes pasaban cualquier valor y
  // dos de ellos terminaban en error 500 del servidor.
  const [homeRoster, awayRoster] = await Promise.all([
    rosterIds(c.env.DB, mRow.home_team_id),
    rosterIds(c.env.DB, mRow.away_team_id),
  ]);
  const ev = validateEventForm(f, {
    homeTeamId: mRow.home_team_id,
    awayTeamId: mRow.away_team_id,
    homeRoster,
    awayRoster,
  });
  if (!ev.ok) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(ev.error));
  }
  // Guardia de elegibilidad: un jugador suspendido para este partido no
  // genera eventos acá. Bloqueo duro, con motivo y origen en el mensaje.
  const discipline = await admin.disciplineForMatch(c.env.DB, mRow);
  if (discipline) {
    const el = playerEligibility(discipline, ev.value.playerId);
    if (!el.eligible) {
      return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(eligibilityErrorMessage(el)));
    }
  }
  await c.env.DB.prepare('INSERT INTO events (match_id, team_id, player_id, type, minute) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, ev.value.teamId, ev.value.playerId, ev.value.type, ev.value.minute)
    .run();
  // Bitácora: el evento queda asentado con el nombre del jugador y el minuto.
  const name = (await getPlayer(c.env.DB, ev.value.playerId))?.name ?? null;
  await insertMatchChanges(
    c.env.DB,
    mRow,
    [eventChange({ type: ev.value.type, player_id: ev.value.playerId, minute: ev.value.minute }, name, EVENT_TYPE_LABELS[ev.value.type], 'agregado')],
    ACTOR_ADMIN
  );
  return c.redirect(`/admin/planilla/${id}`);
});

adminRoutes.post('/planilla/:id/evento/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const mRow = await getMatch(c.env.DB, id);
  if (mRow) {
    // Fase 12C: en finalizado/archivado los eventos son históricos.
    const evStatus = await c.env.DB
      .prepare('SELECT status FROM tournaments WHERE id = ?1')
      .bind(mRow.tournament_id)
      .first<{ status: string }>();
    if (evStatus && statusBlocksMatchEdits(evStatus.status)) {
      return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent(matchEditsBlockedReason(evStatus.status)));
    }
  }
  // Fase 17: borrar un evento solo si es de ESTE partido. Antes el borrado
  // era por id a secas: desde la planilla de un partido se caaban eventos de
  // otro. La condición va en el DELETE, no sólo en la lectura previa.
  const eventId = Number(f['event_id']);
  const evRow = Number.isInteger(eventId)
    ? await c.env.DB
        .prepare('SELECT id, match_id, type, player_id, minute FROM events WHERE id = ?1')
        .bind(eventId)
        .first<{ id: number; match_id: number; type: string; player_id: number | null; minute: number | null }>()
    : null;
  if (!eventBelongsToMatch(evRow, id)) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent('Ese evento no pertenece a este partido'));
  }
  await c.env.DB.prepare('DELETE FROM events WHERE id = ?1 AND match_id = ?2').bind(eventId, id).run();
  // Bitácora: también queda asentado lo que se borró.
  if (mRow && evRow) {
    const name = evRow.player_id != null ? (await getPlayer(c.env.DB, evRow.player_id))?.name ?? null : null;
    await insertMatchChanges(
      c.env.DB,
      mRow,
      [
        eventChange(
          { type: evRow.type as EventType, player_id: evRow.player_id, minute: evRow.minute },
          name,
          EVENT_TYPE_LABELS[evRow.type as EventType] ?? evRow.type,
          'eliminado'
        ),
      ],
      ACTOR_ADMIN
    );
  }
  return c.redirect(`/admin/planilla/${id}`);
});

/* ---------- Ajustes de puntos ---------- */

/** URL de vuelta al panel de Ajustes con flash; respeta el ?t= del selector. */
function adjustmentRedirect(slug: string | undefined, key: 'msg' | 'err', text: string): string {
  const base = slug ? `/admin/ajustes?t=${encodeURIComponent(slug)}` : '/admin/ajustes';
  return `${base}${slug ? '&' : '?'}${key}=${encodeURIComponent(text)}`;
}

adminRoutes.get('/ajustes', async (c) => {
  return c.html(await adjustmentsAdminPage(c.env.DB, c.req.query('t')));
});

adminRoutes.post('/ajustes', async (c) => {
  const slug = c.req.query('t');
  const parsed = parseAdjustment(await c.req.parseBody());
  if (!parsed.ok) {
    return c.redirect(adjustmentRedirect(slug, 'err', parsed.error ?? 'Datos inválidos'));
  }
  const t = await resolveTournamentForAdjustment(c.env.DB, slug);
  if (!t) return c.redirect(adjustmentRedirect(slug, 'err', 'Torneo inexistente'));
  // Guardia: el ajuste va a un equipo PARTICIPANTE del torneo. Torneos viejos
  // sin filas de participación aceptan cualquier equipo (comportamiento previo).
  const { teams: pool, fallback } = await participantsOrAllTeams(c.env.DB, t.id);
  if (!fallback && !pool.some((tm) => tm.id === parsed.value!.teamId)) {
    return c.redirect(adjustmentRedirect(slug, 'err', 'Ese equipo no participa de este torneo'));
  }
  await insertAdjustment(c.env.DB, t.id, parsed.value!);
  const sign = parsed.value!.delta > 0 ? `+${parsed.value!.delta}` : String(parsed.value!.delta);
  return c.redirect(adjustmentRedirect(slug, 'msg', `Ajuste de ${sign} puntos aplicado y documentado`));
});

adminRoutes.post('/ajustes/:id/borrar', async (c) => {
  const slug = c.req.query('t');
  await deleteAdjustment(c.env.DB, Number(c.req.param('id')));
  return c.redirect(adjustmentRedirect(slug, 'msg', 'Ajuste eliminado'));
});

/* ---------- Suspensiones ---------- */

adminRoutes.get('/suspensiones', async (c) => {
  return c.html(await admin.suspensionsAdminPage(c.env.DB, c.req.query('t')));
});

/* ---------- Sanciones disciplinarias (manuales) ---------- */

const SANCIONES_MSG = 'Sanción registrada';

adminRoutes.get('/sanciones', async (c) => {
  // La página vive en /admin/suspensiones: acá solo se redirige respetando el
  // selector de torneo (atajo cómodo; el form del modal postea a /admin/sanciones).
  return c.redirect(`/admin/suspensiones${c.req.query('t') ? `?t=${encodeURIComponent(c.req.query('t')!)}` : ''}`);
});

adminRoutes.post('/sanciones', async (c) => {
  const form = await c.req.parseBody();
  const slug = typeof form['t'] === 'string' ? form['t'] : c.req.query('t');
  const back = () => `/admin/suspensiones${slug ? `?t=${encodeURIComponent(slug)}` : ''}`;
  // El torneo viaja como hidden (y el select informativo va disabled, que no
  // se envía): si el form no lo trae, se resuelve por el slug del selector.
  const formForParse: Record<string, unknown> = { ...form };
  if (!formForParse['tournament_id'] && slug) {
    const tBySlug = await resolveTournament(c.env.DB, slug);
    if (tBySlug) formForParse['tournament_id'] = String(tBySlug.id);
  }
  const parsed = parseSanction(formForParse);
  if (!parsed.ok) {
    return c.redirect(`${back()}&err=` + encodeURIComponent(parsed.error ?? 'Datos inválidos'));
  }
  const v = parsed.value!;
  // Guardias de contexto: el torneo del form manda, y el equipo/jugador deben existir.
  const team = await getTeam(c.env.DB, v.teamId);
  if (!team) return c.redirect(`${back()}&err=` + encodeURIComponent('El equipo no existe'));
  if (v.playerId != null) {
    const player = await getPlayer(c.env.DB, v.playerId);
    if (!player || player.team_id !== v.teamId) {
      return c.redirect(`${back()}&err=` + encodeURIComponent('El jugador no pertenece a ese equipo'));
    }
  }
  await insertSanction(c.env.DB, v);
  return c.redirect(`${back()}&msg=` + encodeURIComponent(SANCIONES_MSG));
});

adminRoutes.post('/sanciones/:id/anular', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const slug = typeof form['t'] === 'string' ? form['t'] : c.req.query('t');
  const back = () => `/admin/suspensiones${slug ? `?t=${encodeURIComponent(slug)}` : ''}`;
  const parsed = parseAnnulment(form as Record<string, unknown>);
  if (!parsed.ok) {
    return c.redirect(`${back()}&err=` + encodeURIComponent(parsed.error ?? 'Falta el motivo'));
  }
  const s = await getSanction(c.env.DB, id);
  if (!s) return c.redirect(`${back()}&err=` + encodeURIComponent('La sanción no existe'));
  if (s.status !== 'activa') {
    return c.redirect(`${back()}&err=` + encodeURIComponent('Solo se puede anular una sanción activa'));
  }
  await annulSanction(c.env.DB, id, parsed.reason!);
  return c.redirect(`${back()}&msg=` + encodeURIComponent('Sanción anulada')); 
});
