// Cálculo de posiciones: acumula resultados computados y ordena
// con tiebreakers PTS > DIF > GF > head-to-head > orden alfabético.
// Los ajustes manuales de puntos (penalizaciones y correcciones) se suman
// después del ordenamiento NO: se suman a los puntos ANTES de ordenar, para
// que la penalización afecte la posición.

import { computeResult } from './types.ts';
import type { Match, Rules, StandingRow } from './types.ts';

/** Ajuste manual de puntos: delta (puede ser negativo) y motivo. */
export interface PointAdjustment {
  teamId: number;
  delta: number;
  reason: string;
}

export function computeStandings(
  matches: Match[],
  teams: { id: number; name: string }[],
  rules: Rules,
  adjustments: PointAdjustment[] = []
): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, { teamId: t.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, diff: 0, points: 0 });
  }

  for (const m of matches) {
    const r = computeResult(m, rules);
    if (!r.counts || m.home_team_id == null || m.away_team_id == null) continue;
    const home = rows.get(m.home_team_id);
    const away = rows.get(m.away_team_id);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += r.homeGoals;
    home.goalsAgainst += r.awayGoals;
    away.goalsFor += r.awayGoals;
    away.goalsAgainst += r.homeGoals;
    if (r.homePoints > r.awayPoints) {
      home.won += 1;
      away.lost += 1;
    } else if (r.homePoints < r.awayPoints) {
      away.won += 1;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
    }
    home.points += r.homePoints;
    away.points += r.awayPoints;
  }

  // Ajustes manuales: cambian puntos (y por ende el orden), nunca PJ ni goles.
  for (const adj of adjustments) {
    const row = rows.get(adj.teamId);
    if (row) row.points += adj.delta;
  }

  const out: StandingRow[] = [];
  for (const row of rows.values()) {
    row.diff = row.goalsFor - row.goalsAgainst;
    out.push(row);
  }

  const h2h = buildHeadToHead(matches, rules);
  const names = new Map(teams.map((t) => [t.id, t.name.toLowerCase()]));

  out.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    const ha = h2h.get(a.teamId)?.get(b.teamId);
    const hb = h2h.get(b.teamId)?.get(a.teamId);
    if (ha !== undefined && hb !== undefined && ha !== hb) return hb - ha;
    const an = names.get(a.teamId) ?? '';
    const bn = names.get(b.teamId) ?? '';
    if (an !== bn) return an < bn ? -1 : 1;
    return a.teamId - b.teamId;
  });

  return out;
}

function buildHeadToHead(matches: Match[], rules: Rules): Map<number, Map<number, number>> {
  const h2h = new Map<number, Map<number, number>>();
  for (const m of matches) {
    const r = computeResult(m, rules);
    if (!r.counts || m.home_team_id == null || m.away_team_id == null) continue;
    const diff = r.homePoints - r.awayPoints;
    addH2H(h2h, m.home_team_id, m.away_team_id, diff);
    addH2H(h2h, m.away_team_id, m.home_team_id, -diff);
  }
  return h2h;
}

function addH2H(m: Map<number, Map<number, number>>, a: number, b: number, v: number): void {
  let inner = m.get(a);
  if (!inner) {
    inner = new Map();
    m.set(a, inner);
  }
  inner.set(b, (inner.get(b) ?? 0) + v);
}

export function groupBy<T>(list: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = keyFn(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** Puntos de fair play por tarjeta: amarilla = 1, roja = 3 (menos es mejor). */
export const FAIR_PLAY = { yellow: 1, red: 3 } as const;

export interface FairPlayRow {
  teamId: number;
  yellows: number;
  reds: number;
  points: number;
}

/**
 * Tabla de fair play por equipo, calculada desde las tarjetas de los
 * eventos. Ordena de MENOR a MAYOR puntaje (gana el que menos tarjetas
 * tiene); empates: menos rojas, menos amarillas y finalmente alfabético.
 */
export function computeFairPlay(
  cards: ReadonlyArray<{ teamId: number; type: string }>,
  teams: { id: number; name: string }[]
): FairPlayRow[] {
  const rows = new Map<number, FairPlayRow>();
  for (const t of teams) rows.set(t.id, { teamId: t.id, yellows: 0, reds: 0, points: 0 });
  for (const c of cards) {
    const row = rows.get(c.teamId);
    if (!row) continue; // tarjeta de un equipo ajeno: se ignora
    if (c.type === 'yellow') row.yellows += 1;
    else if (c.type === 'red') row.reds += 1;
  }
  const out = [...rows.values()];
  for (const r of out) r.points = r.yellows * FAIR_PLAY.yellow + r.reds * FAIR_PLAY.red;
  const names = new Map(teams.map((t) => [t.id, t.name.toLowerCase()]));
  out.sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    if (a.reds !== b.reds) return a.reds - b.reds;
    if (a.yellows !== b.yellows) return a.yellows - b.yellows;
    const an = names.get(a.teamId) ?? '';
    const bn = names.get(b.teamId) ?? '';
    if (an !== bn) return an < bn ? -1 : 1;
    return a.teamId - b.teamId;
  });
  return out;
}

export interface VallaRow {
  teamId: number;
  /** Goles en contra. */
  gc: number;
}

/**
 * Valla menos vencida: solo equipos que jugaron, de MENOR a MAYOR goles
 * en contra. Empate: quien jugó más partidos y finalmente alfabético.
 */
export function computeValla(
  rows: ReadonlyArray<{ teamId: number; played: number; goalsAgainst: number }>,
  teams: { id: number; name: string }[]
): VallaRow[] {
  const names = new Map(teams.map((t) => [t.id, t.name.toLowerCase()]));
  const out = rows
    .filter((r) => r.played > 0)
    .map((r) => ({ teamId: r.teamId, gc: r.goalsAgainst, played: r.played }));
  out.sort((a, b) => {
    if (a.gc !== b.gc) return a.gc - b.gc;
    if (b.played !== a.played) return b.played - a.played;
    const an = names.get(a.teamId) ?? '';
    const bn = names.get(b.teamId) ?? '';
    if (an !== bn) return an < bn ? -1 : 1;
    return a.teamId - b.teamId;
  });
  return out.map((r) => ({ teamId: r.teamId, gc: r.gc }));
}
