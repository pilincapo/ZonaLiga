// Rutas del panel admin: auth + handlers CRUD.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import {
  clearSessionCookieHeader,
  createSessionToken,
  getSessionCookie,
  hashPassword,
  safeEqual,
  sessionCookieHeader,
  sessionSecret,
  verifySessionToken,
} from '../lib/auth.ts';
import { slugify } from '../lib/slug.ts';
import type { Match, MatchStatus } from '../lib/types.ts';
import { regeneratePairings, verifyPairings, slotConflicts, playedCount } from '../lib/fixture.ts';
import { resolveGoalPlan, picksWithoutRoster, MAX_GOALS, type GoalPick } from '../lib/sheet.ts';
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
import { planFixture, planSummary } from '../lib/planifier.ts';
import { CROSSOVER_NOTE, CROSSOVER_NOTE_COUNTS } from '../lib/crossover.ts';
import { computeStandings } from '../lib/standings.ts';
import { rulesOf } from '../lib/rules.ts';
import { resolveTournament } from '../lib/tournamentView.ts';
import { getMatch, getTeam } from '../lib/queries.ts';
import { getSubmission } from '../lib/submissions.ts';
import { deleteAdjustment, insertAdjustment, parseAdjustment } from '../lib/adjustments.ts';
import { adjustmentsAdminPage } from '../ui/adminAjustes.ts';
import * as admin from '../ui/admin.ts';

export const adminRoutes = new Hono<{ Bindings: Env }>();

export async function isAdmin(c: any): Promise<boolean> {
  return verifySessionToken(getSessionCookie(c.req.raw), sessionSecret(c.env));
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
  const expected = sessionSecret(c.env);
  const [hashA, hashB] = await Promise.all([hashPassword(password), hashPassword(expected)]);
  if (!safeEqual(hashA, hashB)) {
    return c.html(admin.loginPage('Contraseña incorrecta', next), 401);
  }
  const token = await createSessionToken(expected);
  c.header('Set-Cookie', sessionCookieFor(token));
  return c.redirect(next.startsWith('/admin') ? next : '/admin');
});

function sessionCookieFor(token: string): string {
  // En localhost Secure no bloquea la cookie en Chrome/Firefox modernos (excepción para http://localhost).
  return sessionCookieHeader(token);
}

adminRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader());
  return c.redirect('/admin/login');
});

adminRoutes.get('/', (c) => admin.dashboardPage(c.env.DB, c.req.query('msg') ?? undefined, c.req.query('err') ?? undefined).then((html) => c.html(html)));

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
  const config = { ...rules, ...scheduleFromForm(f), zones: zonesFromForm(f) };
  await c.env.DB.prepare(
    'INSERT INTO tournaments (name, slug, season, format, config, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  )
    .bind(name, slug, String(f['season'] ?? ''), String(f['format'] ?? 'round_robin'), JSON.stringify(config), String(f['status'] ?? 'draft'))
    .run();
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
  const rules = readRules(f);
  // Preserva las fechas de cruce ya generadas: se guardan en la misma config
  // y este form no las toca.
  const prevRow = await c.env.DB.prepare('SELECT config FROM tournaments WHERE id = ?1').bind(id).first<{ config: string }>();
  const prevKeep = {
    ...crossoverConfigJson(parseCrossoverConfig(prevRow?.config ?? '{}')),
    ...playoffConfigJson(parsePlayoffConfig(prevRow?.config ?? '{}')),
  };
  const config = { ...rules, ...scheduleFromForm(f), zones: zonesFromForm(f), ...prevKeep };
  await c.env.DB.prepare('UPDATE tournaments SET name = ?1, season = ?2, format = ?3, config = ?4, status = ?5 WHERE id = ?6')
    .bind(name, String(f['season'] ?? ''), String(f['format'] ?? 'round_robin'), JSON.stringify(config), String(f['status'] ?? 'draft'), id)
    .run();
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
  const name = String(f['name'] ?? '').trim();
  if (!name) return c.html(await admin.teamFormPage(c.env.DB, undefined, 'El nombre es obligatorio'), 400);
  let slug = slugify(name);
  const existing = await c.env.DB.prepare('SELECT id FROM teams WHERE slug = ?1').bind(slug).first();
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;
  await c.env.DB.prepare('INSERT INTO teams (name, slug, short_name, color, logo_url, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(name, slug, String(f['short_name'] ?? '').toUpperCase(), String(f['color'] ?? '#22c55e'), String(f['logo_url'] ?? ''), f['active'] ? 1 : 0)
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
  const name = String(f['name'] ?? '').trim();
  if (!name) {
    return c.html(await admin.teamFormPage(c.env.DB, id, 'El nombre es obligatorio', new URL(c.req.url).origin), 400);
  }
  await c.env.DB.prepare('UPDATE teams SET name = ?1, short_name = ?2, color = ?3, logo_url = ?4, active = ?5 WHERE id = ?6')
    .bind(name, String(f['short_name'] ?? '').toUpperCase(), String(f['color'] ?? '#22c55e'), String(f['logo_url'] ?? ''), f['active'] ? 1 : 0, id)
    .run();
  return c.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo actualizado'));
});

