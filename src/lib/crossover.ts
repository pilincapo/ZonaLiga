// Fecha especial de cruce entre zonas: reglas de emparejamiento según la
// tabla, config persistida en el JSON del torneo y filtrado de tabla.
// Dominio puro: no toca la base.

import type { Match } from './types.ts';
import type { StandingRow } from './types.ts';

/** Reglas para armar los cruces según la posición de cada equipo en su zona. */
export type CrossoverRule = 'espejo' | 'invertido' | 'cruzado';

export const CROSSOVER_RULES: { value: CrossoverRule; label: string }[] = [
  { value: 'espejo', label: 'Espejo: 1ºA vs 1ºB, 2ºA vs 2ºB…' },
  { value: 'invertido', label: 'Invertido: 1ºA vs último B, 2ºA vs anteúltimo B…' },
  { value: 'cruzado', label: 'Cruzado: 1ºA vs 2ºB, 2ºA vs 1ºB…' },
];

export function parseCrossoverRule(value: unknown): CrossoverRule {
  return value === 'invertido' || value === 'cruzado' ? value : 'espejo';
}

/** Fecha de cruce registrada en la config del torneo. */
export interface CrossoverDate {
  /** Número de fecha (round) donde viven los partidos del cruce. */
  round: number;
  rule: CrossoverRule;
  /** true = los puntos de estos partidos suman a la tabla de zona. */
  counts: boolean;
}

export function parseCrossoverConfig(configJson: string): CrossoverDate[] {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const arr = raw['crossover'];
  if (!Array.isArray(arr)) return [];
  const out: CrossoverDate[] = [];
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o['round'] !== 'number' || !Number.isFinite(o['round'])) continue;
    out.push({
      round: o['round'],
      rule: parseCrossoverRule(o['rule']),
      counts: o['counts'] === true,
    });
  }
  // Una fecha = un cruce: si la config acumuló declaraciones repetidas del
  // mismo round (pasa al regenerar), gana la última y las demás se descartan.
  const byRound = new Map<number, CrossoverDate>();
  for (const d of out) byRound.set(d.round, d);
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

export function crossoverConfigJson(dates: CrossoverDate[]): { crossover: CrossoverDate[] } {
  return { crossover: dates };
}

/**
 * Arma los pares del cruce entre dos zonas según la tabla de cada una.
 * Devuelve pares [equipo de zonaA, equipo de zonaB]; si las zonas tienen
 * distinta cantidad, los sobrantes (colas de la tabla) no juegan.
 */
export function buildCrossoverPairs(
  zoneA: StandingRow[],
  zoneB: StandingRow[],
  rule: CrossoverRule
): { pairs: { home: number; away: number; posA: number; posB: number }[]; unpaired: number[] } {
  const zoneAOrdered = [...zoneA];
  const zoneBOrdered = [...zoneB];
  const pairs: { home: number; away: number; posA: number; posB: number }[] = [];
  const unpaired: number[] = [];

  const n = Math.min(zoneAOrdered.length, zoneBOrdered.length);
  const usedB = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = zoneAOrdered[i]!;
    // Índice del rival en la zona B según la regla. Cruzado intercambia
    // vecinos (1º↔2º, 3º↔4º…); si ese índice no existe o ya se usó, toma
    // el primero libre.
    let bIdx =
      rule === 'espejo'
        ? i
        : rule === 'invertido'
          ? zoneBOrdered.length - 1 - i
          : i % 2 === 0
            ? i + 1
            : i - 1;
    if (bIdx < 0 || bIdx >= zoneBOrdered.length || usedB.has(bIdx)) {
      bIdx = zoneBOrdered.findIndex((_, j) => !usedB.has(j));
    }
    if (bIdx < 0) break; // sin rivales libres
    const b = zoneBOrdered[bIdx]!;
    usedB.add(bIdx);
    // Localía alternada: los impares (1º, 3º…) son locales de la zona A.
    const aHome = i % 2 === 0;
    pairs.push({
      home: aHome ? a.teamId : b.teamId,
      away: aHome ? b.teamId : a.teamId,
      posA: i + 1,
      posB: bIdx + 1,
    });
  }
  // Los que quedan sin rival libran.
  if (zoneAOrdered.length > usedB.size) {
    for (let i = usedB.size; i < zoneAOrdered.length; i++) unpaired.push(zoneAOrdered[i]!.teamId);
  }
  // Sobrantes de la zona B (si tiene más equipos que la A) libran.
  for (let j = 0; j < zoneBOrdered.length; j++) {
    if (!usedB.has(j) && zoneAOrdered.length >= n) unpaired.push(zoneBOrdered[j]!.teamId);
  }
  return { pairs, unpaired };
}

/**
 * Rounds que son fechas de cruce. Con `onlyNonCounting`, solo los que NO
 * suman a la tabla (los que hay que excluir del cálculo de posiciones).
 */
/**
 * Marca viva en el dato: los partidos de cruce generados con la bolsa
 * mezclada llevan esta nota. Es la fuente de verdad para la tabla y la
 * regeneración (el número de fecha ya no alcanza, porque los cruces
 * conviven con partidos de zona en la misma fecha).
 */
export const CROSSOVER_NOTE = 'cruce entre zonas';
/** Variante que SÍ suma puntos a la tabla (flag "counts" de la config). */
export const CROSSOVER_NOTE_COUNTS = 'cruce entre zonas (cuenta)';

export function isCrossoverMatch(m: Match): boolean {
  return m.notes.includes(CROSSOVER_NOTE);
}

/** Un cruce marcado cuenta para la tabla solo si su nota lo dice. */
export function isCountingCrossoverMatch(m: Match): boolean {
  return m.notes.includes(CROSSOVER_NOTE_COUNTS);
}

/**
 * Fechas que actúan como cruce: las declaradas en la config MÁS cualquier
 * fecha que tenga al menos un partido marcado como cruce.
 */
export function crossoverRoundsOf(configJson: string, onlyNonCounting = false): Set<number> {
  const dates = parseCrossoverConfig(configJson);
  return new Set(dates.filter((d) => (onlyNonCounting ? !d.counts : true)).map((d) => d.round));
}

/**
 * Partidos que computan para la tabla: excluye los cruces marcados como "no
 * cuentan" (por nota O por fecha configurada) y los partidos de llave
 * /playoff (la tabla es de la fase regular).
 */
export function matchesForStandings(matches: Match[], configJson: string): Match[] {
  const rounds = crossoverRoundsOf(configJson, true);
  return matches.filter(
    (m) =>
      !m.bracket_round &&
      !(m.round != null && rounds.has(m.round)) &&
      !(isCrossoverMatch(m) && !isCountingCrossoverMatch(m))
  );
}
