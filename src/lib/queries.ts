// Helpers de consultas D1 (todas preparadas para binding de parámetros).

import { parseRules } from './types.ts';
import type { Event, EventType, Match, Player, Rules, Team, Tournament } from './types.ts';
import type { SubmissionEventRow, SubmissionRow } from './delegates.ts';

export async function listTournaments(db: D1Database): Promise<Tournament[]> {
  const { results } = await db
    .prepare('SELECT * FROM tournaments ORDER BY CASE status WHEN \'active\' THEN 0 WHEN \'draft\' THEN 1 ELSE 1 END, created_at DESC')
    .all<Tournament>();
  return results ?? [];
}

/** Cantidad de equipos y partidos por torneo (una sola consulta). */
export async function tournamentStats(db: D1Database): Promise<Map<number, { teams: number; matches: number }>> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id,
        (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) AS matches,
        (SELECT COUNT(*) FROM (
            SELECT home_team_id AS team_id FROM matches WHERE tournament_id = t.id AND home_team_id IS NOT NULL
            UNION
            SELECT away_team_id FROM matches WHERE tournament_id = t.id AND away_team_id IS NOT NULL
         )) AS teams
       FROM tournaments t`
    )
    .all<{ id: number; teams: number; matches: number }>();
  const map = new Map<number, { teams: number; matches: number }>();
  for (const r of results ?? []) map.set(r.id, { teams: r.teams ?? 0, matches: r.matches ?? 0 });
  return map;
}

/** Equipos activos que coinciden con el texto buscado. */
export async function searchTeams(db: D1Database, q: string, limit = 12): Promise<Team[]> {
  const like = `%${q}%`;
  const { results } = await db
    .prepare('SELECT * FROM teams WHERE active = 1 AND (name LIKE ?1 OR short_name LIKE ?1) ORDER BY name COLLATE NOCASE LIMIT ?2')
    .bind(like, limit)
    .all<Team>();
  return results ?? [];
}

/** Jugadores activos que coinciden, con el nombre del equipo. */
export async function searchPlayers(
  db: D1Database,
  q: string,
  limit = 20
): Promise<{ id: number; name: string; number: number | null; team_id: number; team_name: string; team_slug: string }[]> {
  const like = `%${q}%`;
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.number, p.team_id, tm.name AS team_name, tm.slug AS team_slug
       FROM players p JOIN teams tm ON tm.id = p.team_id
       WHERE p.active = 1 AND tm.active = 1 AND p.name LIKE ?1
       ORDER BY p.name COLLATE NOCASE LIMIT ?2`
    )
    .bind(like, limit)
    .all<{ id: number; name: string; number: number | null; team_id: number; team_name: string; team_slug: string }>();
  return results ?? [];
}

/** Torneos que coinciden con el texto buscado. */
export async function searchTournaments(db: D1Database, q: string, limit = 8): Promise<Tournament[]> {
  const like = `%${q}%`;
  const { results } = await db
    .prepare('SELECT * FROM tournaments WHERE name LIKE ?1 OR season LIKE ?1 ORDER BY created_at DESC LIMIT ?2')
    .bind(like, limit)
    .all<Tournament>();
  return results ?? [];
}

export async function getTournamentBySlug(db: D1Database, slug: string): Promise<Tournament | null> {
  return (
    (await db
      .prepare('SELECT * FROM tournaments WHERE slug = ?1')
      .bind(slug)
      .first<Tournament>()) ?? null
  );
}

export async function listTeams(db: D1Database, includeInactive = false): Promise<Team[]> {
  const sql = includeInactive
    ? 'SELECT * FROM teams ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM teams WHERE active = 1 ORDER BY name COLLATE NOCASE';
  const { results } = await db.prepare(sql).all<Team>();
  return results ?? [];
}

export async function getTeamBySlug(db: D1Database, slug: string): Promise<Team | null> {
  return (await db.prepare('SELECT * FROM teams WHERE slug = ?1').bind(slug).first<Team>()) ?? null;
}

export async function getTeam(db: D1Database, id: number): Promise<Team | null> {
  return (await db.prepare('SELECT * FROM teams WHERE id = ?1').bind(id).first<Team>()) ?? null;
}

