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
import type { MatchStatus } from '../lib/types.ts';
import { generateDelegateCode } from '../lib/delegates.ts';
import { roundSlots, scheduleFromForm, scheduleOf } from '../lib/schedule.ts';
import { getMatch, getTeam } from '../lib/queries.ts';
import { getSubmission } from '../lib/submissions.ts';
import * as admin from '../ui/admin.ts';

export const adminRoutes = new Hono<{ Bindings: Env }>();

export async function isAdmin(c: any): Promise<boolean> {
  return verifySessionToken(getSessionCookie(c.req.raw), sessionSecret(c.env));
}

adminRoutes.use('*', async (c, next) => {
  const path = c.req.path;
  const isLogin = path === '/admin/login' || path === '/admin/logout';
  if (isLogin) return next();
  if (await isAdmin(c)) return next();
  return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
});

adminRoutes.get('/login', (c) => {
  const next = c.req.query('next');
  return c.html(admin.loginPage(undefined, next));
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
  const config = { ...rules, ...scheduleFromForm(f) };
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
  const config = { ...rules, ...scheduleFromForm(f) };
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

adminRoutes.post('/fixture/generar', async (c) => {
  const f = await c.req.parseBody();
  const tournamentId = Number(f['tournament_id']);
  const mode = String(f['mode'] ?? 'single');
  const teams = await c.env.DB.prepare('SELECT id FROM teams WHERE active = 1 ORDER BY id').all<{ id: number }>();
  const ids = (teams.results ?? []).map((r) => r.id);
  if (ids.length < 2) {
    return c.redirect('/admin/fixture?err=' + encodeURIComponent('Necesitás al menos 2 equipos activos'));
  }
  const fixture =
    mode === 'double' ? admin.generateDoubleRoundRobin(ids) : admin.generateRoundRobin(ids);

  // Canchas y horarios del torneo: cada partido de una jornada toma su slot
  // (primera hora en todas las canchas, después la siguiente hora, y así).
  const tRow = await c.env.DB.prepare('SELECT config FROM tournaments WHERE id = ?1').bind(tournamentId).first<{ config: string }>();
  const schedule = scheduleOf(tRow?.config ?? '{}');

  const stmts: D1PreparedStatement[] = [];
  stmts.push(c.env.DB.prepare("DELETE FROM events WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?1)").bind(tournamentId));
  stmts.push(c.env.DB.prepare('DELETE FROM matches WHERE tournament_id = ?1').bind(tournamentId));
  let round = 1;
  for (const pairs of fixture.rounds) {
    const slots = roundSlots(pairs.length, schedule);
    for (const [i, p] of pairs.entries()) {
      const slot = slots[i];
      stmts.push(
        c.env.DB.prepare(
          'INSERT INTO matches (tournament_id, round, home_team_id, away_team_id, status, venue, kickoff_time) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
        ).bind(tournamentId, round, p.home, p.away, 'scheduled', slot?.venue ?? '', slot?.kickoff ?? '')
      );
    }
    round += 1;
  }
  await c.env.DB.batch(stmts);
  return c.redirect('/admin/fixture?msg=' + encodeURIComponent(`Fixture generado: ${fixture.rounds.length} fechas`));
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
  return c.html(await admin.roundsSchedulePage(c.env.DB, c.req.query('t')));
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
  return c.html(await admin.sheetPage(c.env.DB, Number(c.req.param('id'))));
});

adminRoutes.post('/planilla/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const status = String(f['status'] ?? 'scheduled') as MatchStatus;
  const homePts = String(f['home_points'] ?? '').trim();
  const awayPts = String(f['away_points'] ?? '').trim();
  await c.env.DB.prepare(
    'UPDATE matches SET status = ?1, played_on = ?2, kickoff_time = ?3, venue = ?4, home_goals = ?5, away_goals = ?6, home_points = ?7, away_points = ?8, notes = ?9 WHERE id = ?10'
  )
    .bind(
      status,
      String(f['played_on'] ?? ''),
      String(f['kickoff_time'] ?? ''),
      String(f['venue'] ?? ''),
      Number(f['home_goals'] ?? 0),
      Number(f['away_goals'] ?? 0),
      homePts ? Number(homePts) : null,
      awayPts ? Number(awayPts) : null,
      String(f['notes'] ?? ''),
      id
    )
    .run();
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

/* ---------- Suspensiones ---------- */

adminRoutes.get('/suspensiones', async (c) => {
  return c.html(await admin.suspensionsAdminPage(c.env.DB, c.req.query('t')));
});
