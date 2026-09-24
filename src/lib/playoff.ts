// Playoff opcional entre zonas: se genera cuando todas las fechas de zona
// están jugadas. Tres formatos (final única, semis + final, semis + final +
// 3er puesto). La llave usa el sistema de bracket existente (bracket_round)
// y se registra en la config del torneo para que "Regenerar" no la toque.
// Dominio puro: no toca la base.

import type { BracketRound, Match, StandingRow } from './types.ts';
import { matchShortLabel, matchWinnerLoser } from './bracket.ts';

export type PlayoffFormat = 'final' | 'semis_final' | 'semis_final_3p';

export const PLAYOFF_FORMATS: { value: PlayoffFormat; label: string }[] = [
  { value: 'final', label: 'Final única (1ºA vs 1ºB)' },
  { value: 'semis_final', label: 'Semifinales + final' },
  { value: 'semis_final_3p', label: 'Semifinales + final + 3er puesto' },
];

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
 * y un origen "W…" / "L…", busca el partido referenciado por su etiqueta
 * corta (SF1, QF2…) y, si ya está decidido (incluye penales: empate en goles
 * con puntos manuales cargados), devuelve el equipo que pasa.
 */
export function resolveAdvancements(matches: Match[]): Advancement[] {
  const decided = new Map<string, ReturnType<typeof matchWinnerLoser>>();
  const out: Advancement[] = [];
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
      const label = source.slice(1);
      if (!wantWinner && !source.startsWith('L')) continue;
      const ref = matches.find((x) => x.bracket_round && matchShortLabel(x, matches) === label);
      if (!ref) continue;
      let wl = decided.get(ref.id.toString());
      if (wl === undefined) {
        wl = matchWinnerLoser(ref);
        decided.set(ref.id.toString(), wl);
      }
      if (!wl) continue;
      const teamId = wantWinner ? wl.winner : wl.loser;
      out.push({ matchId: m.id, side, teamId });
    }
  }
  return out;
}
