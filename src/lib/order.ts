// Orden de lectura de los partidos de una fecha: pseudoaleatorio estable.
//
// El problema: los partidos se insertan por zona (todos los de la A, luego
// todos los de la B) y los horarios también se asignan por zona, así que
// ordenar por hora reproducía el orden por zona (la A siempre arriba).
// La solución: un orden de VISUALIZACIÓN mezclado y estable — la misma
// fecha se ve en el mismo orden en cada recarga (compartir por WhatsApp y
// comparar con papel sigue siendo posible) en panel, sitio público y En vivo.
//
// El orden es determinista a partir de (torneo, fecha, partido): no depende
// del momento de la consulta ni del orden de inserción, y NO mira la hora:
// si el orden aleatorio dejara un partido "temprano" abajo, es justamente
// el mezclado que se pidió (la grilla real del día se lee en Días, horas y
// canchas del panel y en el horario de cada fila).

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
}

/**
 * Ordena una lista de partidos de la MISMA fecha para mostrar en orden
 * pseudoaleatorio estable (distinto por fecha, fijo entre recargas).
 * Desempate final por id por si dos claves coincidieran (improbable).
 */
export function orderMatchesForDisplay(
  list: Match[],
  opts: { tournamentId?: number; round?: number | null } = {}
): Match[] {
  const tid = opts.tournamentId ?? 0;
  const roundKey = opts.round != null ? String(opts.round) : '';
  return [...list].sort((a, b) => {
    const ha = matchOrderKey(tid, roundKey, a.id);
    const hb = matchOrderKey(tid, roundKey, b.id);
    if (ha !== hb) return ha - hb;
    return a.id - b.id;
  });}
