// Ajustes manuales de puntos: penalizaciones y correcciones con motivo.
// Acceso a datos D1 + validación. La lógica de aplicación a la tabla vive en
// standings.ts (PointAdjustment); aquí solo se persisten y listan.

export interface AdjustmentRow {
  id: number;
  tournament_id: number;
  team_id: number;
  team_name: string;
  delta: number;
  reason: string;
  created_at: string;
}

export const MAX_REASON_LENGTH = 200;

export interface ParseAdjustmentResult {
  ok: boolean;
  value?: { teamId: number; delta: number; reason: string };
  error?: string;
}

/** Valida el form de ajuste: delta entero distinto de cero y motivo obligatorio. */
export function parseAdjustment(form: Record<string, unknown>): ParseAdjustmentResult {
  const teamId = Math.round(Number(form['team_id']));
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, error: 'Elegí un equipo' };
  }
  const delta = Math.round(Number(form['delta']));
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: 'La cantidad de puntos tiene que ser un número distinto de cero' };
  }
  if (Math.abs(delta) > 100) {
    return { ok: false, error: 'El ajuste no puede superar los 100 puntos' };
  }
  const reason = String(form['reason'] ?? '').trim().slice(0, MAX_REASON_LENGTH);
  if (!reason) {
    return { ok: false, error: 'Documentá el motivo del ajuste' };
  }
  return { ok: true, value: { teamId, delta, reason } };
}

export async function adjustmentsForTournament(db: D1Database, tournamentId: number): Promise<AdjustmentRow[]> {
  const { results } = await db
    .prepare(
      `SELECT pa.id, pa.tournament_id, pa.team_id, tm.name AS team_name,
              pa.delta, pa.reason, pa.created_at
       FROM point_adjustments pa JOIN teams tm ON tm.id = pa.team_id
       WHERE pa.tournament_id = ?1
       ORDER BY pa.created_at DESC, pa.id DESC`
    )
    .bind(tournamentId)
    .all<AdjustmentRow>();
  return results ?? [];
}

export async function insertAdjustment(
  db: D1Database,
  tournamentId: number,
  value: { teamId: number; delta: number; reason: string }
): Promise<void> {
  await db
    .prepare('INSERT INTO point_adjustments (tournament_id, team_id, delta, reason) VALUES (?1, ?2, ?3, ?4)')
    .bind(tournamentId, value.teamId, value.delta, value.reason)
    .run();
}

export async function deleteAdjustment(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM point_adjustments WHERE id = ?1').bind(id).run();
}
