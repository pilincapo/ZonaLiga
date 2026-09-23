// Cálculo de posiciones: acumula resultados computados y ordena
// con tiebreakers PTS > DIF > GF > head-to-head > orden alfabético.

import { computeResult } from './types.ts';
import type { Match, Rules, StandingRow } from './types.ts';

export function computeStandings(
  matches: Match[],
  teams: { id: number; name: string }[],
  rules: Rules
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
