// Rutas del panel de delegados: login por código de equipo y carga de resultados
// que quedan pendientes de aprobación del administrador.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types.ts';
import type { Match, Team } from '../lib/types.ts';
import {
  clearDelegateCookieHeader,
  createDelegateToken,
  delegateCookieHeader,
  getDelegateCookie,
  hashPassword,
  sessionSecret,
  verifyDelegateToken,
} from '../lib/auth.ts';
import { canSubmitFor, maxEvents, normalizeCode, parseEvent, parseSubmission } from '../lib/delegates.ts';
import { getMatch, getTeam, listPlayers, listTeams } from '../lib/queries.ts';
import { playerEligibility, eligibilityErrorMessage, type PlayerEligibility } from '../lib/discipline.ts';
import { disciplineForMatch } from '../ui/admin.ts';
import {
  getTeamByDelegateCode,
  listSubmissionsForMatch,
  matchesForTeam,
  pendingSubmission,
  submissionEvents,
  submissionsForTeam,
} from '../lib/submissions.ts';
import * as view from '../ui/delegate.ts';

type DelegateEnv = { Bindings: Env; Variables: { team: Team } };

export const delegateRoutes = new Hono<DelegateEnv>();

function redirect(url: string, msg?: string, err?: string): string {
  const params: string[] = [];
  if (msg) params.push('msg=' + encodeURIComponent(msg));
  if (err) params.push('err=' + encodeURIComponent(err));
  return params.length ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}` : url;
}

/* ---------- Middleware de sesión ---------- */

delegateRoutes.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/delegado/login' || path === '/delegado/logout') return next();

  const secret = sessionSecret(c.env);
  const session = await verifyDelegateToken(getDelegateCookie(c.req.raw), secret);
  if (!session) return c.redirect(redirect('/delegado/login', undefined, 'Ingresá con el código de tu equipo'));

  const team = await getTeam(c.env.DB, session.teamId);
  const currentHash = team?.delegate_code ? (await hashPassword(team.delegate_code)).slice(0, 16) : '';
  if (!team || !team.delegate_enabled || !team.delegate_code || currentHash !== session.codeHash) {
    c.header('Set-Cookie', clearDelegateCookieHeader());
    return c.redirect(redirect('/delegado/login', undefined, 'Tu código de acceso cambió. Volvé a ingresar.'));
  }

  c.set('team', team);
  await next();
});

/* ---------- Login ---------- */

delegateRoutes.get('/login', (c) =>
  c.html(
    view.delegateLoginPage({
      error: c.req.query('err') ?? undefined,
      code: c.req.query('code') ?? undefined,
      next: c.req.query('next') ?? undefined,
    })
  )
);

delegateRoutes.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const code = normalizeCode(String(form['code'] ?? ''));
  const next = String(form['next'] ?? '/delegado');
  if (code.length < 4) {
    return c.html(view.delegateLoginPage({ error: 'Escribí el código completo', code }), 401);
  }
  const team = await getTeamByDelegateCode(c.env.DB, code);
  if (!team || !team.delegate_code) {
    return c.html(view.delegateLoginPage({ error: 'Código incorrecto o sin habilitar', code }), 401);
  }
  const token = await createDelegateToken(sessionSecret(c.env), team.id, await hashPassword(team.delegate_code));
  c.header('Set-Cookie', delegateCookieHeader(token));
  return c.redirect(next.startsWith('/delegado') ? next : '/delegado');
});

delegateRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearDelegateCookieHeader());
  return c.redirect('/delegado/login');
});

/* ---------- Home ---------- */

delegateRoutes.get('/', async (c) => {
  const team = c.get('team');
  const [matches, submissions, teams] = await Promise.all([
    matchesForTeam(c.env.DB, team.id),
    submissionsForTeam(c.env.DB, team.id),
    listTeams(c.env.DB, true),
  ]);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  return c.html(
    view.delegateHomePage({
      team,
      matches,
      submissions,
      teamMap,
      msg: c.req.query('msg'),
      err: c.req.query('err'),
    })
  );
});

/* ---------- Cargar resultado de un partido ---------- */

async function loadOwnMatch(
  c: Context<DelegateEnv>
): Promise<{ team: Team; match: Match } | { error: string }> {
  const team = c.get('team');
  const match = await getMatch(c.env.DB, Number(c.req.param('id')));
  if (!match) return { error: 'Ese partido no existe' };
  if (!canSubmitFor(match, team.id)) return { error: 'Ese partido no es de tu equipo' };
  return { team, match };
}

delegateRoutes.get('/partido/:id', async (c) => {
  const loaded = await loadOwnMatch(c);
  if ('error' in loaded) return c.redirect(redirect('/delegado', undefined, loaded.error));

  const { team, match } = loaded;
  const [teams, roster, subs, discipline] = await Promise.all([
    listTeams(c.env.DB, true),
    listPlayers(c.env.DB, team.id, true),
    listSubmissionsForMatch(c.env.DB, match.id),
    disciplineForMatch(c.env.DB, match),
  ]);
  // Elegibilidad por jugador para ESTE partido (suspendido = no elegible).
  const suspendedPlayers = new Map<number, PlayerEligibility>();
  if (discipline) {
    for (const p of roster) {
      const el = playerEligibility(discipline, p.id);
      if (!el.eligible) suspendedPlayers.set(p.id, el);
    }
  }
  const teamDiscipline = discipline
    ? discipline.active.filter((e) => e.scope === 'team' && e.teamId === team.id).map((e) => e.reason)
    : [];
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const mine = subs.filter((s) => s.team_id === team.id);
  const pending = mine.find((s) => s.review === 'pending') ?? null;
  const events = pending ? await submissionEvents(c.env.DB, pending.id) : [];
  const lastReviewed = mine.find((s) => s.review !== 'pending') ?? null;

  return c.html(
    view.delegateMatchPage({
      team,
      match,
      teamMap,
      roster,
      suspendedPlayers,
      teamDisciplineReasons: teamDiscipline,
      pending: pending ? { submission: pending, events } : null,
      lastReviewed,
      msg: c.req.query('msg'),
      err: c.req.query('err'),
    })
  );
});

delegateRoutes.post('/partido/:id', async (c) => {
  const loaded = await loadOwnMatch(c);
  if ('error' in loaded) return c.redirect(redirect('/delegado', undefined, loaded.error));
  const { team, match } = loaded;

  const form = await c.req.parseBody();
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
  const parsed = parseSubmission(fd);
  if (!parsed.ok) {
    return c.redirect(redirect(`/delegado/partido/${match.id}`, undefined, parsed.error));
  }

  const existing = await pendingSubmission(c.env.DB, match.id, team.id);
  const v = parsed.value;
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE submissions SET status = ?1, home_goals = ?2, away_goals = ?3, notes = ?4, updated_at = datetime('now') WHERE id = ?5"
    )
      .bind(v.status, v.homeGoals, v.awayGoals, v.notes, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO submissions (match_id, team_id, status, home_goals, away_goals, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
      .bind(match.id, team.id, v.status, v.homeGoals, v.awayGoals, v.notes)
      .run();
  }
  return c.redirect(redirect(`/delegado/partido/${match.id}`, 'Resultado enviado. El administrador lo va a revisar.'));
});

delegateRoutes.post('/partido/:id/evento', async (c) => {
  const loaded = await loadOwnMatch(c);
  if ('error' in loaded) return c.redirect(redirect('/delegado', undefined, loaded.error));
  const { team, match } = loaded;

  const pending = await pendingSubmission(c.env.DB, match.id, team.id);
  if (!pending) {
    return c.redirect(redirect(`/delegado/partido/${match.id}`, undefined, 'Primero guardá el resultado, después los eventos'));
  }

  const roster = await listPlayers(c.env.DB, team.id, true);
  // Un jugador dado de baja no genera eventos nuevos (el servidor no lo deja,
  // aunque el formulario se cuelgue). Los que ya están en la entrega se conservan.
  const allowed = new Set(roster.filter((p) => p.active === 1).map((p) => p.id));
  const existing = await submissionEvents(c.env.DB, pending.id);
  if (existing.length >= maxEvents()) {
    return c.redirect(redirect(`/delegado/partido/${match.id}`, undefined, `Máximo ${maxEvents()} eventos por partido`));
  }

  const form = await c.req.parseBody();
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
  const parsed = parseEvent(fd, allowed);
  if (!parsed.ok) {
    return c.redirect(redirect(`/delegado/partido/${match.id}`, undefined, parsed.error));
  }

  // Guardia de elegibilidad: bloqueo duro con motivo y origen visibles.
  const discipline = await disciplineForMatch(c.env.DB, match);
  if (discipline) {
    const el = playerEligibility(discipline, parsed.value.playerId);
    if (!el.eligible) {
      return c.redirect(redirect(`/delegado/partido/${match.id}`, undefined, eligibilityErrorMessage(el)));
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO submission_events (submission_id, team_id, player_id, type, minute) VALUES (?1, ?2, ?3, ?4, ?5)'
  )
    .bind(pending.id, team.id, parsed.value.playerId, parsed.value.type, parsed.value.minute)
    .run();
  await c.env.DB.prepare("UPDATE submissions SET updated_at = datetime('now') WHERE id = ?1").bind(pending.id).run();
  return c.redirect(redirect(`/delegado/partido/${match.id}`, 'Evento agregado'));
});

delegateRoutes.post('/partido/:id/evento/eliminar', async (c) => {
  const loaded = await loadOwnMatch(c);
  if ('error' in loaded) return c.redirect(redirect('/delegado', undefined, loaded.error));
  const { team, match } = loaded;

  const form = await c.req.parseBody();
  const eventId = Number(form['event_id']);
  const submission = await c.env.DB.prepare(
    "SELECT id FROM submissions WHERE match_id = ?1 AND team_id = ?2 AND review = 'pending'"
  )
    .bind(match.id, team.id)
    .first<{ id: number }>();
  if (submission && Number.isFinite(eventId)) {
    await c.env.DB.prepare('DELETE FROM submission_events WHERE id = ?1 AND submission_id = ?2')
      .bind(eventId, submission.id)
      .run();
  }
  return c.redirect(redirect(`/delegado/partido/${match.id}`, 'Evento eliminado'));
});

delegateRoutes.post('/partido/:id/retirar', async (c) => {
  const loaded = await loadOwnMatch(c);
  if ('error' in loaded) return c.redirect(redirect('/delegado', undefined, loaded.error));
  const { team, match } = loaded;
  await c.env.DB.prepare("DELETE FROM submissions WHERE match_id = ?1 AND team_id = ?2 AND review = 'pending'")
    .bind(match.id, team.id)
    .run();
  return c.redirect(redirect('/delegado', 'Envío cancelado'));
});
