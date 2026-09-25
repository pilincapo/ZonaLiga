// Tests de la sugerencia ⭐ de fecha para reciclar postergados
// (suggestMakeUpRound, usada por el cuadro de fechas libres del panel).

import { describe, expect, it } from 'vitest';
import { suggestMakeUpRound } from '../src/lib/oversub.ts';
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

const TODOS = [1, 2, 3, 4, 5, 6];

describe('suggestMakeUpRound', () => {
  it('elige la fecha con más equipos libres', () => {
    const byRound = new Map<number, Match[]>([
      // F1: 3 partidos => 1 equipo libre (el 6)
      [1, [mk({ id: 1, round: 1, home_team_id: 1, away_team_id: 2 }), mk({ id: 2, round: 1, home_team_id: 3, away_team_id: 4 }), mk({ id: 3, round: 1, home_team_id: 5, away_team_id: 6 })]],
      // F2: 2 partidos => 2 equipos libres (5 y 6)
      [2, [mk({ id: 4, round: 2, home_team_id: 1, away_team_id: 2 }), mk({ id: 5, round: 2, home_team_id: 3, away_team_id: 4 })]],
    ]);
    expect(suggestMakeUpRound(byRound, [1, 2], TODOS)).toBe(2);
  });

  it('empate: se queda con la primera fecha', () => {
    const byRound = new Map<number, Match[]>([
      [1, [mk({ id: 1, round: 1, home_team_id: 1, away_team_id: 2 }), mk({ id: 2, round: 1, home_team_id: 3, away_team_id: 4 })]],
      [2, [mk({ id: 3, round: 2, home_team_id: 5, away_team_id: 6 }), mk({ id: 4, round: 2, home_team_id: 1, away_team_id: 2 })]],
    ]);
    expect(suggestMakeUpRound(byRound, [1, 2], TODOS)).toBe(1);
  });

  it('descarta fechas toda jugada (sin pendientes)', () => {
    const byRound = new Map<number, Match[]>([
      // F1 jugada: 2 partidos => 2 libres, pero no admite reciclar
      [1, [mk({ id: 1, round: 1, status: 'played' }), mk({ id: 2, round: 1, home_team_id: 3, away_team_id: 4, status: 'played' })]],
      // F2 con un postergado pendiente: 4 libres
      [2, [mk({ id: 3, round: 2, home_team_id: 1, away_team_id: 2, status: 'played' }), mk({ id: 4, round: 2, home_team_id: 3, away_team_id: 4, status: 'postponed' })]],
    ]);
    expect(suggestMakeUpRound(byRound, [1, 2], TODOS)).toBe(2);
  });

  it('descarta fechas vacías y devuelve null si no hay ninguna con pendientes', () => {
    const byRound = new Map<number, Match[]>([
      [1, [mk({ id: 1, round: 1, status: 'played' })]],
      [2, []],
    ]);
    expect(suggestMakeUpRound(byRound, [1, 2], TODOS)).toBeNull();
  });

  it('sin fechas no sugiere nada', () => {
    expect(suggestMakeUpRound(new Map(), [], TODOS)).toBeNull();
  });

  it('cuenta libres aunque la fecha tenga un solo partido', () => {
    const byRound = new Map<number, Match[]>([
      [3, [mk({ id: 9, round: 3, home_team_id: 1, away_team_id: 2, status: 'postponed' })]],
    ]);
    // 4 libres (3,4,5,6): mejor candidata aunque el partido sea el postergado mismo
    expect(suggestMakeUpRound(byRound, [3], TODOS)).toBe(3);
  });
});
