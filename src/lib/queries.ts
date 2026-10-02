// Helpers de consultas D1 (todas preparadas para binding de parámetros).

import type { Event, EventType, Match, Player, Rules, Team, Tournament } from './types.ts';
import type { RescheduleRecord } from './reschedule.ts';
import type { TeamUsage } from './roster.ts';

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
export async function getTournament(db: D1Database, id: number): Promise<Tournament | null> {
  return (await db.prepare('SELECT * FROM tournaments WHERE id = ?1').bind(id).first<Tournament>()) ?? null;
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

/**
 * Varios jugadores en UNA consulta. Antes, la ficha de un partido hacía una
 * consulta por evento para buscar el nombre de cada autor: con 12 eventos eran
 * 12 viajes de ida y vuelta a la base. Acá es una sola.
 */
export async function playersByIds(db: D1Database, ids: readonly number[]): Promise<Map<number, Player>> {
  const unicos = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  const out = new Map<number, Player>();
  if (unicos.length === 0) return out;
  const ph = unicos.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM players WHERE id IN (${ph})`)
    .bind(...unicos)
    .all<Player>();
  for (const p of results ?? []) out.set(p.id, p);
  return out;
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

/** Tarjetas por evento (equipo + tipo) para la tabla de fair play. */
export interface TeamCardRow {
  team_id: number;
  type: string;
}

export async function teamCards(db: D1Database, tournamentId: number): Promise<TeamCardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pl.team_id, e.type
       FROM events e
       JOIN matches m ON m.id = e.match_id
       JOIN players pl ON pl.id = e.player_id
       WHERE m.tournament_id = ?1 AND e.type IN ('yellow', 'red')`
    )
    .bind(tournamentId)
    .all<TeamCardRow>();
  return results ?? [];
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

/** Agregación de eventos de un jugador (compartida por las dos variantes de stats). */
const PLAYER_AGG = `SUM(CASE WHEN e.type = 'goal' THEN 1 ELSE 0 END) AS goals,
   SUM(CASE WHEN e.type = 'own_goal' THEN 1 ELSE 0 END) AS ownGoals,
   SUM(CASE WHEN e.type = 'yellow' THEN 1 ELSE 0 END) AS yellows,
   SUM(CASE WHEN e.type = 'red' THEN 1 ELSE 0 END) AS reds`;

function zeroStats(playedMatches = 0): PlayerTournamentStats {
  return { goals: 0, ownGoals: 0, yellows: 0, reds: 0, playedMatches };
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
      `SELECT ${PLAYER_AGG}
       FROM events e
       JOIN matches m ON m.id = e.match_id
       WHERE e.player_id = ?1 AND m.tournament_id = ?2`
    )
    .bind(playerId, tournamentId)
    .first<{ goals: number | null; ownGoals: number | null; yellows: number | null; reds: number | null }>();
  if (!row || (row.goals == null && row.ownGoals == null && row.yellows == null && row.reds == null)) {
    return zeroStats(played?.n ?? 0);
  }
  return {
    goals: row.goals ?? 0,
    ownGoals: row.ownGoals ?? 0,
    yellows: row.yellows ?? 0,
    reds: row.reds ?? 0,
    playedMatches: played?.n ?? 0,
  };
}

