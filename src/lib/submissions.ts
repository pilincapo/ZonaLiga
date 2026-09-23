// Entregas de resultados por parte de los delegados: todo el acceso a datos
// del cluster (submissions, submission_events y las consultas que lo ensamblan
// con partidos, equipos y torneos). Vive separado de queries.ts porque lo usan
// solo los paneles de delegados y la bandeja de aprobación.

import type { Match, Team } from './types.ts';
import type { SubmissionEventRow, SubmissionRow } from './delegates.ts';

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
