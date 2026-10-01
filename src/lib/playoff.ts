// Playoff opcional entre zonas: se genera cuando todas las fechas de zona
// están jugadas. Tres formatos (final única, semis + final, semis + final +
// 3er puesto). La llave usa el sistema de bracket existente (bracket_round)
// y se registra en la config del torneo para que "Regenerar" no la toque.
// Dominio puro: no toca la base.

import type { BracketRound, Match, StandingRow } from './types.ts';
import { matchWinnerLoser } from './bracket.ts';
import { isCrossoverMatch } from './crossover.ts';

export type PlayoffFormat = 'final' | 'semis_final' | 'semis_final_3p';

export const PLAYOFF_FORMATS: { value: PlayoffFormat; label: string }[] = [
  { value: 'final', label: 'Final única (1ºA vs 1ºB)' },
  { value: 'semis_final', label: 'Semifinales + final' },
  { value: 'semis_final_3p', label: 'Semifinales + final + 3er puesto' },
];

/**
 * Fase 12A: agrupa los partidos de una ronda de llave en cruces ("ties").
 * Con ida y vuelta, los dos partidos del mismo cruce comparten el par de
 * equipos y forman UN solo cruce; con partido único, cada partido es su
 * propio cruce. El orden de los cruces es el de creación (menor id primero),
 * el mismo con el que el generador numeró los orígenes "W…"/"L…".
 */
export function bracketTies(
  matches: Match[],
  round: string
): { teams: [number, number]; matchIds: number[] }[] {
  if (!round) return [];
  const inRound = matches
    .filter((m) => m.bracket_round === round && m.home_team_id != null && m.away_team_id != null)
    .sort((a, b) => a.id - b.id);
  const ties: { teams: [number, number]; matchIds: number[] }[] = [];
  for (const m of inRound) {
    const lo = Math.min(m.home_team_id!, m.away_team_id!);
    const hi = Math.max(m.home_team_id!, m.away_team_id!);
    let tie = ties.find((t) => t.teams[0] === lo && t.teams[1] === hi);
    if (!tie) {
      tie = { teams: [lo, hi], matchIds: [] };
      ties.push(tie);
    }
    tie.matchIds.push(m.id);
  }
  return ties;
}

/**
 * Fase 12A: ganador y perdedor de un cruce completo (partido único o ida y
 * vuelta) por resultado GLOBAL: goles sumados entre todas las fechas. Con el
 * global empatado, define la suma de puntos manuales (penales). Si falta
 * jugar algún partido del cruce, todavía no hay ganador.
 */
export function tieWinnerLoser(
  matches: Match[],
  tie: { teams: [number, number]; matchIds: number[] }
): { winner: number; loser: number } | null {
  const legs = tie.matchIds
    .map((id) => matches.find((m) => m.id === id))
    .filter((m): m is Match => Boolean(m));
  // Fase 12B: si falta alguno de los partidos del cruce en el listado, la
  // serie está incompleta por definición: no se resuelve (no se avanza con
  // una serie a la que le falta un partido).
  if (legs.length !== tie.matchIds.length) return null;
  if (legs.length === 0) return null;
  if (!legs.every((m) => m.status === 'played' || m.status === 'walkover')) return null;
  const [t0, t1] = tie.teams;
  let g0 = 0;
  let g1 = 0;
  let pen0 = 0;
  for (const leg of legs) {
    const homeIs0 = leg.home_team_id === t0;
    g0 += homeIs0 ? leg.home_goals : leg.away_goals;
    g1 += homeIs0 ? leg.away_goals : leg.home_goals;
    if (leg.home_points != null && leg.away_points != null) {
      pen0 += homeIs0 ? leg.home_points - leg.away_points : leg.away_points - leg.home_points;
    }
  }
  if (g0 > g1) return { winner: t0, loser: t1 };
  if (g1 > g0) return { winner: t1, loser: t0 };
  if (pen0 !== 0) return pen0 > 0 ? { winner: t0, loser: t1 } : { winner: t1, loser: t0 };
  return null;
}

export function parsePlayoffFormat(value: unknown): PlayoffFormat {
  return value === 'semis_final' || value === 'semis_final_3p' ? value : 'final';
}

export function playoffFormatLabel(f: PlayoffFormat): string {
  return PLAYOFF_FORMATS.find((x) => x.value === f)?.label ?? f;
}

/** Playoff registrado en la config del torneo (máximo uno por torneo). */
export interface PlayoffConfig {
  format: PlayoffFormat;
  /** Fecha (round) donde viven los partidos de la llave. */
  round: number;
}

export function parsePlayoffConfig(configJson: string): PlayoffConfig | null {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const o = raw['playoff'];
  if (!o || typeof o !== 'object') return null;
  const p = o as Record<string, unknown>;
  if (typeof p['round'] !== 'number' || !Number.isFinite(p['round'])) return null;
  return { format: parsePlayoffFormat(p['format']), round: p['round'] };
}