/** Estadísticas de un jugador en TODOS los torneos de una vez, indexadas por torneo. */
export async function playerStatsAcrossTournaments(db: D1Database, playerId: number): Promise<Map<number, PlayerTournamentStats>> {
  const [rows, playedRows] = await Promise.all([
    db
      .prepare(
        `SELECT m.tournament_id AS tid, ${PLAYER_AGG}
         FROM events e
         JOIN matches m ON m.id = e.match_id
         WHERE e.player_id = ?1
         GROUP BY m.tournament_id`
      )
      .bind(playerId)
      .all<{ tid: number; goals: number | null; ownGoals: number | null; yellows: number | null; reds: number | null }>(),
    db
      .prepare(
        `SELECT m.tournament_id AS tid, COUNT(*) AS n
         FROM events e
         JOIN matches m ON m.id = e.match_id
         WHERE e.player_id = ?1
           AND e.type IN ('goal','own_goal','yellow','red')
         GROUP BY m.tournament_id`
      )
      .bind(playerId)
      .all<{ tid: number; n: number }>(),
  ]);

  const played = new Map<number, number>();
  for (const r of playedRows.results ?? []) played.set(r.tid, r.n ?? 0);

  const map = new Map<number, PlayerTournamentStats>();
  for (const r of rows.results ?? []) {
    map.set(r.tid, {
      goals: r.goals ?? 0,
      ownGoals: r.ownGoals ?? 0,
      yellows: r.yellows ?? 0,
      reds: r.reds ?? 0,
      playedMatches: played.get(r.tid) ?? 0,
    });
  }
  // Torneos donde solo jugó (sin eventos agregados) igual aparecen con playedMatches.
  for (const [tid, n] of played) {
    if (!map.has(tid)) map.set(tid, zeroStats(n));
  }
  return map;
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

/**
 * Fase 16: historial asociado a un jugador, para decidir si se puede borrar.
 * Los eventos son los goles y tarjetas ya cargados (histórico público); las
 * entregas son las propuestas de los delegados que lo mencionan.
 */
export async function playerUsage(
  db: D1Database,
  playerId: number
): Promise<{ events: number; submissions: number }> {
  const [ev, sub] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n FROM events WHERE player_id = ?1')
      .bind(playerId)
      .first<{ n: number }>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM submission_events WHERE player_id = ?1')
      .bind(playerId)
      .first<{ n: number }>(),
  ]);
  return { events: ev?.n ?? 0, submissions: sub?.n ?? 0 };
}

/**
 * Fase 16: qué tiene alrededor un equipo (partidos, plantilla, torneos) para
 * el aviso de eliminación y la tarjeta del panel. Una sola consulta con
 * subselect correlacionados: evita el N+1 de contar por separado.
 */
export async function teamUsage(db: D1Database, teamId: number): Promise<TeamUsage> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM matches WHERE home_team_id = ?1 OR away_team_id = ?1) AS matches,
        (SELECT COUNT(*) FROM matches
          WHERE (home_team_id = ?1 OR away_team_id = ?1)
            AND status IN ('played','walkover')) AS played,
        (SELECT COUNT(*) FROM players WHERE team_id = ?1) AS players,
        (SELECT COUNT(*) FROM tournament_teams WHERE team_id = ?1) AS tournaments`
    )
    .bind(teamId)
    .first<{ matches: number; played: number; players: number; tournaments: number }>();
  return {
    matches: row?.matches ?? 0,
    played: row?.played ?? 0,
    players: row?.players ?? 0,
    tournaments: row?.tournaments ?? 0,
  };
}

/** Fase 16: uso de varios equipos en una sola tanda (listado del panel). */
export async function teamUsageById(db: D1Database): Promise<Map<number, TeamUsage>> {
  const { results } = await db
    .prepare(
      `SELECT t.id AS id,
        (SELECT COUNT(*) FROM matches WHERE home_team_id = t.id OR away_team_id = t.id) AS matches,
        (SELECT COUNT(*) FROM matches
          WHERE (home_team_id = t.id OR away_team_id = t.id)
            AND status IN ('played','walkover')) AS played,
        (SELECT COUNT(*) FROM players WHERE team_id = t.id) AS players,
        (SELECT COUNT(*) FROM tournament_teams WHERE team_id = t.id) AS tournaments
       FROM teams t`
    )
    .all<{ id: number } & TeamUsage>();
  const out = new Map<number, TeamUsage>();
  for (const r of results ?? []) out.set(r.id, { matches: r.matches, played: r.played, players: r.players, tournaments: r.tournaments });
  return out;
}

/**
 * Fase 15: historial de reprogramaciones de los partidos de un torneo,
 * agrupado por partido y del cambio más nuevo al más viejo (mismo orden que
 * usa la planilla). Reutiliza la tabla de la Fase 13; no agrega datos nuevos.
 */
export async function matchRescheduleHistory(
  db: D1Database,
  tournamentId: number
): Promise<Map<number, RescheduleRecord[]>> {
  const { results } = await db
    .prepare(
      `SELECT r.* FROM match_reschedules r
       JOIN matches m ON m.id = r.match_id
       WHERE m.tournament_id = ?1
       ORDER BY r.match_id, r.id DESC`
    )
    .bind(tournamentId)
    .all<RescheduleRecord>();
  const out = new Map<number, RescheduleRecord[]>();
  for (const r of results ?? []) {
    const arr = out.get(r.match_id);
    if (arr) arr.push(r);
    else out.set(r.match_id, [r]);
  }
  return out;
}



/* ---------- Delegados y entregas ---------- */




