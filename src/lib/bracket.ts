// Modelo del bracket (llaves) para playoffs y copa.

import type { Match, BracketRound, TournamentFormat } from './types.ts';

export const BRACKET_ORDER: BracketRound[] = ['R16', 'QF', 'SF', 'F', '3P'];

export const BRACKET_LABELS: Record<string, string> = {
  R16: 'Octavos de final',
  QF: 'Cuartos de final',
  SF: 'Semifinales',
  '3P': 'Tercer puesto',
  F: 'Final',
};

export interface BracketMatchView {
  match: Match | null;
  label: string; // "Ganador Zona A", "Ganador Partido 12", etc.
}

export interface BracketColumn {
  round: BracketRound;
  title: string;
  matches: BracketMatchView[];
}

export function hasBracket(format: TournamentFormat, matches: Match[]): boolean {
  return format !== 'round_robin' && matches.some((m) => m.bracket_round !== '');
}

export function sourceLabel(source: string): string {
  if (!source) return 'Por definir';
  if (source.startsWith('W')) return `Ganador ${source.slice(1)}`;
  if (source.startsWith('L')) return `Perdedor ${source.slice(1)}`;
  if (source.startsWith('Z')) return `${source.slice(1)}`;
  return source;
}

/**
 * Arma las columnas del bracket. Los partidos de una misma ronda se ordenan
 * por round desc y luego por orden de creación, y se emparejan visualmente
 * de a dos (convención: el cruce N enfrenta ganadores de los cruces 2N y 2N+1).
 */
export function buildBracketColumns(tournamentMatches: Match[]): BracketColumn[] {
  const byRound = new Map<BracketRound, Match[]>();
  for (const m of tournamentMatches) {
    if (!m.bracket_round) continue;
    const arr = byRound.get(m.bracket_round);
    if (arr) arr.push(m);
    else byRound.set(m.bracket_round, [m]);
  }

  const columns: BracketColumn[] = [];
  for (const round of BRACKET_ORDER) {
    const matches = byRound.get(round);
    if (!matches || matches.length === 0) continue;
    matches.sort((a, b) => (b.round ?? 0) - (a.round ?? 0) || a.id - b.id);
    const views: BracketMatchView[] = matches.map((m) => ({
      match: m,
      label: '',
    }));
    columns.push({ round, title: BRACKET_LABELS[round] ?? round, matches: views });
  }
  return columns;
}

/** Ronda previa lógica: R16<-QF<-SF<-F. 3P no participa del flujo. */
export function previousRound(round: BracketRound): BracketRound | null {
  switch (round) {
    case 'F':
    case '3P':
      return 'SF';
    case 'SF':
      return 'QF';
    case 'QF':
      return 'R16';
    default:
      return null;
  }
}

/** Etiqueta corta de un partido para referencias ("SF2", "QF1", "Partido 7"). */
export function matchShortLabel(m: Match, roundMatches: Match[]): string {
  if (m.bracket_round) {
    const ordered = [...roundMatches]
      .filter((x) => x.bracket_round === m.bracket_round)
      .sort((a, b) => (b.round ?? 0) - (a.round ?? 0) || a.id - b.id);
    const n = ordered.findIndex((x) => x.id === m.id) + 1;
    return `${m.bracket_round}${n}`;
  }
  return `Partido ${m.id}`;
}

/**
 * Devuelve los ganador/perdedor de un partido jugado, si ya está definido.
 * Para walkover usa quién recibió los goles a favor.
 */
export function matchWinnerLoser(
  m: Match
): { winner: number; loser: number } | null {
  if (m.home_team_id == null || m.away_team_id == null) return null;
  if (m.status !== 'played' && m.status !== 'walkover') return null;
  if (m.home_goals > m.away_goals) return { winner: m.home_team_id, loser: m.away_team_id };
  if (m.away_goals > m.home_goals) return { winner: m.away_team_id, loser: m.home_team_id };
  return null; // empate: sin ganador (indefinido para llaves)
}
