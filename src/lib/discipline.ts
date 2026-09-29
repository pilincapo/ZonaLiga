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
