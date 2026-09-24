// Tests de excedentes (partidos que no entran en las canchas) y del plan de
// reposición que los junta al final del torneo.

import { describe, expect, it } from 'vitest';
import {
  buildMakeUpPlan,
  keepCount,
  makeUpRoundNumber,
  overflowOfRound,
  postponedMatches,
} from '../src/lib/oversub.ts';
import { EMPTY_SCHEDULE } from '../src/lib/schedule.ts';
import type { Match } from '../src/lib/types.ts';

function mk(partial: Partial<Match>): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 1,
    zone: 'A',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-10-03',
    kickoff_time: '10:00',
    venue: 'Cancha 1',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

describe('overflow de una fecha', () => {
  it('cuenta cuántos partidos no entran', () => {
    expect(overflowOfRound(8, 8)).toBe(0);
    expect(overflowOfRound(22, 8)).toBe(14);
    expect(overflowOfRound(5, 8)).toBe(0);
  });

  it('sin canchas ni horarios no hay límite (nada se posterga)', () => {
    expect(overflowOfRound(30, 0)).toBe(0);
    expect(keepCount(30, 0)).toBe(30);
  });

  it('keepCount reparte la capacidad', () => {
    expect(keepCount(22, 8)).toBe(8);
    expect(keepCount(5, 8)).toBe(5);
  });
});

describe('postponedMatches', () => {
  it('toma solo postergados de la fase regular', () => {
    const matches = [
      mk({ id: 1, status: 'postponed' }),
      mk({ id: 2, status: 'scheduled' }),
      mk({ id: 3, status: 'postponed', round: null }),
      mk({ id: 4, status: 'postponed', bracket_round: 'F' }),
      mk({ id: 5, status: 'played' }),
    ];
    expect(postponedMatches(matches).map((m) => m.id)).toEqual([1]);
  });
});

describe('buildMakeUpPlan', () => {
  // Con fecha de inicio: el calendario de reposición se calcula desde acá.
  const SCHED = {
    ...EMPTY_SCHEDULE,
    venues: ['C1', 'C2'],
    kickoffs: ['10:00', '11:00', '12:00', '13:00'],
    startDate: '2026-10-03',
    roundGapDays: 7,
  };

  it('un solo bloque si los postergados entran en la capacidad', () => {
    const postponed = Array.from({ length: 8 }, (_, i) => mk({ id: i + 1, round: 3, status: 'postponed' }));
    const plan = buildMakeUpPlan(postponed, 15, SCHED);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.round).toBe(16); // makeUpRoundNumber(15) = 16
    expect(plan[0]!.matches).toHaveLength(8);
    expect(plan[0]!.played_on).toBeTruthy();
  });

  it('varios bloques si no alcanzan los slots, avanzando el calendario', () => {
    const postponed = Array.from({ length: 20 }, (_, i) => mk({ id: i + 1, round: 3, status: 'postponed' }));
    const plan = buildMakeUpPlan(postponed, 15, SCHED);
    expect(plan).toHaveLength(3);
    expect(plan.map((b) => b.round)).toEqual([16, 17, 18]);
    expect(plan[0]!.matches).toHaveLength(8);
    expect(plan[1]!.matches).toHaveLength(8);
    expect(plan[2]!.matches).toHaveLength(4);
  });

  it('sin capacidad: un bloque con todos y día a definir', () => {
    const postponed = [mk({ id: 1 }), mk({ id: 2 })];
    const plan = buildMakeUpPlan(postponed, 10, EMPTY_SCHEDULE);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.matches).toHaveLength(2);
    expect(plan[0]!.played_on).toBe('');
  });

  it('makeUpRoundNumber da la fecha siguiente a la última', () => {
    expect(makeUpRoundNumber(15)).toBe(16);
    expect(makeUpRoundNumber(0)).toBe(1);
  });
});
