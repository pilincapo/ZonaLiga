// Participación equipo ↔ torneo: consultas sobre la tabla tournament_teams.
// El equipo es una identidad global (un club con plantilla y delegado);
// la participación dice qué equipos juegan cada torneo. Solo lectura:
// la escritura (alta/baja de participantes) llegará con el formulario del
// torneo, así que acá no hay inserts ni deletes todavía.

import type { Team } from './types.ts';
import type { ZoneConfig } from './zones.ts';

/* ---------- Núcleo puro (testeado sin base) ---------- */

/** ¿Las dos listas contienen exactamente los mismos ids (sin importar orden ni repetidos)? */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const norm = (xs: readonly number[]) => [...new Set(xs)].sort((x, y) => x - y);
  const [xa, xb] = [norm(a), norm(b)];
  return xa.length === xb.length && xa.every((x, i) => x === xb[i]);
}

/** Par (torneo, equipo) ya deduplicado y ordenado: una fila de tournament_teams. */
export type ParticipationPair = [tournamentId: number, teamId: number];

/** Une las dos fuentes de participaciones (partidos y zonas) sin duplicados. */
export function participationFromPairs(
  fromMatches: ReadonlyArray<ParticipationPair>,
  fromZones: ReadonlyArray<ParticipationPair>
): ParticipationPair[] {
  return [...new Set([...fromMatches, ...fromZones].map((p) => `${p[0]}:${p[1]}`))]
    .map((key) => key.split(':').map(Number) as ParticipationPair)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Espejo en TypeScript del backfill de la migración 0005: misma unión de
 * fuentes, mismo descarte de ids sin equipo. Sirve para predecir y verificar
 * qué filas va a dejar el INSERT OR IGNORE sin tocar la base.
 */
export class BackfillPlanner {
  private constructor(
    private readonly pairs: ParticipationPair[],
    private readonly orphansList: ParticipationPair[]
  ) {}

  /** Arma el plan desde los pares (torneo, equipo) de partidos y de zonas. */
  static fromSources(
    fromMatches: ReadonlyArray<ParticipationPair>,
    fromZones: ReadonlyArray<ParticipationPair>
  ): BackfillPlanner {
    // Set de ids de equipo se inyecta aparte con `withTeamIds`: acá solo se
    // separa lo que llega.
    return new BackfillPlanner(participationFromPairs(fromMatches, fromZones), []);
  }

  /** Declara los ids de equipo que existen; los pares con otro id quedan huérfanos. */
  withTeamIds(existingTeamIds: readonly number[]): BackfillPlanner {
    const alive = new Set(existingTeamIds);
    const keep: ParticipationPair[] = [];
    const gone: ParticipationPair[] = [];
    for (const p of this.pairs) (alive.has(p[1]) ? keep : gone).push(p);
    return new BackfillPlanner(keep, gone);
  }

  /** Filas que deja el backfill. */
  rows(): ParticipationPair[] {
    return this.pairs;
  }

  /** Pares descartados por referenciar equipos inexistentes. */
  orphans(): ParticipationPair[] {
    return this.orphansList;
  }

  /** Cantidad de huérfanos descartados. */
  orphanCount(): number {
    return this.orphansList.length;
  }
}

/* ---------- Consultas ---------- */

/**
 * Pool de fixture de un torneo, con retrocompatibilidad:
 * - Si el torneo tiene participantes registrados, son esos (activos).
 * - Si no tiene ninguno (torneos previos a la tabla de participación),
 *   cae al comportamiento histórico: todos los equipos activos globales.
 * Así la generación de hoy no cambia hasta que la UI cargue participantes.
 */
export async function fixturePoolOfTournament(
  db: D1Database,
  tournamentId: number
): Promise<{ ids: number[]; teams: { id: number; name: string; active: number }[]; fallback: boolean } | null> {
  const parts = await db
    .prepare(
      `SELECT tm.id, tm.name, tm.active
       FROM tournament_teams tt JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1 AND tm.active = 1
       ORDER BY tm.name COLLATE NOCASE`
    )
    .bind(tournamentId)
    .all<{ id: number; name: string; active: number }>();
  const teams = parts.results ?? [];
  if (teams.length > 0) {
    return { ids: teams.map((t) => t.id), teams, fallback: false };
  }
  // Sin participantes registrados: pool histórico (todos los activos globales).
  const legacy = await db
    .prepare('SELECT id, name FROM teams WHERE active = 1 ORDER BY id')
    .all<{ id: number; name: string }>();
  const legacyTeams = (legacy.results ?? []).map((t) => ({ id: t.id, name: t.name, active: 1 }));
  return {
    ids: legacyTeams.map((t) => t.id),
    teams: legacyTeams,
    fallback: true,
  };
}

export async function teamIdsOfTournament(db: D1Database, tournamentId: number): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ?1 ORDER BY team_id')
    .bind(tournamentId)
    .all<{ team_id: number }>();
  return (results ?? []).map((r) => r.team_id);
}

