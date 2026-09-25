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
  it('mezcla las zonas: no siempre queda primero el partido de menor id', () => {
    const list = [mk(1, 1, 'A'), mk(2, 1, 'A'), mk(3, 1, 'B'), mk(4, 1, 'B')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    const ids = out.map((m) => m.id);
    expect(ids).not.toEqual([1, 2, 3, 4]); // ya no es el orden de inserción
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]); // no pierde ninguno
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
    expect(r1).not.toEqual(r2);
  });

  it('no respeta la hora: partidos con horarios distintos también se mezclan', () => {
    // El caso real del torneo: zona A a las 12:00, zona B a las 15:00.
    // Antes (orden por hora) quedaba A arriba y B abajo siempre.
    const list = [mk(1, 1, 'A', '12:00'), mk(2, 1, 'A', '12:00'), mk(3, 1, 'B', '15:00'), mk(4, 1, 'B', '15:00')];
    const out = orderMatchesForDisplay(list, { tournamentId: 1, round: 1 });
    const zonas = out.map((m) => m.zone);
    expect(zonas).not.toEqual(['A', 'A', 'B', 'B']); // mezclado real
  });

  it('lista vacía o de un solo partido: no explota', () => {
    expect(orderMatchesForDisplay([], { tournamentId: 1, round: 1 })).toEqual([]);
    expect(orderMatchesForDisplay([mk(1, 1, 'A')], { tournamentId: 1, round: 1 })).toHaveLength(1);
  });
});
