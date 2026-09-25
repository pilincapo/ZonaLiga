// Tests del orden de lectura de partidos: pseudoaleatorio estable por fecha.
// NO mira la hora: los horarios se asignan por zona, así que ordenar por hora
// reproducía el orden por zona (la A siempre arriba).

import { describe, expect, it } from 'vitest';
import { orderMatchesForDisplay } from '../src/lib/order.ts';
import type { Match } from '../src/lib/types.ts';

function mk(id: number, round: number, zone: string, kickoff = ''): Match {
  return {
    id,
    tournament_id: 1,
    round,
    zone,
    bracket_round: '',
    home_team_id: id * 2,
    away_team_id: id * 2 + 1,
    home_source: '',
    away_source: '',
    played_on: '2026-10-10',
    kickoff_time: kickoff,
    venue: '',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
  };
}

describe('orderMatchesForDisplay', () => {
  it('modo crono (default): ordena por hora y cancha, el cronograma del día', () => {
    const list = [
      { ...mk(2, 1, 'B', '12:00'), venue: 'Cancha 2' },
      { ...mk(1, 1, 'A', '12:00'), venue: 'Cancha 1' },
      { ...mk(4, 1, 'B', '10:00'), venue: 'Cancha 2' },
      { ...mk(3, 1, 'A', '10:00'), venue: 'Cancha 1' },
    ];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    expect(out.map((m) => `${m.kickoff_time}@${m.venue}`)).toEqual([
      '10:00@Cancha 1',
      '10:00@Cancha 2',
      '12:00@Cancha 1',
      '12:00@Cancha 2',
    ]);
  });

  it('modo crono: partidos sin hora van al final', () => {
    const list = [{ ...mk(1, 1, 'A', ''), venue: 'Cancha 1' }, { ...mk(2, 1, 'B', '10:00'), venue: 'Cancha 1' }];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    expect(out.map((m) => m.id)).toEqual([2, 1]);
  });

  it('modo mix: mezcla las zonas y no queda el orden de inserción', () => {
    const list = [mk(1, 1, 'A'), mk(2, 1, 'A'), mk(3, 1, 'B'), mk(4, 1, 'B')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1, mode: 'mix' });
    const ids = out.map((m) => m.id);
    expect(ids).not.toEqual([1, 2, 3, 4]);
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('modo mix: el orden es estable y distinto por fecha', () => {
    const mkRound = (round: number) => [mk(1, round, 'A'), mk(2, round, 'B'), mk(3, round, 'A'), mk(4, round, 'B')];
    const r1a = orderMatchesForDisplay(mkRound(1), { tournamentId: 5, round: 1, mode: 'mix' });
    const r1b = orderMatchesForDisplay(mkRound(1), { tournamentId: 5, round: 1, mode: 'mix' });
    expect(r1a.map((m) => m.id)).toEqual(r1b.map((m) => m.id));
    const r2 = orderMatchesForDisplay(mkRound(2), { tournamentId: 5, round: 2, mode: 'mix' }).map((m) => m.id);
    expect(r1a.map((m) => m.id)).not.toEqual(r2);
  });

  it('lista vacía o de un solo partido: no explota', () => {
    expect(orderMatchesForDisplay([], { tournamentId: 1, round: 1 })).toEqual([]);
    expect(orderMatchesForDisplay([mk(1, 1, 'A')], { tournamentId: 1, round: 1 })).toHaveLength(1);
  });
});
