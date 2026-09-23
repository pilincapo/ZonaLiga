// Carga rápida de goles en la planilla: dominio puro.
//
// El form ofrece cantidad (1-4 o "más") y una lista de jugador por gol
// (o "en contra", que favorece al equipo que la carga). Además, el marcador
// del partido se puede recalcular desde los eventos.

/** Tope de goles por carga. */
export const MAX_GOALS = 20;

export type ScorerResult = { ok: true; picks: (number | null)[] } | { ok: false; error: string };

/**
 * Valida la selección de goles: la cantidad elegida (1-4 o "más", entre 5 y
 * el tope) tiene que coincidir con las listas completadas; todo jugador
 * elegido debe ser de la plantilla del equipo. `null` = gol en contra.
 */
export function resolveGoalPicks(opts: {
  /** Valor del radio: '1'..'4' o 'more'. */
  count: string;
  /** Cantidad escrita cuando count === 'more'. */
  countMore?: string;
  /** Elecciones en orden: id de jugador o null para "en contra". */
  picks: readonly (number | null)[];
  /** Plantilla (ids) del equipo que anota. */
  allowed: readonly number[];
}): ScorerResult {
  const { count, countMore, picks, allowed } = opts;

  let n: number;
  if (count === '1' || count === '2' || count === '3' || count === '4') {
    n = Number(count);
  } else if (count === 'more') {
    n = Math.round(Number(countMore));
    if (!Number.isFinite(n) || n < 5 || n > MAX_GOALS) {
      return { ok: false, error: `La cantidad "más de 4" tiene que estar entre 5 y ${MAX_GOALS}` };
    }
  } else {
    return { ok: false, error: 'Elegí cuántos goles hizo el equipo' };
  }

  const allowedSet = new Set(allowed);
  for (const p of picks) {
    if (p != null && (!Number.isInteger(p) || !allowedSet.has(p))) {
      return { ok: false, error: 'Ese jugador no es de la plantilla de este equipo' };
    }
  }

  if (picks.length !== n) {
    return {
      ok: false,
      error: `Elegiste ${picks.length} de ${n} gol(es): completá las listas.`,
    };
  }
  return { ok: true, picks: [...picks] };
}

/**
 * Marcador implícito en los eventos: cada 'goal' suma para el equipo que lo
 * cargó y cada 'own_goal' suma para el rival. Eventos sin equipo o de
 * equipos ajenos al partido se ignoran.
 */
export function scoreFromEvents(
  events: ReadonlyArray<{ teamId: number | null; type: string }>,
  homeId: number | null,
  awayId: number | null
): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (e.teamId == null) continue;
    if (e.type === 'goal') {
      if (e.teamId === homeId) home += 1;
      else if (e.teamId === awayId) away += 1;
    } else if (e.type === 'own_goal') {
      if (e.teamId === homeId) away += 1;
      else if (e.teamId === awayId) home += 1;
    }
  }
  return { home, away };
}
