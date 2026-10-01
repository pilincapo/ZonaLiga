// Tests del playoff opcional entre zonas: plan de generación por formato,
// config persistida, conteo de pendientes y avance automático de la llave.

import { describe, expect, it } from 'vitest';
import {
  bracketTies,
  buildPlayoffPlan,
  parsePlayoffConfig,
  parsePlayoffFormat,
  pendingLeagueCount,
  playoffFormatLabel,
  resolveAdvancements,
  tieWinnerLoser,
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

describe('Fase 12A: avance por resultado global (ida y vuelta)', () => {
  it('bracketTies agrupa los dos partidos del mismo cruce (localía invertida)', () => {
    const matches = [
      // SF1: ida (3 local vs 1) y revancha (1 local vs 3).
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 0, away_goals: 2 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 1, away_goals: 1 }),
      // SF2: ida y revancha de la otra llave.
      mk({ id: 22, round: 5, bracket_round: 'SF', home_team_id: 2, away_team_id: 4, status: 'played', home_goals: 2, away_goals: 0 }),
      mk({ id: 23, round: 6, bracket_round: 'SF', home_team_id: 4, away_team_id: 2, status: 'played', home_goals: 0, away_goals: 0 }),
    ];
    const ties = bracketTies(matches, 'SF');
    expect(ties).toHaveLength(2);
    expect(ties[0]!.teams).toEqual([1, 3]);
    expect(ties[0]!.matchIds).toEqual([20, 21]);
    expect(ties[1]!.teams).toEqual([2, 4]);
  });

  it('tieWinnerLoser: gana el del global aunque pierda la ida (y localía invertida)', () => {
    const matches = [
      // Ida: gana 3 (3-1). Revancha (localía invertida): gana 1 (3-0).
      // Global: 1 sumó 1+3=4, 3 sumó 3+0=3 → gana 1 por global.
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 3, away_goals: 1 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 3, away_goals: 0 }),
    ];
    const tie = bracketTies(matches, 'SF')[0]!;
    expect(tieWinnerLoser(matches, tie)).toEqual({ winner: 1, loser: 3 });
  });

  it('tieWinnerLoser: con global empatado, define la suma de puntos (penales)', () => {
    const matches = [
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 1, away_goals: 1, home_points: 3, away_points: 4 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 0, away_goals: 0 }),
    ];
    const tie = bracketTies(matches, 'SF')[0]!;
    // 1 ganó los penales (4-3 en la ida).
    expect(tieWinnerLoser(matches, tie)).toEqual({ winner: 1, loser: 3 });
  });

  it('tieWinnerLoser: falta jugar la revancha → sin ganador todavía', () => {
    const matches = [
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 3, away_goals: 1 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'scheduled' }),
    ];
    const tie = bracketTies(matches, 'SF')[0]!;
    expect(tieWinnerLoser(matches, tie)).toBeNull();
  });

  it('la final por ida/vuelta se completa sola cuando ambas semis están decididas por global', () => {
    const matches = [
      // SF1 ida y vuelta: gana 1 por global (2-3 con revancha).
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 2, away_goals: 1 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 2, away_goals: 0 }),
      // SF2 ida y vuelta: gana 2 (global 3-1).
      mk({ id: 22, round: 5, bracket_round: 'SF', home_team_id: 4, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 2 }),
      mk({ id: 23, round: 6, bracket_round: 'SF', home_team_id: 2, away_team_id: 4, status: 'played', home_goals: 1, away_goals: 0 }),
      // Final ida y vuelta con orígenes WSF1/WSF2: queda en espera.
      mk({ id: 24, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
      mk({ id: 25, round: 8, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF2', away_source: 'WSF1' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([
      { matchId: 24, side: 'home', teamId: 1 },
      { matchId: 24, side: 'away', teamId: 2 },
      { matchId: 25, side: 'home', teamId: 2 },
      { matchId: 25, side: 'away', teamId: 1 },
    ]);
  });

  it('el 3er puesto por ida/vuelta recibe a los perdedores del global', () => {
    const matches = [
      // SF1: gana 3 por global (4-2) → perdedor 1.
      mk({ id: 20, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 2, away_goals: 1 }),
      mk({ id: 21, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 1, away_goals: 2 }),
      // SF2: gana 2 por global (3-1) → perdedor 4.
      mk({ id: 22, round: 5, bracket_round: 'SF', home_team_id: 4, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 2 }),
      mk({ id: 23, round: 6, bracket_round: 'SF', home_team_id: 2, away_team_id: 4, status: 'played', home_goals: 1, away_goals: 0 }),
      mk({ id: 26, round: 7, bracket_round: '3P', home_team_id: null, away_team_id: null, home_source: 'LSF1', away_source: 'LSF2' }),
    ];
    const adv = resolveAdvancements(matches);
    expect(adv).toEqual([
      { matchId: 26, side: 'home', teamId: 1 }, // perdedor SF1
      { matchId: 26, side: 'away', teamId: 4 }, // perdedor SF2
    ]);
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

describe('Fase 12B: penales y series incompletas', () => {
  it('partido único empatado: sin penales cargados nadie avanza', () => {
    const matches = [
      mk({ id: 30, round: 5, bracket_round: 'SF', home_team_id: 1, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 1 }),
      mk({ id: 32, round: 6, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([]);
  });

  it('partido único empatado + penales: avanza el de más puntos y la final se completa', () => {
    const matches = [
      mk({ id: 30, round: 5, bracket_round: 'SF', home_team_id: 1, away_team_id: 2, status: 'played', home_goals: 1, away_goals: 1, home_points: 5, away_points: 4 }),
      mk({ id: 31, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 4, status: 'played', home_goals: 0, away_goals: 0, home_points: 2, away_points: 4 }),
      mk({ id: 32, round: 6, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    // SF1: gana 1 (5-4). SF2: gana 4 (4-2, de visitante).
    expect(resolveAdvancements(matches)).toEqual([
      { matchId: 32, side: 'home', teamId: 1 },
      { matchId: 32, side: 'away', teamId: 4 },
    ]);
  });

  it('ida/vuelta con global empatado + penales: avanza el de más puntos acumulados', () => {
    const matches = [
      // Ida: 1-1, penales 4-3 para el local (3). Vuelta: 0-0 → global 1-1.
      mk({ id: 40, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 3 }),
      mk({ id: 41, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 0, away_goals: 0 }),
      mk({ id: 42, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    const tie = bracketTies(matches, 'SF')[0]!;
    expect(tieWinnerLoser(matches, tie)).toEqual({ winner: 3, loser: 1 });
    expect(resolveAdvancements(matches)).toEqual([{ matchId: 42, side: 'home', teamId: 3 }]);
  });

  it('ida/vuelta con global empatado y penales empatados: nadie avanza', () => {
    const matches = [
      // Ida: 1-1, penales 4-3 (gana 3). Vuelta: 1-1, penales 4-3 (gana 1, local).
      // Suma de penales: +1 y -1 → empate total: nadie avanza.
      mk({ id: 40, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 3 }),
      mk({ id: 41, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 3 }),
      mk({ id: 42, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([]);
  });

  it('ida/vuelta con global empatado: la suma de penales decide quién avanza', () => {
    const matches = [
      // Ida: 1-1, penales 4-3 (gana 3). Vuelta: 1-1, penales 5-4 (gana 3 de visitante).
      // Suma para 3: +2 → avanza 3.
      mk({ id: 40, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 3 }),
      mk({ id: 41, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'played', home_goals: 1, away_goals: 1, home_points: 4, away_points: 5 }),
      mk({ id: 42, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([{ matchId: 42, side: 'home', teamId: 3 }]);
  });

  it('participantes sin determinar: el lado con origen sin resolver no se completa', () => {
    // La revancha con un equipo null no se agrupa al cruce (no se adivinan
    // rivales); la SF1 decidida avanza su ganador, pero el lado que depende
    // de la SF2 (inexistente/sin resolver) queda "Por definir".
    const matches = [
      mk({ id: 50, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 3, away_goals: 0 }),
      mk({ id: 51, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: null, status: 'scheduled' }),
      mk({ id: 52, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([{ matchId: 52, side: 'home', teamId: 3 }]);
  });

  it('cruce con un solo partido en el listado: se resuelve como partido único', () => {
    // La ida 3-0 con la revancha ausente del listado es indistinguible de un
    // cruce de partido único: se resuelve por ese resultado.
    const matches = [
      mk({ id: 50, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 3, away_goals: 0 }),
      mk({ id: 52, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    const tie = bracketTies(matches, 'SF')[0]!;
    expect(tie.matchIds.length).toBe(1);
    expect(tieWinnerLoser(matches, tie)).toEqual({ winner: 3, loser: 1 });
  });

  it('serie incompleta: con la revancha pendiente (scheduled) nadie avanza', () => {
    const matches = [
      mk({ id: 50, round: 5, bracket_round: 'SF', home_team_id: 3, away_team_id: 1, status: 'played', home_goals: 3, away_goals: 0 }),
      mk({ id: 51, round: 6, bracket_round: 'SF', home_team_id: 1, away_team_id: 3, status: 'scheduled' }),
      mk({ id: 52, round: 7, bracket_round: 'F', home_team_id: null, away_team_id: null, home_source: 'WSF1', away_source: 'WSF2' }),
    ];
    expect(resolveAdvancements(matches)).toEqual([]);
  });
});