adminRoutes.post('/equipos/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM teams WHERE id = ?1').bind(id).run();
  return c.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo eliminado'));
});

/* ---------- Jugadores ---------- */

adminRoutes.get('/jugadores', async (c) => {
  const teamParam = c.req.query('team');
  return c.html(await admin.playersAdminPage(c.env.DB, teamParam ? Number(teamParam) : undefined, c.req.query('msg'), c.req.query('err')));
});

adminRoutes.post('/jugadores', async (c) => {
  const f = await c.req.parseBody();
  const teamId = Number(f['team_id']);
  const name = String(f['name'] ?? '').trim();
  if (!name || !Number.isFinite(teamId)) {
    return c.redirect('/admin/jugadores?err=' + encodeURIComponent('Faltan datos'));
  }
  const numberRaw = String(f['number'] ?? '').trim();
  const number = numberRaw ? Number(numberRaw) : null;
  await c.env.DB.prepare('INSERT INTO players (team_id, name, number, position, active) VALUES (?1, ?2, ?3, ?4, 1)')
    .bind(teamId, name, number, String(f['position'] ?? ''))
    .run();
  return c.redirect(`/admin/jugadores?team=${teamId}&msg=` + encodeURIComponent('Jugador agregado'));
});

adminRoutes.post('/jugadores/:id/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  const teamParam = c.req.query('team');
  await c.env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(id).run();
  return c.redirect(`/admin/jugadores${teamParam ? `?team=${teamParam}` : ''}&msg=` + encodeURIComponent('Jugador eliminado'));
});

/* ---------- Fixture ---------- */

