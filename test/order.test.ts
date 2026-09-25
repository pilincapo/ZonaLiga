// Tests del orden de lectura de partidos: pseudoaleatorio estable por fecha.
// El cronograma (hora) manda; el azar estable solo desempata la misma hora,
// para que no encabece siempre la misma zona.

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
  it('mezcla las zonas: no siempre queda primero el partido de menor id', () => {
    // Fecha con 4 partidos insertados por zona: A(1,2) y B(3,4), misma hora.
    const list = [mk(1, 1, 'A', '10:00'), mk(2, 1, 'A', '10:00'), mk(3, 1, 'B', '10:00'), mk(4, 1, 'B', '10:00')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    const ids = out.map((m) => m.id);
    // Deja de ser el orden de inserción (1,2,3,4).
    expect(ids).not.toEqual([1, 2, 3, 4]);
    // No pierde ningún partido.
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('el orden es estable: la misma fecha siempre se ve igual', () => {
    const list = [mk(1, 2, 'A'), mk(2, 2, 'B'), mk(3, 2, 'A'), mk(4, 2, 'B')];
    const a = orderMatchesForDisplay(list, { tournamentId: 7, round: 2 });
    const b = orderMatchesForDisplay(list, { tournamentId: 7, round: 2 });
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it('distintas fechas del mismo torneo mezclan distinto', () => {
    const mkRound = (round: number) => [mk(1, round, 'A'), mk(2, round, 'B'), mk(3, round, 'A'), mk(4, round, 'B')];
    const r1 = orderMatchesForDisplay(mkRound(1), { tournamentId: 5, round: 1 }).map((m) => m.id);
    const r2 = orderMatchesForDisplay(mkRound(2), { tournamentId: 5, round: 2 }).map((m) => m.id);
    // Con seeds distintos por fecha, es muy improbable que ambas fechas
    // queden en el mismo orden (probabilidad 1/24 por coincidencia).
    expect(r1).not.toEqual(r2);
  });

  it('la hora manda: el cronograma del día se respeta aunque haya mezcla', () => {
    const list = [mk(1, 1, 'A', '12:00'), mk(2, 1, 'B', '10:00'), mk(3, 1, 'A', '11:00')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    expect(out.map((m) => m.id)).toEqual([2, 3, 1]); // 10:00, 11:00, 12:00
  });

  it('sin hora: solo azar estable desempata (no explota con strings vacíos)', () => {
    const list = [mk(1, 1, 'A'), mk(2, 1, 'B')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    expect(out).toHaveLength(2);
  });
});
