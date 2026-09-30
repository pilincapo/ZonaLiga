// Sanciones disciplinarias MANUALES: dominio puro + acceso a datos D1.
//
// Una sanción manual la carga el admin (tribunal/organización) y NO es un
// evento ni una tarjeta: las suspensiones automáticas siguen viniendo de
// computeSuspensions sobre `events` y ese cálculo no se toca acá.
//
// Duraciones:
//   - 'fechas':       amount = cantidad de jornadas cumplibles.
//   - 'dias':         amount = días corridos desde el incidente.
//   - 'hasta_fecha':  until_date = última fecha con sanción (inclusive).
//
// Los predicates puros (parseo, validez y vigencia) se testean sin base;
// el CRUD D1 usa los mismos patrones que adjustments.ts.

/** Tipos de dominio. */

export type SanctionScope = 'player' | 'team';
export type SanctionDuration = 'fechas' | 'dias' | 'hasta_fecha';
export type SanctionStatus = 'activa' | 'cumplida' | 'anulada';

/**
 * Medida disciplinaria (Fase 7B). Para JUGADORES queda null (la medida es
 * siempre la suspensión, modelada por duration_kind). Para EQUIPOS define
 * qué pasa realmente:
 *   - advertencia:         solo deja constancia, sin efecto.
 *   - perdida_puntos:      resta `amount` puntos en la tabla del torneo.
 *   - suspension_fechas:   deja al equipo sin jugar `amount` fechas (aviso
 *                          operativo; el resultado/walkover no cambia aún).
 *   - suspension_dias:     igual, con hasta `until_date` (inclusive).
 *   - expulsion:           inhabilita al equipo en ese torneo.
 */
export type SanctionMeasure =
  | 'advertencia'
  | 'perdida_puntos'
  | 'suspension_fechas'
  | 'suspension_dias'
  | 'expulsion';

export const SANCTION_MEASURES: { value: SanctionMeasure; label: string; hint: string }[] = [
  { value: 'advertencia', label: 'Advertencia', hint: 'Solo deja constancia, sin efecto en la tabla.' },
  { value: 'perdida_puntos', label: 'Pérdida de puntos', hint: 'Resta puntos en la tabla del torneo.' },
  { value: 'suspension_fechas', label: 'Suspensión por fechas', hint: 'Equipo sin jugar por N fechas (aviso operativo).' },
  { value: 'suspension_dias', label: 'Suspensión por días', hint: 'Equipo suspendido hasta una fecha (inclusive).' },
  { value: 'expulsion', label: 'Expulsión del torneo', hint: 'El equipo queda inhabilitado en este torneo.' },
];

export const SANCTION_MEASURE_LABELS: Record<SanctionMeasure, string> = Object.fromEntries(
  SANCTION_MEASURES.map((m) => [m.value, m.label])
) as Record<SanctionMeasure, string>;

export interface Sanction {
  id: number;
  tournament_id: number;
  team_id: number | null;
  player_id: number | null;
  scope: SanctionScope;
  duration_kind: SanctionDuration;
  amount: number | null;
  until_date: string | null;
  incident_date: string;
  category: string;
  description: string;
  notes: string;
  status: SanctionStatus;
  annul_reason: string;
  /** Medida disciplinaria (Fase 7B). NULL = sanción pre-7B (o de jugador). */
  measure: SanctionMeasure | null;
  created_at: string;
  updated_at: string;
}

/** Valores de alta (antes de persistir). */
export interface SanctionValue {
  tournamentId: number;
  teamId: number;
  playerId: number | null;
  scope: SanctionScope;
  durationKind: SanctionDuration;
  amount: number | null;
  untilDate: string | null;
  incidentDate: string;
  category: string;
  description: string;
  notes: string;
  /** Medida disciplinaria (Fase 7B). Para jugador: null. */
  measure: SanctionMeasure | null;
}

/* ---------- Constantes y etiquetas ---------- */

export const SANCTION_SCOPES: { value: SanctionScope; label: string }[] = [
  { value: 'player', label: 'Jugador' },
  { value: 'team', label: 'Equipo' },
];