export async function listPlayers(db: D1Database, teamId: number, includeInactive = false): Promise<Player[]> {
  const sql = includeInactive
    ? 'SELECT * FROM players WHERE team_id = ?1 ORDER BY name COLLATE NOCASE'
    : 'SELECT * FROM players WHERE team_id = ?1 AND active = 1 ORDER BY name COLLATE NOCASE';
  const { results } = await db.prepare(sql).bind(teamId).all<Player>();
  return results ?? [];
}

export async function getPlayer(db: D1Database, id: number): Promise<Player | null> {
  return (await db.prepare('SELECT * FROM players WHERE id = ?1').bind(id).first<Player>()) ?? null;
}

export async function listMatches(db: D1Database, tournamentId: number): Promise<Match[]> {
  const { results } = await db
    .prepare('SELECT * FROM matches WHERE tournament_id = ?1 ORDER BY COALESCE(round, 999), id')
    .bind(tournamentId)
    .all<Match>();
  return results ?? [];
}

export async function getMatch(db: D1Database, id: number): Promise<Match | null> {
  return (await db.prepare('SELECT * FROM matches WHERE id = ?1').bind(id).first<Match>()) ?? null;
}

export async function listEvents(db: D1Database, matchId: number): Promise<Event[]> {
  const { results } = await db
    .prepare('SELECT * FROM events WHERE match_id = ?1 ORDER BY minute IS NULL, minute, id')
    .bind(matchId)
    .all<Event>();
  return results ?? [];
}

export interface ScorersRow {
  player_id: number;
  player_name: string;
  number: number | null;
  position: string;
  team_id: number;
  team_name: string;
  goals: number;
}

export async function topScorers(db: D1Database, tournamentId: number, limit = 25): Promise<ScorersRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pl.id AS player_id, pl.name AS player_name, pl.number, pl.position,
              t.id AS team_id, t.name AS team_name,
              COUNT(*) AS goals
       FROM events e
       JOIN matches m ON m.id = e.match_id
       JOIN players pl ON pl.id = e.player_id
       JOIN teams t ON t.id = pl.team_id
       WHERE m.tournament_id = ?1 AND e.type = 'goal'
       GROUP BY pl.id
       ORDER BY goals DESC, pl.name COLLATE NOCASE
       LIMIT ?2`
    )
    .bind(tournamentId, limit)
    .all<ScorersRow>();
  return results ?? [];
}

export interface CardsRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  yellows: number;
  reds: number;
}

export async function topCards(db: D1Database, tournamentId: number, limit = 25): Promise<CardsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pl.id AS player_id, pl.name AS player_name,
              t.id AS team_id, t.name AS team_name,
              SUM(CASE WHEN e.type = 'yellow' THEN 1 ELSE 0 END) AS yellows,
              SUM(CASE WHEN e.type = 'red' THEN 1 ELSE 0 END) AS reds
       FROM events e
       JOIN matches m ON m.id = e.match_id
       JOIN players pl ON pl.id = e.player_id
       JOIN teams t ON t.id = pl.team_id
       WHERE m.tournament_id = ?1
       GROUP BY pl.id
       HAVING yellows > 0 OR reds > 0
       ORDER BY reds DESC, yellows DESC, pl.name COLLATE NOCASE
       LIMIT ?2`
    )
    .bind(tournamentId, limit)
    .all<CardsRow>();
  return results ?? [];
}

export interface PlayerTournamentStats {
  goals: number;
  ownGoals: number;
  yellows: number;
  reds: number;
  playedMatches: number;
}

