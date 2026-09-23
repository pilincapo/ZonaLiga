// Tipos de dominio y configuración de reglas.

export type TournamentFormat = 'round_robin' | 'zonas_playoffs' | 'copa';
export type TournamentStatus = 'draft' | 'active' | 'finished';
export type MatchStatus = 'scheduled' | 'played' | 'postponed' | 'suspended' | 'walkover' | 'bye';
export type EventType = 'goal' | 'own_goal' | 'yellow' | 'red';
export type PlayerPosition = '' | 'AR' | 'DF' | 'MED' | 'DEL';
export type BracketRound = '' | 'R16' | 'QF' | 'SF' | 'F' | '3P';

export interface Rules {
  /** Puntos por partido ganado. */
  win: number;
  /** Puntos por empate. */
  draw: number;
  /** Puntos por derrota. */
  loss: number;
  /** Goles que se asientan al ganador de un walkover (perdedor: 0). */
  walkoverGoals: number;
  /** Amarillas acumuladas que generan suspensión (0 = desactivado). */
  yellowAccumulation: number;
  /** Ventana (en jornadas) para contar acumulación; 0 = todo el torneo. */
  yellowAccumWindow: number;
  /** Partidos de suspensión por roja directa. */
  redSuspensionMatches: number;
  /** Reglas extra (ej: bonus por categoría). Reservado para el futuro. */
  bonusRules: string[];
}

export const DEFAULT_RULES: Rules = {
  win: 3,
  draw: 1,
  loss: 0,
  walkoverGoals: 3,
  yellowAccumulation: 0,
  yellowAccumWindow: 0,
  redSuspensionMatches: 1,
  bonusRules: [],
};

/** Normaliza la config guardada en el torneo; tolera configs viejas o parciales. */
export function parseRules(configJson: string): Rules {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    win: num(raw['win'], DEFAULT_RULES.win),
    draw: num(raw['draw'], DEFAULT_RULES.draw),
    loss: num(raw['loss'], DEFAULT_RULES.loss),
    walkoverGoals: num(raw['walkoverGoals'], DEFAULT_RULES.walkoverGoals),
    yellowAccumulation: num(raw['yellowAccumulation'], DEFAULT_RULES.yellowAccumulation),
    yellowAccumWindow: num(raw['yellowAccumWindow'], DEFAULT_RULES.yellowAccumWindow),
    redSuspensionMatches: num(raw['redSuspensionMatches'], DEFAULT_RULES.redSuspensionMatches),
    bonusRules: Array.isArray(raw['bonusRules'])
      ? (raw['bonusRules'] as unknown[]).filter((b): b is string => typeof b === 'string')
      : [],
  };
}

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  season: string;
  format: TournamentFormat;
  config: string;
  status: TournamentStatus;
  created_at: string;
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  short_name: string;
  color: string;
  logo_url: string;
  active: number;
  delegate_name: string;
  delegate_code: string | null;
  delegate_enabled: number;
}

export interface Player {
  id: number;
  team_id: number;
  name: string;
  number: number | null;
  position: PlayerPosition;
  active: number;
}

export interface Match {
  id: number;
  tournament_id: number;
  round: number | null;
  zone: string;
  bracket_round: BracketRound;
  home_team_id: number | null;
  away_team_id: number | null;
  home_source: string;
  away_source: string;
  played_on: string;
  kickoff_time: string;
  venue: string;
  status: MatchStatus;
  home_goals: number;
  away_goals: number;
  home_points: number | null;
  away_points: number | null;
  notes: string;
}

export interface Event {
  id: number;
  match_id: number;
  team_id: number | null;
  player_id: number | null;
  type: EventType;
  minute: number | null;
}

/** Resultado computado de un partido para las posiciones. */
export interface ComputedResult {
  status: MatchStatus;
  homeGoals: number;
  awayGoals: number;
  homePoints: number;
  awayPoints: number;
  /** true si el resultado computa para la tabla (jugado o walkover). */
  counts: boolean;
}

/**
 * Convierte un partido en resultado computado según las reglas del torneo.
 * - played: goles cargados + puntos por regla (o override manual de puntos).
 * - walkover: walkoverGoals a favor del equipo con más goles cargados
 *   (si está empatado, gana el local); el perdedor queda en 0.
 * - postponed / suspended / bye / scheduled: no computa.
 */
export function computeResult(m: Match, rules: Rules): ComputedResult {
  if (m.status === 'played' || m.status === 'walkover') {
    if (m.home_team_id == null || m.away_team_id == null) {
      return { status: m.status, homeGoals: 0, awayGoals: 0, homePoints: 0, awayPoints: 0, counts: false };
    }
    if (m.status === 'walkover') {
      const homeWins = m.home_goals >= m.away_goals;
      const g = Math.max(0, Math.round(rules.walkoverGoals));
      return {
        status: m.status,
        homeGoals: homeWins ? g : 0,
        awayGoals: homeWins ? 0 : g,
        homePoints: homeWins ? rules.win : rules.loss,
        awayPoints: homeWins ? rules.loss : rules.win,
        counts: true,
      };
    }
    const homePoints =
      m.home_points ?? (m.home_goals > m.away_goals ? rules.win : m.home_goals === m.away_goals ? rules.draw : rules.loss);
    const awayPoints =
      m.away_points ?? (m.away_goals > m.home_goals ? rules.win : m.home_goals === m.away_goals ? rules.draw : rules.loss);
    return { status: m.status, homeGoals: m.home_goals, awayGoals: m.away_goals, homePoints, awayPoints, counts: true };
  }
  return { status: m.status, homeGoals: 0, awayGoals: 0, homePoints: 0, awayPoints: 0, counts: false };
}

export interface StandingRow {
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  diff: number;
  points: number;
}

export const POSITION_ORDER = ['AR', 'DF', 'MED', 'DEL'] as const;