export const SANCTION_DURATIONS: { value: SanctionDuration; label: string }[] = [
  { value: 'fechas', label: 'Por fechas' },
  { value: 'dias', label: 'Por días' },
  { value: 'hasta_fecha', label: 'Hasta una fecha' },
];

export const SANCTION_STATUS_LABELS: Record<SanctionStatus, string> = {
  activa: 'Activa',
  cumplida: 'Cumplida',
  anulada: 'Anulada',
};

export const MAX_AMOUNT = 100;
export const MAX_TEXT_LENGTH = 300;

/** Fecha YYYY-MM-DD válida (mes/día coherentes). Reutiliza el criterio del proyecto. */
export function isValidIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

/** Suma N días a una fecha ISO (UTC) — misma semántica que schedule.ts. */
export function addDays(isoDate: string, days: number): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.trunc(days));
  return d.toISOString().slice(0, 10);
}

/** Último día con sanción según su duración (inclusive). null = indeterminado. */
export function sanctionEndDate(s: Pick<Sanction, 'duration_kind' | 'amount' | 'until_date' | 'incident_date'>): string | null {
  if (s.duration_kind === 'hasta_fecha') return s.until_date;
  if (s.duration_kind === 'dias' && s.amount != null) return addDays(s.incident_date, s.amount);
  return null; // 'fechas': depende de las jornadas jugadas, no del calendario
}

/* ---------- Parseo y validación del formulario ---------- */

export interface ParseSanctionResult {
  ok: boolean;
  value?: SanctionValue;
  error?: string;
}

/**
 * Valida el form de alta: combinaciones válidas de duración/campos.
 * - fechas y días exigen amount entero entre 1 y MAX_AMOUNT.
 * - hasta_fecha exige until_date ISO válida, mayor o igual al incidente.
 * - scope 'player' exige player_id; 'team' lo rechaza.
 * - incident_date ISO válida y category obligatoria.
 */
