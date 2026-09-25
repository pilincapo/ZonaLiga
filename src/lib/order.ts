// Orden de lectura de los partidos de una fecha: pseudoaleatorio estable.
//
// El problema: los partidos se insertan por zona (todos los de la A, luego
// todos los de la B), y ORDER BY id muestra siempre la misma zona primero.
// La solución: un orden de VISUALIZACIÓN mezclado, pero estable — la misma
// fecha se ve en el mismo orden en cada recarga (compartir por WhatsApp y
// comparar con papel sigue siendo posible) y en panel y sitio público.
//
// El orden es determinista a partir de (torneo, fecha, partido): no depende
// del momento de la consulta ni del orden de inserción. La hora sigue
// mandando: el azar solo desempata partidos con el mismo horario, así que
// el cronograma real del día se respeta.

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

/**
 * Ordena una lista de partidos de la MISMA fecha para mostrar:
 * 1. Por hora (el cronograma del día manda).
 * 2. Desempate pseudoaleatorio estable (seed = torneo + fecha + id del
 *    partido), para que no siempre encabece la misma zona.
 * 3. Por id (estabilidad total si dos claves coincidieran).
 */
export function orderMatchesForDisplay(
  list: Match[],
  opts: { tournamentId?: number; round?: number | null } = {}
): Match[] {
  const tid = opts.tournamentId ?? 0;
  const roundKey = opts.round != null ? String(opts.round) : '';
  return [...list].sort((a, b) => {
    const ta = a.kickoff_time || '';
    const tb = b.kickoff_time || '';
    if (ta !== tb) return ta.localeCompare(tb);
    const ha = hash(`${tid}|${roundKey}|${a.id}`);
    const hb = hash(`${tid}|${roundKey}|${b.id}`);
    if (ha !== hb) return ha - hb;
    return a.id - b.id;
  });
}
