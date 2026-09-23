// Declaración de goles en la planilla: dominio puro.
//
// El marcador se declara en el form principal (Goles local / Goles
// visitante) y, si hay goles, debajo se despliegan listas para elegir el
// autor de cada uno. Guardar REEMPLAZA los eventos de gol del partido con lo
// declarado: cargar de nuevo no duplica ni suma.

/** Tope de goles por equipo. */
export const MAX_GOALS = 20;

/** Valor de la lista para "en contra" (gol en el arco propio). */
export const PICK_OWN = 'own';
/** Valor de la lista para gol sin autor. */
export const PICK_ANON = 'none';

export type GoalPick = { kind: 'player'; id: number } | { kind: 'own' } | { kind: 'anon' };

/** Parsea un valor de la lista: id de jugador, "own" (en contra) o "none" (sin autor). */
export function parseGoalPick(raw: string, allowed: ReadonlySet<number>): GoalPick | null {
  const v = String(raw).trim();
  if (v === PICK_OWN) return { kind: 'own' };
  if (v === PICK_ANON) return { kind: 'anon' };
  const id = Number(v);
  if (Number.isInteger(id) && allowed.has(id)) return { kind: 'player', id };
  return null;
}

/**
 * Valida la declaración de una camiseta: la cantidad declarada tiene que
 * estar cubierta por las listas (los valores de más se ignoran) y cada
 * autor debe ser válido (jugador del equipo, "own" o "none").
 * Una lista vacía cuenta como "falta elegir"; un valor raro, como error.
 */
export function resolveGoalPlan(opts: {
  goals: number;
  raws: readonly string[];
  allowed: readonly number[];
}): { ok: true; picks: GoalPick[] } | { ok: false; error: string } {
  const goals = Math.trunc(opts.goals);
  if (!Number.isFinite(goals) || goals < 0) return { ok: false, error: 'Cantidad de goles inválida' };
  if (goals === 0) return { ok: true, picks: [] };
  if (goals > MAX_GOALS) return { ok: false, error: `Como máximo ${MAX_GOALS} goles por equipo` };

  const allowedSet = new Set(opts.allowed);
  const picks: GoalPick[] = [];
  for (const raw of opts.raws) {
    if (picks.length >= goals) break; // valores de más: ignorados
    const v = String(raw).trim();
    if (v === '') continue; // sin elegir todavía
    const p = parseGoalPick(v, allowedSet);
    if (!p) return { ok: false, error: 'Hay un autor inválido en las listas de goles' };
    picks.push(p);
  }
  if (picks.length < goals) {
    return { ok: false, error: `Completá las listas: falta el autor de ${goals - picks.length} gol(es)` };
  }
  return { ok: true, picks };
}

/**
 * Sin plantilla cargada no hay listas que envíen valores: los goles quedan
 * como anónimos, salvo los marcados "en contra" (ese valor viaja igual).
 */
export function picksWithoutRoster(raws: readonly string[], goals: number): GoalPick[] {
  const out: GoalPick[] = [];
  for (const raw of raws) {
    if (out.length >= goals) break;
    out.push(String(raw).trim() === PICK_OWN ? { kind: 'own' } : { kind: 'anon' });
  }
  return out;
}

/** Opciones de una lista de autores: placeholder, "en contra" y la plantilla. */
export function scorerOptions(opts: {
  index: number; // 0-based
  teamName: string;
  players: ReadonlyArray<{ id: number; name: string; number: number | null }>;
}): ReadonlyArray<{ value: string; label: string }> {
  const n = opts.index + 1;
  const out: { value: string; label: string }[] = [
    { value: '', label: `Gol ${n}: elegí…` },
    { value: PICK_OWN, label: `🔁 En contra (gol en el arco de ${opts.teamName})` },
    { value: PICK_ANON, label: 'Sin autor' },
  ];
  for (const p of opts.players) {
    out.push({ value: String(p.id), label: `${p.number != null ? `#${p.number} ` : ''}${p.name}` });
  }
  return out;
}

/** Selección cruda para prellenar las listas desde los eventos del equipo. */
export function picksFromEvents(
  events: ReadonlyArray<{ teamId: number | null; type: string; playerId: number | null }>,
  teamId: number | null
): string[] {
  if (teamId == null) return [];
  const out: string[] = [];
  for (const e of events) {
    if (e.teamId !== teamId) continue;
    if (e.type === 'own_goal') out.push(PICK_OWN);
    else if (e.type === 'goal') out.push(e.playerId != null ? String(e.playerId) : PICK_ANON);
  }
  return out;
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
