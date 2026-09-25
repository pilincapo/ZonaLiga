// Orden de lectura de los partidos de una fecha.
//
// Dos modos:
// - 'crono' (default): por cancha y hora — el cronograma real del día.
//   El fixture público lo usa: la lista se lee como la planilla del día.
// - 'mix': pseudoaleatorio estable; disponible para otros usos.
//
// El orden es determinista (no depende del momento de la consulta ni del
// orden de inserción). Con la asignación de canchas y horas ya sorteada
// por día en el generador, el cronograma NO hereda el orden por zona.

import type { Match } from './types.ts';

/** Hash FNV-1a de 32 bits (determinista, sin dependencias). */
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Sin signo.
  return h >>> 0;
}

/** Clave de orden de un partido: mezcla estable dentro de la fecha. */
export function matchOrderKey(tournamentId: number, round: number | string | null | undefined, matchId: number): number {
  return hash(`${tournamentId}|${round ?? ''}|${matchId}`);
}/**
 * Ordena una lista de partidos de la MISMA fecha para mostrar.
 *
 * Modo 'crono' (default): por cancha y hora — el cronograma real del día.
 * Modo 'mix': pseudoaleatorio estable (distinto por fecha, fijo entre
 * recargas); el azar desempata horarios y canchas idénticas.
 */
export function orderMatchesForDisplay(
  list: Match[],
  opts: { tournamentId?: number; round?: number | null; mode?: 'crono' | 'mix' } = {}
): Match[] {
  const tid = opts.tournamentId ?? 0;
  const roundKey = opts.round != null ? String(opts.round) : '';
  if ((opts.mode ?? 'crono') === 'crono') {
    return [...list].sort(
      (a, b) =>
        (a.played_on || '').localeCompare(b.played_on || '') ||
        (a.kickoff_time || '99:99').localeCompare(b.kickoff_time || '99:99') ||
        a.venue.localeCompare(b.venue) ||
        a.id - b.id
    );
  }
  return [...list].sort((a, b) => {
    const ha = matchOrderKey(tid, roundKey, a.id);
    const hb = matchOrderKey(tid, roundKey, b.id);
    if (ha !== hb) return ha - hb;
    return a.id - b.id;
  });
}
