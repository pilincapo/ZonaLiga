// Carga rápida de goles en la planilla: dominio puro.
//
// El form ofrece cantidad (1-4 o "más de 4") + checks de la plantilla.
// La regla: los goleadores tildados tienen que ser exactamente la cantidad
// elegida y todos del equipo del partido. Además, el marcador del partido
// se puede recalcular desde los eventos (goles + en contra).

/** Tope para "más de 4". */
export const MAX_GOALS = 20;

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

export type ScorerResult = { ok: true; ids: number[] } | { ok: false; error: string };

export function resolveScorers(opts: {
  /** Valor del radio: '1'..'4' o 'more'. */
  count: string;
  /** Cantidad escrita cuando count === 'more'. */
  countMore?: string;
  /** Jugadores tildados en la plantilla. */
  checked: readonly number[];
  /** Plantilla (ids) del equipo que anota. */
  allowed: readonly number[];
}): ScorerResult {
  const { count, countMore, checked, allowed } = opts;

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
  const ids: number[] = [];
  for (const pid of checked) {
    if (!Number.isInteger(pid) || !allowedSet.has(pid)) {
      return { ok: false, error: 'Ese jugador no es de la plantilla de este equipo' };
    }
    ids.push(pid);
  }

  if (ids.length !== n) {
    return {
      ok: false,
      error: `Tildaste ${ids.length} goleador(es) para ${n} gol(es): tildá exactamente ${n}.`,
    };
  }
  return { ok: true, ids };
}
