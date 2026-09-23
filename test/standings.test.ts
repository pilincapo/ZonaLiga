import { describe, expect, it } from 'vitest';
import { computeResult, DEFAULT_RULES, parseRules } from '../src/lib/types.ts';
import type { Match } from '../src/lib/types.ts';
import { computeStandings } from '../src/lib/standings.ts';

function mkMatch(partial: Partial<Match>): Match {
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
    kickoff_time: '10:00',
    venue: '',
    status: 'played',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

describe('computeResult', () => {
  it('jugado 2-1 con reglas 3-1-0', () => {
    const r = computeResult(mkMatch({ home_goals: 2, away_goals: 1 }), DEFAULT_RULES);
    expect(r).toMatchObject({ homePoints: 3, awayPoints: 0, counts: true });
  });

  it('empate da un punto a cada uno', () => {
    const r = computeResult(mkMatch({ home_goals: 1, away_goals: 1 }), DEFAULT_RULES);
    expect(r.homePoints).toBe(1);
    expect(r.awayPoints).toBe(1);
  });

  it('walkover: al ganador se le cargan walkoverGoals', () => {
    const r = computeResult(mkMatch({ status: 'walkover', home_goals: 1, away_goals: 0 }), {
      ...DEFAULT_RULES,
      walkoverGoals: 3,
    });
    expect(r.homeGoals).toBe(3);
    expect(r.awayGoals).toBe(0);
    expect(r.homePoints).toBe(3);
    expect(r.counts).toBe(true);
  });

  it('walkover con walkoverGoals = 0 (regla de liga dura)', () => {
    const r = computeResult(mkMatch({ status: 'walkover', home_goals: 0, away_goals: 1 }), {
      ...DEFAULT_RULES,
      walkoverGoals: 0,
    });
    expect(r.homeGoals).toBe(0);
    expect(r.awayGoals).toBe(0);
    expect(r.awayPoints).toBe(3);
  });

  it('postergado no computa', () => {
    const r = computeResult(mkMatch({ status: 'postponed' }), DEFAULT_RULES);
    expect(r.counts).toBe(false);
  });

  it('override manual de puntos', () => {
    const r = computeResult(mkMatch({ home_goals: 1, away_goals: 0, home_points: 2, away_points: 0 }), DEFAULT_RULES);
    expect(r.homePoints).toBe(2);
  });
});

describe('parseRules', () => {
  it('toma defaults con config vacía o inválida', () => {
    expect(parseRules('{}')).toEqual(DEFAULT_RULES);
    expect(parseRules('not json')).toEqual(DEFAULT_RULES);
  });

  it('mezcla valores parciales', () => {
    const r = parseRules('{"win":2,"yellowAccumulation":3}');
    expect(r.win).toBe(2);
    expect(r.draw).toBe(1);
    expect(r.yellowAccumulation).toBe(3);
  });
});

describe('computeStandings', () => {
  const teams = [
    { id: 1, name: 'Almendro' },
    { id: 2, name: 'Pampa' },
    { id: 3, name: 'Riverito' },
  ];

  it('suma puntos, goles y ordena por puntos', () => {
    const matches = [
      mkMatch({ id: 1, home_team_id: 1, away_team_id: 2, home_goals: 3, away_goals: 0 }),
      mkMatch({ id: 2, home_team_id: 1, away_team_id: 3, home_goals: 1, away_goals: 1 }),
      mkMatch({ id: 3, home_team_id: 2, away_team_id: 3, home_goals: 2, away_goals: 1 }),
    ];
    const table = computeStandings(matches, teams, DEFAULT_RULES);
    expect(table[0]!.teamId).toBe(1); // 4 pts
    expect(table[1]!.teamId).toBe(2); // 3 pts
    expect(table[2]!.teamId).toBe(3); // 1 pt
    expect(table[0]!.points).toBe(4);
    expect(table[0]!.goalsFor).toBe(4);
    expect(table[0]!.goalsAgainst).toBe(1);
    expect(table[0]!.diff).toBe(3);
  });

  it('desempata por diferencia de gol antes que head-to-head', () => {
    const fourTeams = [...teams, { id: 4, name: 'Andes' }];
    const matches = [
      mkMatch({ id: 1, home_team_id: 1, away_team_id: 2, home_goals: 3, away_goals: 0 }),
      mkMatch({ id: 2, home_team_id: 1, away_team_id: 3, home_goals: 0, away_goals: 4 }),
      mkMatch({ id: 3, home_team_id: 2, away_team_id: 4, home_goals: 1, away_goals: 0 }),
    ];
    // Equipos 1 y 2: 3 pts c/u y el 1 le ganó al 2 (head-to-head favorable),
    // pero el 1 tiene mejor diferencia (-1 vs -2) => DIF se evalúa antes que h2h.
    const table = computeStandings(matches, fourTeams, DEFAULT_RULES);
    expect(table.map((r) => r.teamId)).toEqual([3, 1, 2, 4]);
  });

  it('reglas custom: victoria vale 2 (fútbol viejo)', () => {
    const matches = [mkMatch({ home_team_id: 1, away_team_id: 2, home_goals: 1, away_goals: 0 })];
    const table = computeStandings(matches, teams, { ...DEFAULT_RULES, win: 2 });
    expect(table[0]!.points).toBe(2);
  });

  it('walkover entre dos equipos cuenta en la tabla', () => {
    const matches = [mkMatch({ status: 'walkover', home_team_id: 1, away_team_id: 2, home_goals: 0, away_goals: 1 })];
    const table = computeStandings(matches, teams.slice(0, 2), { ...DEFAULT_RULES, walkoverGoals: 3 });
    expect(table[0]!.teamId).toBe(2);
    expect(table[0]!.goalsFor).toBe(3);
  });
});