/** Participantes de un torneo con sus datos completos, en el orden de equipos (alfabético). */
export async function participantsOfTournament(db: D1Database, tournamentId: number): Promise<Team[]> {
  const { results } = await db
    .prepare(
      `SELECT tm.* FROM tournament_teams tt
       JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1
       ORDER BY tm.name COLLATE NOCASE`
    )
    .bind(tournamentId)
    .all<Team>();
  return results ?? [];
}

/** Torneos en que participa un equipo, más recientes primero (activo/draft antes que finalizado). */
export async function tournamentsOfTeam(
  db: D1Database,
  teamId: number
): Promise<{ id: number; name: string; slug: string; season: string; status: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, t.season, t.status
       FROM tournament_teams tt
       JOIN tournaments t ON t.id = tt.tournament_id
       WHERE tt.team_id = ?1
       ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 1 END, t.created_at DESC`
    )
    .bind(teamId)
    .all<{ id: number; name: string; slug: string; season: string; status: string }>();
  return results ?? [];
}

/**
 * Participantes de un torneo (activos e inactivos) para selectores y guardias
 * de ajustes. Con retrocompatibilidad: torneo sin filas de participación →
 * todos los equipos (incluidos inactivos), igual que el comportamiento previo.
 */
export async function participantsOrAllTeams(
  db: D1Database,
  tournamentId: number
): Promise<{ teams: Team[]; fallback: boolean }> {
  const parts = await db
    .prepare(
      `SELECT tm.* FROM tournament_teams tt
       JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1
       ORDER BY tm.name COLLATE NOCASE`
    )
    .bind(tournamentId)
    .all<Team>();
  const teams = parts.results ?? [];
  if (teams.length > 0) return { teams, fallback: false };
  const all = await db.prepare('SELECT * FROM teams ORDER BY name COLLATE NOCASE').all<Team>();
  return { teams: all.results ?? [], fallback: true };
}

/**
 * Participantes sin zona asignada en un torneo con zonas activas. Solo
 * DETECCIÓN: no inventa zona ni quita la participación. Vacío si las zonas
 * están apagadas (torneo de círculo global: no aplica).
 */
export function participantsWithoutZone(
  participantIds: readonly number[],
  zones: ZoneConfig
): number[] {
  if (!zones.enabled) return [];
  const zoned = new Set(zones.zones.flatMap((z) => z.teamIds));
  return [...new Set(participantIds)].filter((id) => !zoned.has(id)).sort((a, b) => a - b);
}

/* ---------- Escritura (formulario del torneo) ---------- */

/** Marca "participa" del formulario: participate_<teamId> presente = marcado. */
export function participatingIdsFromForm(form: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const [key, value] of Object.entries(form)) {
    const m = /^participate_(\d+)$/.exec(key);
    if (!m) continue;
    const on = value === 'on' || value === '1' || value === 'true';
    if (!on) continue;
    const id = Number(m[1]);
    if (Number.isInteger(id) && id > 0) out.push(id);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Equipos con zona asignada en el formulario (zone_of_<id> con valor): con
 * zonas activas participan sí o sí, aunque su casilla "Participa" venga
 * desmarcada. Así la zona elegida se conserva aunque la casilla esté apagada.
 */
export function zonedTeamIdsFromForm(form: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const [key, value] of Object.entries(form)) {
    const m = /^zone_of_(\d+)$/.exec(key);
    if (!m) continue;
    // Solo índices de zona válidos (1..8): vacío o "0" = sin zona.
    if (!/^[1-9][0-9]*$/.test(String(value ?? '').trim())) continue;
    const id = Number(m[1]);
    if (Number.isInteger(id) && id > 0) out.push(id);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Reemplaza las participaciones de un torneo por la lista dada: borra las
 * anteriores e inserta una fila por equipo (sin duplicados: la PK compuesta
 * lo garantiza). El DELETE y los INSERT van en UN batch: si algo falla, se
 * descarta todo y no quedan participaciones a medias.
 */
export async function replaceTournamentParticipation(
  db: D1Database,
  tournamentId: number,
  teamIds: readonly number[]
): Promise<number> {
  const unique = [...new Set(teamIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ?1').bind(tournamentId),
  ];
  for (const id of unique) {
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO tournament_teams (tournament_id, team_id) VALUES (?1, ?2)').bind(tournamentId, id)
    );
  }
  await db.batch(stmts);
  return unique.length;
}