export function playoffConfigJson(p: PlayoffConfig | null): { playoff?: PlayoffConfig } {
  return p ? { playoff: p } : {};
}

/** Partido de la llave pendiente de jugar (bloquea la generación). */
export function isPendingLeague(m: Match): boolean {
  if (m.bracket_round) return false;
  // Los cruces mezclados en la bolsa no bloquean el playoff: no son de la
  // fase regular (si su fecha fue configurada como cruce, ya queda excluido).
  if (isCrossoverMatch(m)) return false;
  return m.status === 'scheduled' || m.status === 'postponed' || m.status === 'suspended';
}

/** Cuántos partidos de fecha faltan jugar antes de habilitar el playoff. */
export function pendingLeagueCount(matches: Match[]): number {
  return matches.filter(isPendingLeague).length;
}

/** Partido pendiente de la llave que falta completar equipos. */
export interface PlayoffSlot {
  round: number;
  bracket_round: BracketRound;
  home: number | null;
  away: number | null;
  home_source: string;
  away_source: string;
}

/**
 * Arma los partidos del playoff según el formato. Las tablas vienen ordenadas
 * (1º primero). La final de semis usa orígenes "WSF1"/"WSF2" (ganador de la
 * semifinal 1/2) y el 3er puesto "LSF1"/"LSF2" (perdedor), que la llave
 * resuelve sola cuando el partido decidido queda cargado.
 * Lanza si faltan equipos (zonas con menos de 2 para semis).
 */
export function buildPlayoffPlan(
  tableA: StandingRow[],
  tableB: StandingRow[],
  format: PlayoffFormat,
  round: number
): PlayoffSlot[] {
  const firstA = tableA[0];
  const firstB = tableB[0];
  if (!firstA || !firstB) throw new Error('Cada zona necesita al menos un equipo para el playoff');

  if (format === 'final') {
    return [
      { round, bracket_round: 'F', home: firstA.teamId, away: firstB.teamId, home_source: '', away_source: '' },
    ];
  }
  const secondA = tableA[1];
  const secondB = tableB[1];
  if (!secondA || !secondB) {
    throw new Error('Las semifinales necesitan al menos 2 equipos por zona');
  }
  const slots: PlayoffSlot[] = [
    // Semis cruzadas: 1ºA vs 2ºB y 1ºB vs 2ºA.
    { round, bracket_round: 'SF', home: firstA.teamId, away: secondB.teamId, home_source: '', away_source: '' },
    { round, bracket_round: 'SF', home: firstB.teamId, away: secondA.teamId, home_source: '', away_source: '' },
    { round, bracket_round: 'F', home: null, away: null, home_source: 'WSF1', away_source: 'WSF2' },
  ];
  if (format === 'semis_final_3p') {
    slots.push({ round, bracket_round: '3P', home: null, away: null, home_source: 'LSF1', away_source: 'LSF2' });
  }
  return slots;
}

/** Lado de un partido de llave cuyo equipo todavía no está definido. */
export interface Advancement {
  matchId: number;
  side: 'home' | 'away';
  teamId: number;
}

/**
 * Avance automático de la llave: para cada partido con un equipo sin definir
 * y un origen "W…" / "L…", busca el cruce referenciado (ronda + número) y, si
 * ya está decidido por resultado global (goles sumados, con ida y vuelta, o
 * penales), devuelve el equipo que pasa.
 */
export function resolveAdvancements(matches: Match[]): Advancement[] {
  const out: Advancement[] = [];
  const cache = new Map<string, { winner: number; loser: number } | null>();
  const winnerOf = (label: string): { winner: number; loser: number } | null => {
    if (!cache.has(label)) {
      const round = label.replace(/\d+$/, '');
      const n = Number(label.slice(round.length));
      const tie = Number.isInteger(n) && n >= 1 ? bracketTies(matches, round)[n - 1] : undefined;
      cache.set(label, tie ? tieWinnerLoser(matches, tie) : null);
    }
    return cache.get(label) ?? null;
  };
  for (const m of matches) {
    if (!m.bracket_round) continue;
    const sides: { side: 'home' | 'away'; source: string }[] = [
      { side: 'home', source: m.home_source },
      { side: 'away', source: m.away_source },
    ];
    for (const { side, source } of sides) {
      const hasTeam = side === 'home' ? m.home_team_id != null : m.away_team_id != null;
      if (hasTeam || !source) continue;
      const wantWinner = source.startsWith('W');
      if (!wantWinner && !source.startsWith('L')) continue;
      const wl = winnerOf(source.slice(1));
      if (!wl) continue;
      const teamId = wantWinner ? wl.winner : wl.loser;
      out.push({ matchId: m.id, side, teamId });
    }
  }
  return out;
}
