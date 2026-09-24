// Tests del playoff opcional entre zonas: plan de generación por formato,
// config persistida, conteo de pendientes y avance automático de la llave.

import { describe, expect, it } from 'vitest';
import {
  buildPlayoffPlan,
  parsePlayoffConfig,
  parsePlayoffFormat,
  pendingLeagueCount,
  playoffFormatLabel,
  resolveAdvancements,
} from '../src/lib/playoff.ts';
import { matchWinnerLoser } from '../src/lib/bracket.ts';
import { matchesForStandings } from '../src/lib/crossover.ts';
import { regeneratePairings } from '../src/lib/fixture.ts';
import { EMPTY_SCHEDULE } from '../src/lib/schedule.ts';
import type { Match, StandingRow } from '../src/lib/types.ts';

const row = (teamId: number, points: number): StandingRow => ({
  teamId,
  played: 6,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  diff: 0,
  points,
});

function mk(partial: Partial<Match>): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 1,
    zone: '',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-01-01',
    kickoff_time: '',
    venue: '',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

describe('buildPlayoffPlan', () => {
  const A = [row(1, 18), row(2, 12)];
  const B = [row(5, 17), row(6, 11)];

  it('final única: 1ºA vs 1ºB en la fecha pedida', () => {
    const plan = buildPlayoffPlan(A, B, 'final', 8);
    expect(plan).toEqual([
      { round: 8, bracket_round: 'F', home: 1, away: 5, home_source: '', away_source: '' },
    ]);
  });

  it('semis + final: semis cruzadas y final con ganadores', () => {
    const plan = buildPlayoffPlan(A, B, 'semis_final', 8);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ bracket_round: 'SF', home: 1, away: 6 }); // 1ºA vs 2ºB
    expect(plan[1]).toMatchObject({ bracket_round: 'SF', home: 5, away: 2 }); // 1ºB vs 2ºA
    expect(plan[2]).toMatchObject({ bracket_round: 'F', home: null, away: null });
    expect(plan[2]!.home_source).toBe('WSF1');
    expect(plan[2]!.away_source).toBe('WSF2');
  });

  it('semis + final + 3er puesto: agrega el partido de perdedores', () => {
    const plan = buildPlayoffPlan(A, B, 'semis_final_3p', 8);
    expect(plan).toHaveLength(4);
    const tp = plan[3]!;
    expect(tp.bracket_round).toBe('3P');
    expect(tp.home_source).toBe('LSF1');
    expect(tp.away_source).toBe('LSF2');
  });

  it('lanza si faltan equipos para las semis', () => {
    expect(() => buildPlayoffPlan([row(1, 3)], B, 'semis_final', 8)).toThrow(/al menos 2 equipos/);
    expect(() => buildPlayoffPlan([], B, 'final', 8)).toThrow(/al menos un equipo/);
  });
});

describe('config y pendientes', () => {
  it('lee el playoff guardado y tolera configs viejos', () => {
    expect(parsePlayoffConfig('{}')).toBeNull();
    expect(parsePlayoffConfig('no-json')).toBeNull();
    const cfg = JSON.stringify({ playoff: { format: 'semis_final', round: 9 } });
    expect(parsePlayoffConfig(cfg)).toEqual({ format: 'semis_final', round: 9 });
    expect(parsePlayoffConfig(JSON.stringify({ playoff: { round: 3 } }))).toEqual({
      format: 'final',
      round: 3,
    });
  });

  it('parsePlayoffFormat usa final por defecto y playoffFormatLabel traduce', () => {
    expect(parsePlayoffFormat('semis_final_3p')).toBe('semis_final_3p');
    expect(parsePlayoffFormat('otro')).toBe('final');
    expect(playoffFormatLabel('final')).toContain('Final');
  });

  it('pendingLeagueCount cuenta solo la fase regular pendiente', () => {
    const matches = [
      mk({ id: 1, status: 'played' }),
      mk({ id: 2, status: 'scheduled' }), // falta
      mk({ id: 3, status: 'scheduled', bracket_round: 'F' }), // llave pendiente no bloquea
      mk({ id: 4, status: 'walkover' }),
      mk({ id: 5, status: 'bye' }),
      mk({ id: 6, status: 'postponed' }), // falta
    ];
    expect(pendingLeagueCount(matches)).toBe(2);
  });
});