export function parseSanction(form: Record<string, unknown>): ParseSanctionResult {
  const tournamentId = Math.round(Number(form['tournament_id']));
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return { ok: false, error: 'Falta el torneo' };
  }

  const scopeRaw = String(form['scope'] ?? 'player');
  if (scopeRaw !== 'player' && scopeRaw !== 'team') {
    return { ok: false, error: 'El afectado tiene que ser jugador o equipo' };
  }

  const teamId = Math.round(Number(form['team_id']));
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, error: 'Elegí el equipo' };
  }

  let playerId: number | null = null;
  if (scopeRaw === 'player') {
    const pid = Math.round(Number(form['player_id']));
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: false, error: 'Elegí el jugador sancionado' };
    }
    playerId = pid;
  } else if (String(form['player_id'] ?? '').trim() !== '') {
    // Sanción de equipo con jugador asociado: combinación ambigua, se rechaza.
    return { ok: false, error: 'Una sanción de equipo no lleva jugador' };
  }

  // Medida disciplinaria (Fase 7B). En equipos define el efecto real; en
  // jugadores queda null y la duración es la de siempre.
  const measureRaw = String(form['measure'] ?? '').trim();
  let measure: SanctionMeasure | null = null;
  if (measureRaw !== '') {
    const valid = SANCTION_MEASURES.some((m) => m.value === measureRaw);
    if (!valid) return { ok: false, error: 'Medida disciplinaria inválida' };
    if (scopeRaw === 'player') {
      return { ok: false, error: 'La medida disciplinaria aplica solo a equipos' };
    }
    measure = measureRaw as SanctionMeasure;
  }

  const durationRaw = String(form['duration_kind'] ?? 'fechas');
  if (durationRaw !== 'fechas' && durationRaw !== 'dias' && durationRaw !== 'hasta_fecha') {
    return { ok: false, error: 'Duración inválida' };
  }

  let amount: number | null = null;
  let untilDate: string | null = null;

  if (measure != null) {
    // EQUIPO: los campos exigidos dependen de la medida, no de duration_kind
    // (que viaja como espejo para compatibilidad con la capa unificada).
    if (measure === 'perdida_puntos' || measure === 'suspension_fechas') {
      const raw = String(form['amount'] ?? '').trim();
      const n = Number(raw);
      if (!raw || !Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) {
        const what = measure === 'perdida_puntos' ? 'los puntos a restar' : 'la cantidad de fechas';
        return { ok: false, error: `Escribí ${what}: un número entre 1 y ${MAX_AMOUNT}` };
      }
      amount = n;
    } else if (measure === 'suspension_dias') {
      const raw = String(form['until_date'] ?? '').trim();
      if (!isValidIsoDate(raw)) {
        return { ok: false, error: 'Elegí la fecha de finalización de la suspensión' };
      }
      untilDate = raw;
    }
    // advertencia y expulsion no llevan campos extra.
  } else if (durationRaw === 'fechas' || durationRaw === 'dias') {
    const raw = String(form['amount'] ?? '').trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) {
      return { ok: false, error: `La cantidad tiene que ser un número entre 1 y ${MAX_AMOUNT}` };
    }
    amount = n;
  } else {
    const raw = String(form['until_date'] ?? '').trim();
    if (!isValidIsoDate(raw)) {
      return { ok: false, error: 'Elegí una fecha límite válida' };
    }
    untilDate = raw;
  }

  const incidentRaw = String(form['incident_date'] ?? '').trim();
  if (!isValidIsoDate(incidentRaw)) {
    return { ok: false, error: 'Elegí la fecha del incidente' };
  }
  // Coherencia temporal: la sanción no puede terminar antes de empezar.
  if (untilDate != null && untilDate < incidentRaw) {
    return { ok: false, error: 'La fecha límite no puede ser anterior al incidente' };
  }

  const category = String(form['category'] ?? '').trim().slice(0, MAX_TEXT_LENGTH);
  if (!category) {
    return { ok: false, error: 'Documentá la categoría/motivo de la sanción' };
  }

  return {
    ok: true,
    value: {
      tournamentId,
      teamId,
      playerId,
      scope: scopeRaw,
      durationKind: durationRaw,
      amount,
      untilDate,
      incidentDate: incidentRaw,
      category,
      description: String(form['description'] ?? '').trim().slice(0, MAX_TEXT_LENGTH),
      notes: String(form['notes'] ?? '').trim().slice(0, MAX_TEXT_LENGTH),
      measure,
    },
  };
}

/** Valida la anulación: el motivo es obligatorio (auditoría). */
export function parseAnnulment(form: Record<string, unknown>): { ok: boolean; reason?: string; error?: string } {
  const reason = String(form['annul_reason'] ?? '').trim().slice(0, MAX_TEXT_LENGTH);
  if (!reason) {
    return { ok: false, error: 'Documentá el motivo de la anulación' };
  }
  return { ok: true, reason };
}

/* ---------- Predicates de vigencia (puros) ---------- */

/**
 * ¿Cubre esta sanción la jornada `round`? Solo aplica a 'fechas': cubre las N
 * jornadas contadas desde la fecha del incidente, que la aporta el llamador
 * (la sanción no guarda round: el incidente puede ser fuera de cancha).
 * El conteo fino de "ya cumplidas" con partidos jugados lo hace el llamador
 * (mismo criterio que servedRounds en computeSuspensions).
 */
export function coversRound(
  s: Pick<Sanction, 'duration_kind' | 'amount'>,
  incidentRound: number,
  round: number
): boolean {
  if (s.duration_kind !== 'fechas' || s.amount == null) return false;
  return round >= incidentRound && round < incidentRound + s.amount;
}

/**
 * ¿Cubre esta sanción el día calendario `today`? Aplica a 'dias' y
 * 'hasta_fecha' (inclusive). 'fechas' no se decide por calendario.
 */
export function coversDate(
  s: Pick<Sanction, 'duration_kind' | 'amount' | 'until_date' | 'incident_date'>,
  today: string
): boolean {
  const end = sanctionEndDate(s);
  if (end == null) return false;
  return today >= s.incident_date && today <= end;
}