export async function playerTournamentStats(db: D1Database, playerId: number, tournamentId: number): Promise<PlayerTournamentStats> {
  const played = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM events e
       JOIN matches m ON m.id = e.match_id
       WHERE e.player_id = ?1 AND m.tournament_id = ?2
         AND e.type IN ('goal','own_goal','yellow','red')`
    )
    .bind(playerId, tournamentId)
    .first<{ n: number }>();
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN e.type = 'goal' THEN 1 ELSE 0 END) AS goals,
         SUM(CASE WHEN e.type = 'own_goal' THEN 1 ELSE 0 END) AS ownGoals,
         SUM(CASE WHEN e.type = 'yellow' THEN 1 ELSE 0 END) AS yellows,
         SUM(CASE WHEN e.type = 'red' THEN 1 ELSE 0 END) AS reds
       FROM events e
       JOIN matches m ON m.id = e.match_id
       WHERE e.player_id = ?1 AND m.tournament_id = ?2`
    )
    .bind(playerId, tournamentId)
    .first<{ goals: number; ownGoals: number; yellows: number; reds: number }>();
  return {
    goals: row?.goals ?? 0,
    ownGoals: row?.ownGoals ?? 0,
    yellows: row?.yellows ?? 0,
    reds: row?.reds ?? 0,
    playedMatches: played?.n ?? 0,
  };
}

/** Torneo activo (o el más reciente si no hay activo). */
export async function activeTournament(db: D1Database): Promise<Tournament | null> {
  const active = await db
    .prepare("SELECT * FROM tournaments WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
    .first<Tournament>();
  if (active) return active;
  const latest = await db
    .prepare('SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 1')
    .first<Tournament>();
  return latest ?? null;
}

/** Todos los eventos de un torneo (para suspensiones). */
/** Todos los eventos (goles incluidos) de un conjunto de partidos. */
export async function eventsForMatches(db: D1Database, matchIds: number[]): Promise<Event[]> {
  if (matchIds.length === 0) return [];
  const placeholders = matchIds.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM events WHERE match_id IN (${placeholders}) ORDER BY minute IS NULL, minute, id`)
    .bind(...matchIds)
    .all<Event>();
  return results ?? [];
}

/** Tarjetas del torneo (usado por suspensiones). */
export async function tournamentEvents(db: D1Database, tournamentId: number): Promise<(Event & { team_id: number | null })[]> {
  const { results } = await db
    .prepare(
      `SELECT e.* FROM events e
       JOIN matches m ON m.id = e.match_id
       WHERE m.tournament_id = ?1 AND e.type IN ('yellow','red')`
    )
    .bind(tournamentId)
    .all<Event>();
  return results ?? [];
}

export function rulesOf(t: Tournament): Rules {
  return parseRules(t.config);
}

/* ---------- Delegados y entregas ---------- */

/** Busca el equipo por su código de acceso (solo si el delegado está habilitado). */
export async function getTeamByDelegateCode(db: D1Database, code: string): Promise<Team | null> {
  return (
    (await db
      .prepare('SELECT * FROM teams WHERE delegate_code = ?1 AND delegate_enabled = 1')
      .bind(code)
      .first<Team>()) ?? null
  );
}

export async function getSubmission(db: D1Database, id: number): Promise<SubmissionRow | null> {
  return (
    (await db.prepare('SELECT * FROM submissions WHERE id = ?1').bind(id).first<SubmissionRow>()) ?? null
  );
}

/** Entrega pendiente de un equipo para un partido (si existe). */
export async function pendingSubmission(
  db: D1Database,
  matchId: number,
  teamId: number
): Promise<SubmissionRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM submissions WHERE match_id = ?1 AND team_id = ?2 AND review = 'pending' ORDER BY id DESC LIMIT 1")
      .bind(matchId, teamId)
      .first<SubmissionRow>()) ?? null
  );
}

export async function listSubmissionsForMatch(db: D1Database, matchId: number): Promise<SubmissionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM submissions WHERE match_id = ?1 ORDER BY id DESC')
    .bind(matchId)
    .all<SubmissionRow>();
  return results ?? [];
}

export async function submissionEvents(db: D1Database, submissionId: number): Promise<SubmissionEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT se.* FROM submission_events se
       WHERE se.submission_id = ?1
       ORDER BY se.minute IS NULL, se.minute, se.id`
    )
    .bind(submissionId)
    .all<SubmissionEventRow>();
  return results ?? [];
}

export interface MatchWithTournament extends Match {
  tournament_name: string;
  tournament_slug: string;
}