describe('resolveAdvancements', () => {
  it('la final se completa sola cuando la semifinal está decidida', () => {
    const matches = [
      mk({ id: 10, round: 9, bracket_round: 'SF', home_team_id: 1, away_team_id: 6, status: 'played', home_goals: 2, away_goals: 0 }),
      mk({ id: 11, round: 9, bracket_round: 'SF', home_team_id: 5, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 3 }),
      mk({ id: 12, round: 9, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([
      { matchId: 12, side: 'home', teamId: 1 },
      { matchId: 12, side: 'away', teamId: 2 },
    ]);
  });

  it('semifinal empatada sin penales: nadie avanza', () => {
    const matches = [
      mk({ id: 10, round: 9, bracket_round: 'SF', status: 'played', home_goals: 1, away_goals: 1 }),
      mk({ id: 12, round: 9, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([]);
  });

  it('semifinal definida por penales (puntos manuales): avanza el que tiene más puntos', () => {
    const matches = [
      mk({ id: 10, round: 9, bracket_round: 'SF', status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 3 }),
      mk({ id: 12, round: 9, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([{ matchId: 12, side: 'home', teamId: 1 }]);
    expect(matchWinnerLoser(matches[0]!)).toEqual({ winner: 1, loser: 2 });
  });

  it('el 3er puesto recibe a los perdedores de las semis', () => {
    const matches = [
      mk({ id: 10, round: 9, bracket_round: 'SF', home_team_id: 1, away_team_id: 6, status: 'played', home_goals: 2, away_goals: 0 }),
      mk({ id: 11, round: 9, bracket_round: 'SF', home_team_id: 5, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 3 }),
      mk({ id: 13, round: 9, bracket_round: '3P', home_team_id: null, away_team_id: null, home_source: 'LSF1', away_source: 'LSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([
      { matchId: 13, side: 'home', teamId: 6 }, // perdedor de SF1
      { matchId: 13, side: 'away', teamId: 5 }, // perdedor de SF2
    ]);
  });

  it('no toca partidos donde el equipo ya está cargado', () => {
    const matches = [
      mk({ id: 10, round: 9, bracket_round: 'SF', home_team_id: 5, away_team_id: 6, status: 'played', home_goals: 2, away_goals: 0 }),
      mk({ id: 12, round: 9, bracket_round: 'F', home_team_id: 1, away_team_id: null, away_source: 'WSF1' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([{ matchId: 12, side: 'away', teamId: 5 }]);
  });
});

describe('tabla y regeneración con llave', () => {
  it('los partidos de llave no cuentan para la tabla', () => {
    const matches = [
      mk({ id: 1, round: 1, status: 'played' }),
      mk({ id: 2, round: 9, bracket_round: 'F', status: 'played' }),
    ];
    const filtered = matchesForStandings(matches, '{}');
    expect(filtered.map((m) => m.id)).toEqual([1]);
  });

  it('regeneratePairings conserva la llave y no mete partidos en su fecha', () => {
    const existing = [
      mk({ id: 1, round: 1, status: 'scheduled', home_team_id: 1, away_team_id: 2 }),
      mk({ id: 2, round: 4, status: 'scheduled', home_team_id: 1, away_team_id: 5 }),
      mk({ id: 3, round: 4, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'Z', away_source: '' }),
    ];
    const plan = regeneratePairings({
      existing,
      activeTeamIds: [1, 2, 5, 6],
      mode: 'single',
      schedule: EMPTY_SCHEDULE,
      crossovers: [{ round: 4, rule: 'espejo', counts: false }],
    });
    expect(plan.keptMatchIds).toEqual(expect.arrayContaining([2, 3]));
    expect(plan.removeMatchIds).toEqual([1]);
    expect(plan.create.every((m) => m.round !== 4)).toBe(true); // ni en el cruce ni en la llave
  });
});