/**
 * Estado efectivo de una sanción según la realidad del torneo:
 * anulada manda (nunca se calcula sobre ella); cumplida puede derivarse
 * de la fecha calendario (dias/hasta_fecha) pero NUNCA se inventa para
 * 'fechas' (esa la marca el admin o el conteo de jornadas jugadas).
 */
export function effectiveStatus(
  s: Pick<Sanction, 'status' | 'duration_kind' | 'amount' | 'until_date' | 'incident_date'>,
  today: string
): SanctionStatus {
  if (s.status === 'anulada') return 'anulada';
  if (s.status === 'cumplida') return 'cumplida';
  if (s.duration_kind === 'dias' || s.duration_kind === 'hasta_fecha') {
    const end = sanctionEndDate(s);
    if (end != null && today > end) return 'cumplida';
  }
  return 'activa';
}

/* ---------- Acceso a datos (D1) ---------- */

export async function insertSanction(db: D1Database, v: SanctionValue): Promise<number> {
  // En equipos, duration_kind viaja como espejo de la medida (misma semántica:
  // 'fechas' ↔ suspension_fechas, 'dias'/'hasta_fecha' ↔ suspension_dias);
  // la medida real va en `measure`. Jugadores: measure NULL, duración pura.
  let durationKind = v.durationKind;
  let amount = v.amount;
  let untilDate = v.untilDate;
  if (v.scope === 'team' && v.measure != null) {
    if (v.measure === 'perdida_puntos') durationKind = 'fechas';
    else if (v.measure === 'suspension_fechas') durationKind = 'fechas';
    else if (v.measure === 'suspension_dias') durationKind = 'hasta_fecha';
    else {
      durationKind = 'fechas';
      amount = null;
      untilDate = null;
    }
  }
  const res = await db
    .prepare(
      `INSERT INTO sanctions
        (tournament_id, team_id, player_id, scope, duration_kind, amount, until_date,
         incident_date, category, description, notes, measure)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    )
    .bind(
      v.tournamentId,
      v.teamId,
      v.playerId,
      v.scope,
      durationKind,
      amount,
      untilDate,
      v.incidentDate,
      v.category,
      v.description,
      v.notes,
      v.measure
    )
    .run();
  return Number(res.meta.last_row_id ?? 0);
}

export async function getSanction(db: D1Database, id: number): Promise<Sanction | null> {
  return (await db.prepare('SELECT * FROM sanctions WHERE id = ?1').bind(id).first<Sanction>()) ?? null;
}

export interface SanctionRow extends Sanction {
  team_name: string | null;
  player_name: string | null;
}

/** Sanciones de un torneo, activas primero y más nuevas primero dentro de cada estado. */
export async function sanctionsForTournament(db: D1Database, tournamentId: number): Promise<SanctionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, tm.name AS team_name, p.name AS player_name
       FROM sanctions s
       LEFT JOIN teams tm ON tm.id = s.team_id
       LEFT JOIN players p ON p.id = s.player_id
       WHERE s.tournament_id = ?1
       ORDER BY CASE s.status WHEN 'activa' THEN 0 WHEN 'cumplida' THEN 1 ELSE 2 END,
                s.incident_date DESC, s.id DESC`
    )
    .bind(tournamentId)
    .all<SanctionRow>();
  return results ?? [];
}

/** Sanciones ACTIVAS de un torneo (para habilitación y vistas públicas). */
export async function activeSanctionsForTournament(db: D1Database, tournamentId: number): Promise<Sanction[]> {
  const { results } = await db
    .prepare("SELECT * FROM sanctions WHERE tournament_id = ?1 AND status = 'activa' ORDER BY id")
    .bind(tournamentId)
    .all<Sanction>();
  return results ?? [];
}

/** Marca anulada con motivo obligatorio (ya validado por parseAnnulment). */
export async function annulSanction(db: D1Database, id: number, reason: string): Promise<void> {
  await db
    .prepare("UPDATE sanctions SET status = 'anulada', annul_reason = ?2, updated_at = datetime('now') WHERE id = ?1")
    .bind(id, reason)
    .run();
}