adminRoutes.get('/fixture', async (c) => {
  return c.html(await admin.fixtureAdminPage(c.env.DB, c.req.query('t'), c.req.query('msg'), c.req.query('err')));
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
    .prepare('SELECT slug, config, status FROM tournaments WHERE id = ?1')
    .bind(tournamentId)
    .first<{ slug: string; config: string; status: string }>();
  if (!tRow) return c.redirect('/admin/fixture?err=' + encodeURIComponent('Torneo inexistente'));
  const dest = `/admin/fixture?t=${encodeURIComponent(tRow.slug)}`;
  if (tRow.status === 'finished') {
    return c.redirect(dest + '&err=' + encodeURIComponent('El torneo está finalizado: cambialo a activo para regenerar el fixture.'));
  }

  // Config completa del torneo: equipos, zonas, cruces y canchas/horarios.
  const teams = await c.env.DB
    .prepare('SELECT id, name FROM teams WHERE active = 1 ORDER BY id')
    .all<{ id: number; name: string }>();
  const ids = (teams.results ?? []).map((r) => r.id);
  if (ids.length < 2) {
    return c.redirect(dest + '&err=' + encodeURIComponent('Necesitás al menos 2 equipos activos'));
  }
  const configJson = tRow.config ?? '{}';
  const schedule = scheduleOf(configJson);

  let plan;
  try {
    plan = planFixture({
      teamIds: ids,
      configJson,
      mode,
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
  return c.html(
    await admin.fixturePreviewPage({
      tournamentId: t.id,
      tournamentSlug: t.slug,
      tournamentName: t.name,
      summary: draft.summary,
      payload: draft.payload,
      createdAt: draft.created_at,
      teamNames,
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
  if (tRow.status === 'finished') {
    return c.redirect(dest + '&err=' + encodeURIComponent('El torneo está finalizado: cambialo a activo para regenerar el fixture.'));
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
  const roundRaw = String(f['round'] ?? '').trim();
  const round = roundRaw ? Number(roundRaw) : null;
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
      String(f['status'] ?? 'scheduled')
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
  const activeTeamIds = (teamRows.results ?? []).filter((r) => r.active).map((r) => r.id);
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
  const activeIds = new Set((teamRows.results ?? []).filter((r) => r.active).map((r) => r.id));
  const standings = computeStandings(
    matchesForStandings(matches, t.config),
    (teamRows.results ?? []).map((r) => ({ id: r.id, name: r.name })),
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
  return c.html(await admin.matchFormPage(c.env.DB, c.req.query('t'), Number(c.req.param('id'))));
});

adminRoutes.post('/fixture/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
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
      String(f['status'] ?? 'scheduled'),
      id
    )
    .run();
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

adminRoutes.get('/planilla', (c) => admin.sheetListPage(c.env.DB, c.req.query('msg'), c.req.query('err')).then((h) => c.html(h)));

adminRoutes.get('/planilla/:id', async (c) => {
  return c.html(await admin.sheetPage(c.env.DB, Number(c.req.param('id')), c.req.query('msg'), c.req.query('err')));
});

adminRoutes.post('/planilla/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const status = String(f['status'] ?? 'scheduled') as MatchStatus;
  const homePts = String(f['home_points'] ?? '').trim();
  const awayPts = String(f['away_points'] ?? '').trim();
  const homeGoals = Math.max(0, Math.round(Number(f['home_goals'] ?? 0)) || 0);
  const awayGoals = Math.max(0, Math.round(Number(f['away_goals'] ?? 0)) || 0);
  const mRow = await c.env.DB
    .prepare('SELECT tournament_id, home_team_id, away_team_id FROM matches WHERE id = ?1')
    .bind(id)
    .first<{ tournament_id: number; home_team_id: number | null; away_team_id: number | null }>();
  if (!mRow) {
    return c.redirect('/admin/planilla?err=' + encodeURIComponent('Partido inexistente'));
  }

  // Declaración de goles: el marcador del form manda y las listas nombran a
  // los autores. Guardar REEMPLAZA los goles del partido (las tarjetas no se
  // tocan), así cargar de nuevo nunca duplica ni suma.
  const collect = (prefix: string, goals: number): string[] => {
    const raws: string[] = [];
    for (let i = 1; i <= Math.min(goals, MAX_GOALS); i++) raws.push(String(f[`${prefix}${i}`] ?? ''));
    return raws;
  };
  const sidePlan = async (
    teamId: number | null,
    goals: number,
    prefix: string
  ): Promise<{ ok: true; picks: GoalPick[] } | { ok: false; error: string }> => {
    if (goals === 0 || teamId == null) return { ok: true, picks: [] };
    const roster = await c.env.DB.prepare('SELECT id FROM players WHERE team_id = ?1').bind(teamId).all<{ id: number }>();
    const allowed = (roster.results ?? []).map((p) => p.id);
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
        String(f['played_on'] ?? ''),
        String(f['kickoff_time'] ?? ''),
        String(f['venue'] ?? ''),
        homeGoals,
        awayGoals,
        homePts ? Number(homePts) : null,
        awayPts ? Number(awayPts) : null,
        String(f['notes'] ?? ''),
        id
      )
  );
  await c.env.DB.batch(stmts);
  // Si el partido decide una llave (semifinal), el siguiente round se completa solo.
  await applyAdvancements(c.env.DB, mRow.tournament_id);
  return c.redirect(`/admin/planilla/${id}?msg=` + encodeURIComponent('Planilla guardada'));
});

adminRoutes.post('/planilla/:id/evento', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const teamId = Number(f['team_id']);
  const playerId = Number(f['player_id']);
  const type = String(f['type'] ?? 'goal');
  const minuteRaw = String(f['minute'] ?? '').trim();
  if (!Number.isFinite(playerId)) {
    return c.redirect(`/admin/planilla/${id}?err=` + encodeURIComponent('Elegí un jugador'));
  }
  await c.env.DB.prepare('INSERT INTO events (match_id, team_id, player_id, type, minute) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, Number.isFinite(teamId) ? teamId : null, playerId, type, minuteRaw ? Number(minuteRaw) : null)
    .run();
  return c.redirect(`/admin/planilla/${id}`);
});

adminRoutes.post('/planilla/:id/evento/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  await c.env.DB.prepare('DELETE FROM events WHERE id = ?1').bind(Number(f['event_id'])).run();
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
