import { describe, expect, it } from 'vitest';
import { computeResult, DEFAULT_RULES, parseRules } from '../src/lib/types.ts';
import type { Match } from '../src/lib/types.ts';
import { computeStandings, computeFairPlay, computeValla, FAIR_PLAY, type PointAdjustment } from '../src/lib/standings.ts';

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

  it('showAdvanced: activo por defecto, apagable explícitamente', () => {
    expect(parseRules('{}').showAdvanced).toBe(true);
    expect(DEFAULT_RULES.showAdvanced).toBe(true);
    expect(parseRules('{"showAdvanced":false}').showAdvanced).toBe(false);
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

describe('ajustes manuales de puntos', () => {
  const teams = [
    { id: 1, name: 'Almendro' },
    { id: 2, name: 'Pampa' },
  ];
  const matches = [mkMatch({ status: 'played', home_team_id: 1, away_team_id: 2, home_goals: 2, away_goals: 0 })];
  const twoTeams = teams.slice(0, 2);

  it('una penalización fuerte cambia el orden', () => {
    // Equipo 1 ganó (3 pts). Con -4 queda en -1 y pasa al último lugar.
    const table = computeStandings(matches, twoTeams, DEFAULT_RULES, [{ teamId: 1, delta: -4, reason: 'Inclusión de jugador no habilitado' }]);
    expect(table[0]!.teamId).toBe(2);
    expect(table[1]!.points).toBe(-1);
  });

  it('empate en puntos tras penalizar: decide la diferencia de gol', () => {
    // Con -3 ambos quedan en 0; el equipo 1 sigue primero por +2 de diff.
    const table = computeStandings(matches, twoTeams, DEFAULT_RULES, [{ teamId: 1, delta: -3, reason: 'x' }]);
    expect(table[0]!.teamId).toBe(1);
    expect(table[1]!.points).toBe(0);
  });

  it('los ajustes no tocan PJ, goles ni diferencia', () => {
    const table = computeStandings(matches, twoTeams, DEFAULT_RULES, [{ teamId: 1, delta: -1, reason: 'x' }]);
    const first = table.find((r) => r.teamId === 1)!;
    expect(first.played).toBe(1);
    expect(first.goalsFor).toBe(2);
    expect(first.goalsAgainst).toBe(0);
    expect(first.points).toBe(2); // 3 - 1
  });

  it('acumula varios ajustes del mismo equipo', () => {
    const table = computeStandings(matches, twoTeams, DEFAULT_RULES, [
      { teamId: 1, delta: -3, reason: 'Penalización' },
      { teamId: 1, delta: 1, reason: 'Corrección por planilla' },
    ]);
    expect(table.find((r) => r.teamId === 1)!.points).toBe(1);
  });

  it('sin ajustes el resultado es idéntico al de siempre', () => {
    expect(computeStandings(matches, twoTeams, DEFAULT_RULES, [])).toEqual(computeStandings(matches, twoTeams, DEFAULT_RULES));
  });

  it('ignora ajustes de equipos que no están en la tabla', () => {
    const table = computeStandings(matches, twoTeams, DEFAULT_RULES, [{ teamId: 999, delta: -5, reason: 'fantasma' }]);
    expect(table).toEqual(computeStandings(matches, twoTeams, DEFAULT_RULES));
  });
});

describe('computeFairPlay', () => {
  const teams = [
    { id: 1, name: 'Azul' },
    { id: 2, name: 'Rojo' },
    { id: 3, name: 'Verde' },
  ];

  it('amarilla = 1, roja = 3 y ordena de menor a mayor puntaje', () => {
    const fp = computeFairPlay(
      [
        { teamId: 1, type: 'yellow' },
        { teamId: 1, type: 'yellow' }, // 2 pts
        { teamId: 2, type: 'red' }, // 3 pts
        { teamId: 3, type: 'yellow' }, // 1 pt
      ],
      teams
    );
    expect(fp.map((r) => r.teamId)).toEqual([3, 1, 2]); // Verde(1) < Azul(2) < Rojo(3)
    expect(fp[0]!.points).toBe(FAIR_PLAY.yellow);
    expect(fp[2]!.points).toBe(FAIR_PLAY.red);
    expect(fp[2]!.reds).toBe(1);
  });

  it('descarta tipos que no son tarjetas y equipos fantasma', () => {
    const fp = computeFairPlay(
      [{ teamId: 99, type: 'yellow' }, { teamId: 1, type: 'goal' }],
      teams
    );
    expect(fp).toHaveLength(3); // todos los equipos, con 0 pts
    expect(fp.every((r) => r.points === 0)).toBe(true);
  });

  it('empate de puntos: gana el que menos rojas tiene; después alfabético', () => {
    // Azul: 3 amarillas = 3 pts · Rojo: 1 roja = 3 pts
    const byCards = computeFairPlay(
      [
        { teamId: 1, type: 'yellow' },
        { teamId: 1, type: 'yellow' },
        { teamId: 1, type: 'yellow' },
        { teamId: 2, type: 'red' },
      ],
      teams
    );
    // Verde(0) < Azul(3 pts, 0 rojas) < Rojo(3 pts, 1 roja)
    expect(byCards.map((r) => r.teamId)).toEqual([3, 1, 2]);
    // Sin tarjetas, todos empatan en 0: orden alfabético
    const byName = computeFairPlay([], teams);
    expect(byName.map((r) => r.teamId)).toEqual([1, 2, 3]); // Azul, Rojo, Verde
  });
});

describe('computeValla', () => {
  const teams = [
    { id: 1, name: 'Azul' },
    { id: 2, name: 'Rojo' },
    { id: 3, name: 'Verde' },
  ];

  it('solo equipos que jugaron, de menor a mayor goles en contra', () => {
    const valla = computeValla(
      [
        { teamId: 1, played: 2, goalsAgainst: 3 },
        { teamId: 2, played: 2, goalsAgainst: 1 },
        { teamId: 3, played: 0, goalsAgainst: 0 }, // sin partidos: fuera
      ],
      teams
    );
    expect(valla.map((r) => r.teamId)).toEqual([2, 1]);
    expect(valla[0]!.gc).toBe(1);
  });

  it('empate de goles: quien jugó más; después alfabético', () => {
    const valla = computeValla(
      [
        { teamId: 1, played: 1, goalsAgainst: 2 },
        { teamId: 2, played: 3, goalsAgainst: 2 },
        { teamId: 3, played: 3, goalsAgainst: 2 },
      ],
      teams
    );
    // Rojo y Verde empatan con 3 partidos → Azul (1 partido) queda último
    expect(valla.map((r) => r.teamId)).toEqual([2, 3, 1]);
  });
});
