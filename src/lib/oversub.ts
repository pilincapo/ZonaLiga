// Exceso de partidos por fecha: cuando los partidos de una jornada superan
// los slots disponibles (canchas × horarios), los excedentes quedan
// POSTERGADOS (status 'postponed') y sus equipos LIBRAN esa fecha. Todos los
// pendientes se pueden agendar juntos en una "fecha de reposición" al final
// del torneo. Dominio puro: no toca la base.

import type { Match } from './types.ts';
import { plannedRoundDate, scheduleCapacity, type TournamentSchedule } from './schedule.ts';

/**
 * Cuántos partidos de una jornada no entran en los slots disponibles.
 * capacity 0 (sin canchas ni horarios) = sin límite: el fixture sale sin
 * cancha asignada y nada se posterga.
 */
export function overflowOfRound(matchCount: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, matchCount - capacity);
}

/** Cuántos partidos de la jornada conservan cancha y horario. */
export function keepCount(matchCount: number, capacity: number): number {
  return matchCount - overflowOfRound(matchCount, capacity);
}

/**
 * Elige qué partidos quedan postergados en una fecha con excedente, de forma
 * equilibrada: prioriza los partidos cuyos equipos MENOS veces postergaron
 * hasta ahora, y entre esos elige al azar (rng inyectable para tests).
 *
 * `postponedCount` lleva la cuenta por equipo durante toda la generación y
 * se actualiza acá mismo (mutación intencional: el llamador la reutiliza
 * para la fecha siguiente).
 */
export function pickDeferred(
  roundMatches: { home: number; away: number }[],
  overflow: number,
  postponedCount: Map<number, number>,
  rng: () => number = Math.random
): Set<number> {
  const deferredIdx = new Set<number>();
  if (overflow <= 0) return deferredIdx;

  // Candidatos con su carga acumulada (máximo de los dos equipos del partido).
  const candidates = roundMatches.map((m, i) => ({
    i,
    load: Math.max(postponedCount.get(m.home) ?? 0, postponedCount.get(m.away) ?? 0),
  }));

  while (deferredIdx.size < overflow && deferredIdx.size < roundMatches.length) {
    const free = candidates.filter((c) => !deferredIdx.has(c.i));
    const minLoad = Math.min(...free.map((c) => c.load));
    const pool = free.filter((c) => c.load === minLoad);
    const pick = pool[Math.floor(rng() * pool.length)]!;
    deferredIdx.add(pick.i);
    const m = roundMatches[pick.i]!;
    postponedCount.set(m.home, (postponedCount.get(m.home) ?? 0) + 1);
    postponedCount.set(m.away, (postponedCount.get(m.away) ?? 0) + 1);
  }
  return deferredIdx;
}

/** Partidos postergados de la fase regular (los candidatos a reposición). */
export function postponedMatches(matches: Match[]): Match[] {
  return matches.filter((m) => m.status === 'postponed' && m.round != null && !m.bracket_round);
}

/** Etiqueta de la primera fecha de reposición: después de la última. */
export function makeUpRoundNumber(maxRound: number): number {
  return maxRound + 1;
}

export interface MakeUpBlock {
  /** Fecha (round) donde se agenda el bloque. */
  round: number;
  /** Día sugerido: el planificado para esa fecha del calendario. */
  played_on: string;
  /** Partidos que entran en este bloque (uno por slot disponible). */
  matches: Match[];
}

/**
 * Plan de reposición: junta TODOS los postergados en bloques del tamaño de
 * la capacidad. Si la capacidad es 0 (sin canchas/horarios), un solo bloque
 * con todos (quedan con día "a definir" y el admin los programa a mano).
 */
export function buildMakeUpPlan(
  postponed: Match[],
  maxRound: number,
  schedule: TournamentSchedule
): MakeUpBlock[] {
  const capacity = scheduleCapacity(schedule);
  const size = capacity > 0 ? capacity : postponed.length || 1;
  const blocks: MakeUpBlock[] = [];
  for (let i = 0; i * size < postponed.length; i++) {
    const round = maxRound + 1 + i;
    blocks.push({
      round,
      played_on: capacity > 0 ? makeUpRoundDate(schedule, maxRound, i) : '',
      matches: postponed.slice(i * size, (i + 1) * size),
    });
  }
  return blocks;
}

/**
 * Día sugerido para el bloque i de reposición: el calendario normal sigue
 * avanzando semana a semana desde la última fecha de zona.
 */
function makeUpRoundDate(s: TournamentSchedule, maxRound: number, blockIndex: number): string {
  return plannedRoundDate(s, maxRound + 1 + blockIndex);
}
