// Disciplina unificada: mezcla las suspensiones AUTOMÁTICAS por tarjetas
// (computeSuspensions sobre `events`, que acá se consume y no se toca) con
// las sanciones MANUALES cargadas por el admin (tabla `sanctions`).
//
// Reglas de la capa:
//   - Cada sanción conserva su ORIGEN ('auto' | 'manual'): nunca se fusionan
//     ni se duplican; si un jugador tiene ambas, aparecen ambas.
//   - Las anuladas quedan fuera de las activas (effectiveStatus ya lo
//     resuelve: la entrada resulta con estado 'anulada' y va al archivo).
//   - Una manual a EQUIPO aparece como disciplina del equipo: no se inventa
//     una suspensión individual de jugador.
//   - Fechas restantes SOLO con dato real: para 'fechas' se cuentan las
//     jornadas aún no jugadas que cubre la sanción; para 'dias' y
//     'hasta_fecha' se usa el calendario. Si no hay datos para calcularlo,
//     queda null (no se inventa).
//
// Dominio puro: todo lo que el llamador necesita entra por parámetro.

import type { Match } from './types.ts';
import type { PlayerSuspension } from './suspensions.ts';
import type { Sanction, SanctionStatus, SanctionScope, SanctionDuration } from './sanctions.ts';
import { effectiveStatus, sanctionEndDate } from './sanctions.ts';

/** Origen de una entrada de disciplina. */
export type DisciplineSource = 'auto' | 'manual';

/** Duración traducida para la salida (ambas fuentes hablan distinto). */
export interface DisciplineDuration {
  kind: 'fechas' | 'dias' | 'hasta_fecha';
  /** Cantidad de fechas o días (fechas/dias). null = no aplica. */
  amount: number | null;
  /** Último día de la sanción (hasta_fecha/dias). null = no aplica. */
  untilDate: string | null;
}

/** Una entrada de disciplina: automática o manual, ya normalizada. */
export interface DisciplineEntry {
  source: DisciplineSource;
  /** Torneo al que pertenece. */
  tournamentId: number;
  /** Afectado: jugador y/o equipo. Las de equipo tienen playerId null. */
  playerId: number | null;
  teamId: number | null;
  scope: SanctionScope;
  /** Motivo legible: de la regla (auto) o de la categoría (manual). */
  reason: string;
  /** Detalle extra (description de la manual; vacío en automáticas). */
  description: string;
  duration: DisciplineDuration;
  /** Estado calculado: las automáticas activas llegan como 'activa'. */
  status: SanctionStatus;
  /** Fecha/jornada de origen: round (auto) o fecha del incidente (manual). */
  originRound: number | null;
  originDate: string | null;
  /**
   * Fechas/días restantes. Solo con dato real:
   *  - auto: fechas ya servidas según partidos jugados posteriores (si el
   *    llamador puede saberlo; si no, null).
   *  - manual 'fechas': jornadas cubiertas todavía sin jugar.
   *  - manual 'dias'/'hasta_fecha': días calendario restantes.
   *  - estado no activa: null.
   */
  remaining: number | null;
  /** Referencia a la fila origen (id de sanción manual; null en automáticas). */
  sanctionId: number | null;
}

/** Opciones de entrada para las manuales. */
export interface ManualInput {
  sanction: Sanction;
  /**
   * Jornada del torneo donde cayó el incidente (para 'fechas'). Si el
   * llamador no la conoce (incidente fuera de cancha), null: la sanción
   * por fechas queda activa pero sin fechas restantes calculables.
   */
  incidentRound: number | null;
  /** Rounds con partidos ya jugados/walkover (para contar cumplimiento). */
  playedRounds: readonly number[];
  /** Fecha de "hoy" para vigencia por calendario. */
  today: string;
}