/** Partidos de un equipo (para el panel del delegado). */
export async function matchesForTeam(db: D1Database, teamId: number): Promise<MatchWithTournament[]> {
  const { results } = await db
    .prepare(
      `SELECT m.*, t.name AS tournament_name, t.slug AS tournament_slug
       FROM matches m JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.home_team_id = ?1 OR m.away_team_id = ?1
       ORDER BY CASE WHEN m.played_on = '' THEN 1 ELSE 0 END, m.played_on DESC, m.id DESC`
    )
    .bind(teamId)
    .all<MatchWithTournament>();
  return results ?? [];
}

export interface OwnSubmission extends SubmissionRow {
  round: number | null;
  played_on: string;
  venue: string;
  home_team_id: number | null;
  away_team_id: number | null;
  match_status: string;
  match_home_goals: number;
  match_away_goals: number;
  tournament_name: string;
}

/** Entregas de un equipo (para el panel del delegado). */
export async function submissionsForTeam(db: D1Database, teamId: number, limit = 30): Promise<OwnSubmission[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, m.round, m.played_on, m.venue, m.home_team_id, m.away_team_id,
              m.status AS match_status, m.home_goals AS match_home_goals, m.away_goals AS match_away_goals,
              t.name AS tournament_name
       FROM submissions s
       JOIN matches m ON m.id = s.match_id
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE s.team_id = ?1
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT ?2`
    )
    .bind(teamId, limit)
    .all<OwnSubmission>();
  return results ?? [];
}

export interface PendingSubmissionRow extends SubmissionRow {
  round: number | null;
  played_on: string;
  kickoff_time: string;
  venue: string;
  home_team_id: number | null;
  away_team_id: number | null;
  match_status: string;
  match_home_goals: number;
  match_away_goals: number;
  team_name: string;
  team_short: string;
  team_color: string;
  delegate_name: string;
  tournament_name: string;
  tournament_slug: string;
}

/** Bandeja del admin: todas las entregas pendientes, más nuevas primero. */
export async function pendingSubmissions(db: D1Database, limit = 60): Promise<PendingSubmissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, m.round, m.played_on, m.kickoff_time, m.venue, m.home_team_id, m.away_team_id,
              m.status AS match_status, m.home_goals AS match_home_goals, m.away_goals AS match_away_goals,
              tm.name AS team_name, tm.short_name AS team_short, tm.color AS team_color, tm.delegate_name,
              t.name AS tournament_name, t.slug AS tournament_slug
       FROM submissions s
       JOIN matches m ON m.id = s.match_id
       JOIN teams tm ON tm.id = s.team_id
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE s.review = 'pending'
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT ?1`
    )
    .bind(limit)
    .all<PendingSubmissionRow>();
  return results ?? [];
}

export async function countPendingSubmissions(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM submissions WHERE review = 'pending'")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Partidos que tienen alguna entrega pendiente (para marcar la lista de planillas). */
/** Entregas pendientes de un torneo (para el modo en vivo). */
export async function pendingForTournament(db: D1Database, tournamentId: number): Promise<PendingSubmissionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, m.round, m.played_on, m.kickoff_time, m.venue, m.home_team_id, m.away_team_id,
              m.status AS match_status, m.home_goals AS match_home_goals, m.away_goals AS match_away_goals,
              tm.name AS team_name, tm.short_name AS team_short, tm.color AS team_color, tm.delegate_name,
              t.name AS tournament_name, t.slug AS tournament_slug
       FROM submissions s
       JOIN matches m ON m.id = s.match_id
       JOIN teams tm ON tm.id = s.team_id
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE s.review = 'pending' AND m.tournament_id = ?1
       ORDER BY s.updated_at DESC, s.id DESC`
    )
    .bind(tournamentId)
    .all<PendingSubmissionRow>();
  return results ?? [];
}

export async function matchIdsWithPendingSubmissions(db: D1Database): Promise<Set<number>> {
  const { results } = await db
    .prepare("SELECT DISTINCT match_id FROM submissions WHERE review = 'pending'")
    .all<{ match_id: number }>();
  return new Set((results ?? []).map((r) => r.match_id));
}
