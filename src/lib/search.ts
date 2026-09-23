// Búsqueda global del sitio (página /buscar): equipos, jugadores y torneos.
// Vive separado de queries.ts porque lo consume únicamente esa página.

import type { Team, Tournament } from './types.ts';

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