/** Resultado de la combinación: activas + históricas (cumplidas/anuladas de manual). */
export interface DisciplineResult {
  active: DisciplineEntry[];
  /** Manuales no activas (cumplidas/anuladas), para historial. Las automáticas no se archivan. */
  archive: DisciplineEntry[];
}

/** Rounds ya jugados (dedupe + orden). */
function playedSet(playedRounds: readonly number[]): Set<number> {
  return new Set(playedRounds);
}

/**
 * Fechas restantes de una manual por 'fechas': cuenta cuántas jornadas del
 * rango cubierto siguen sin jugarse. incidentRound null → null (sin inventar).
 */
function remainingRoundsFor(
  amount: number,
  incidentRound: number | null,
  playedRounds: readonly number[]
): number | null {
  if (incidentRound == null) return null;
  const played = playedSet(playedRounds);
  let remaining = 0;
  for (let r = incidentRound; r < incidentRound + amount; r++) {
    if (!played.has(r)) remaining += 1;
  }
  return remaining;
}

/** Días calendario restantes (inclusive respecto de hoy). */
function remainingDaysFor(endDate: string, today: string): number | null {
  const end = new Date(`${endDate}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())) return null;
  const diff = Math.round((end.getTime() - now.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

/** Convierte una sanción manual a entrada de disciplina. */
export function manualToEntry(input: ManualInput): DisciplineEntry {
  const s = input.sanction;
  const status = effectiveStatus(s, input.today);
  const isActive = status === 'activa';

  let remaining: number | null = null;
  if (isActive) {
    if (s.duration_kind === 'fechas') {
      remaining = remainingRoundsFor(s.amount ?? 0, input.incidentRound, input.playedRounds);
    } else {
      const end = sanctionEndDate(s);
      remaining = end != null ? remainingDaysFor(end, input.today) : null;
    }
  }

  return {
    source: 'manual',
    tournamentId: s.tournament_id,
    playerId: s.scope === 'player' ? s.player_id : null,
    teamId: s.team_id,
    scope: s.scope,
    reason: s.category,
    description: s.description,
    duration: {
      kind: s.duration_kind,
      amount: s.duration_kind === 'hasta_fecha' ? null : s.amount,
      untilDate: s.duration_kind === 'hasta_fecha' ? s.until_date : null,
    },
    status,
    originRound: input.incidentRound,
    originDate: s.incident_date,
    remaining,
    sanctionId: s.id,
  };
}

/** Convierte una automática a entrada. `servedRemaining` ya lo calcula el llamador si puede. */
export function autoToEntry(
  s: PlayerSuspension,
  tournamentId: number,
  servedRemaining: number | null = null
): DisciplineEntry {
  return {
    source: 'auto',
    tournamentId,
    playerId: s.playerId,
    teamId: s.teamId,
    scope: 'player',
    reason: s.reason,
    description: '',
    duration: { kind: 'fechas', amount: s.matches, untilDate: null },
    status: 'activa',
    originRound: s.asOfRound,
    originDate: null,
    remaining: servedRemaining,
    sanctionId: null,
  };
}

/**
 * Combina automáticas + manuales en una sola lista, conservando origen y
 * sin fusionar ni duplicar: cada sanción es una entrada independiente.
 * Las manuales anuladas van al archivo (nunca a activas); las cumplidas
 * también, y las automáticas (siempre derivadas) no se archivan.
 */
export function combineDiscipline(
  autos: ReadonlyArray<{ tournamentId: number; suspension: PlayerSuspension; servedRemaining?: number | null }>,
  manuals: readonly ManualInput[]
): DisciplineResult {
  const active: DisciplineEntry[] = [];
  const archive: DisciplineEntry[] = [];

  for (const a of autos) {
    active.push(autoToEntry(a.suspension, a.tournamentId, a.servedRemaining ?? null));
  }
  for (const m of manuals) {
    const entry = manualToEntry(m);
    if (entry.status === 'activa') active.push(entry);
    else archive.push(entry);
  }
  return { active, archive };
}

/**
 * ¿Está sancionado este jugador en la lista ACTIVA? Con entradas combinadas
 * (auto + manual) alcanza con que cualquiera lo nombre. Las de equipo no
 * afectan a un jugador individual: se consultan aparte con teamDisciplined.
 */
export function isPlayerDisciplined(entries: readonly DisciplineEntry[], playerId: number): boolean {
  return entries.some((e) => e.playerId === playerId);
}

/** ¿Tiene este equipo una sanción de equipo activa? (no toca a los jugadores). */
export function isTeamDisciplined(entries: readonly DisciplineEntry[], teamId: number): boolean {
  return entries.some((e) => e.scope === 'team' && e.teamId === teamId);
}

/* ============================== ELEGIBILIDAD ============================== */

/** Motivo de bloqueo de un jugador para un partido, ya formateado. */
export interface EligibilityReason {
  source: DisciplineSource;
  /** Motivo legible (regla para auto, categoría para manual). */
  reason: string;
  /** Fechas/días restantes. null = no se puede calcular (o no aplica). */
  remaining: number | null;
  /**
   * true si el bloqueo probable existe pero no se pudo confirmar con datos
   * reales (p. ej. automática sin jornada conocible). No se inventa nada.
   */
  needsReview: boolean;
}

/** Evaluación de elegibilidad de UN jugador para UN partido. */
export interface PlayerEligibility {
  playerId: number;
  /** true = puede participar; false = suspendido para ese partido. */
  eligible: boolean;
  /** Motivos de bloqueo (uno por sanción que lo afecta; puede haber varios). */
  reasons: EligibilityReason[];
}

/** Datos que el llamador necesita recolectar (todo real, sin inventar). */
export interface EligibilityInput {
  /** Entradas ACTIVAS de combineDiscipline del torneo del partido. */
  active: readonly DisciplineEntry[];
  /** El partido a evaluar. */
  match: Pick<Match, 'id' | 'round' | 'played_on' | 'status' | 'home_team_id' | 'away_team_id'>;
  /** Rounds del torneo con partidos ya jugados/walkover. */
  playedRounds: readonly number[];
  /** Todos los partidos del torneo (para contar servidas de la automática). */
  tournamentMatches: readonly Match[];
}

/**
 * Conteo de automática PARA ESTE PARTIDO: partidos jugados/walkover del
 * equipo de la sanción entre la jornada del incidente y la del partido.
 * Devuelve las fechas aún sin servir (0 = ya la cumplió para acá). Si falta
 * la jornada del incidente o la del partido, null: no se inventa.
 */
function autoRemainingForMatchFromEntry(e: DisciplineEntry, input: EligibilityInput): number | null {
  if (e.originRound == null || input.match.round == null) return null;
  const amount = e.duration.amount ?? 0;
  const served = input.tournamentMatches.filter(
    (m) =>
      (m.status === 'played' || m.status === 'walkover') &&
      (m.home_team_id === e.teamId || m.away_team_id === e.teamId) &&
      m.round != null &&
      m.round > e.originRound! &&
      m.round <= input.match.round!
  ).length;
  return Math.max(0, amount - served);
}

/** Fin de vigencia de una entrada manual por calendario (dias/hasta_fecha). */
function sanctionEndDateFromEntry(e: DisciplineEntry): string | null {
  if (e.duration.kind === 'hasta_fecha') return e.duration.untilDate;
  if (e.duration.kind === 'dias' && e.originDate != null) {
    const d = new Date(`${e.originDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (e.duration.amount ?? 0));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Evaluación pura: ¿puede este jugador participar de este partido?
 * Reutiliza las entradas combinadas (NO recalcula suspensiones ni toca
 * computeSuspensions). Reglas, en orden:
 *   - Las de EQUIPO nunca bloquean a un jugador individual.
 *   - Anuladas y cumplidas no llegan acá: solo entradas ACTIVAS.
 *   - Automática: sigue suspendido mientras no haya servido los partidos
 *     entre su jornada de origen y la del partido. Sin jornada conocible →
 *     bloqueo marcado needsReview (no se inventa el restante).
 *   - Manual por 'fechas': cubre si la jornada del partido cae dentro del
 *     rango contado desde la jornada del incidente. Si alguna de las dos
 *     jornadas no puede determinarse, esta vía no bloquea (no se inventa).
 *   - Manual por 'dias'/'hasta_fecha': calendario contra la FECHA DEL
 *     PARTIDO (límite inclusive). Sin fecha de partido → needsReview.
 *   - Auto y manual nunca se fusionan: cada sanción aporta su motivo.
 */
export function playerEligibility(input: EligibilityInput, playerId: number): PlayerEligibility {
  const reasons: EligibilityReason[] = [];

  for (const e of input.active) {
    if (e.scope === 'team' || e.playerId !== playerId) continue;

    if (e.source === 'auto') {
      const remaining = autoRemainingForMatchFromEntry(e, input);
      if (remaining == null) {
        reasons.push({ source: 'auto', reason: e.reason, remaining: null, needsReview: true });
      } else if (remaining > 0) {
        reasons.push({ source: 'auto', reason: e.reason, remaining, needsReview: false });
      }
      continue;
    }

    if (e.duration.kind === 'fechas') {
      if (e.originRound == null || input.match.round == null) continue; // sin jornadas: no se inventa
      const covered =
        input.match.round >= e.originRound && input.match.round < e.originRound + (e.duration.amount ?? 0);
      if (!covered) continue;
      const alreadyPlayed = input.playedRounds.filter(
        (r) => r >= e.originRound! && r < e.originRound! + (e.duration.amount ?? 0)
      ).length;
      const pending = Math.max(0, (e.duration.amount ?? 0) - alreadyPlayed);
      if (pending > 0) {
        reasons.push({ source: 'manual', reason: e.reason, remaining: pending, needsReview: false });
      }
      continue;
    }

    // 'dias' y 'hasta_fecha': calendario contra la fecha real del partido.
    if (input.match.played_on === '') {
      reasons.push({ source: 'manual', reason: e.reason, remaining: null, needsReview: true });
      continue;
    }
    const endDate = sanctionEndDateFromEntry(e);
    if (
      endDate != null &&
      e.originDate != null &&
      input.match.played_on >= e.originDate &&
      input.match.played_on <= endDate
    ) {
      const remaining = Math.max(
        0,
        Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${input.match.played_on}T00:00:00Z`).getTime()) / 86_400_000)
      );
      reasons.push({ source: 'manual', reason: e.reason, remaining, needsReview: false });
    }
  }

  return { playerId, eligible: reasons.length === 0, reasons };
}

/**
 * ¿Hay ALGÚN motivo firme de bloqueo para este jugador? Las entradas en
 * revisión (datos insuficientes) NO bloquean solas: el llamador decide.
 */
export function hasHardBlock(eligibility: PlayerEligibility): boolean {
  return eligibility.reasons.some((r) => !r.needsReview);
}

/**
 * Mensaje claro de rechazo para un evento de un jugador no elegible:
 * incluye origen, motivo y fechas restantes cuando se puedan calcular.
 */
export function eligibilityErrorMessage(eligibility: PlayerEligibility): string {
  const parts = eligibility.reasons.map((r) => {
    const origen = r.source === 'auto' ? 'suspensión automática' : 'sanción disciplinaria';
    const rest = r.remaining != null ? ` — le quedan ${r.remaining} fecha${r.remaining === 1 ? '' : 's'}` : '';
    const rev = r.needsReview ? ' (caso a revisar: faltan datos del partido)' : '';
    return `${origen}: ${r.reason}${rest}${rev}`;
  });
  return `El jugador está suspendido para este partido (${parts.join(' | ')}). El evento no se guardó.`;
}