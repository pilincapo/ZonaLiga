// Tests de excedentes (partidos que no entran en las canchas) y del plan de
// reposición que los junta al final del torneo.

import { describe, expect, it } from 'vitest';
import {
  buildMakeUpPlan,
  keepCount,
  makeUpRoundNumber,
  overflowOfRound,
  pickDeferred,
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

describe('pickDeferred (reparto equilibrado)', () => {
  const rngFijo = () => 0; // siempre el primero del pool: determinista
  // Alterna entre el principio y el final del pool (reparto parejo reproducible).
  const alternado = (() => {
    let n = 0;
    return () => (n++ % 2 === 0 ? 0 : 0.99);
  })();

  it('posterga exactamente la cantidad pedida', () => {
    const load = new Map();
    const ms = Array.from({ length: 10 }, (_, i) => ({ home: i + 1, away: i + 11 }));
    const deferred = pickDeferred(ms, 4, load, rngFijo);
    expect(deferred.size).toBe(4);
  });

  it('equilibra por equipo: nadie posterga dos veces si hay otros con menos carga', () => {
    const load = new Map();
    const ms = [
      { home: 1, away: 2 }, { home: 3, away: 4 }, { home: 5, away: 6 }, { home: 7, away: 8 },
      { home: 9, away: 10 }, { home: 11, away: 12 },
    ];
    // Fecha 1: postergan 3 partidos (6 equipos con carga 1).
    const d1 = pickDeferred(ms, 3, load, rngFijo);
    expect(d1.size).toBe(3);
    // Fecha 2: con 6 equipos ya en carga 1, elige entre los de carga 0.
    const d2 = pickDeferred(ms, 3, load, rngFijo);
    expect(d2.size).toBe(3);
    // Los conjuntos no comparten partidos (todos con carga previa 0).
    for (const i of d1) expect(d2.has(i)).toBe(false);
    // Cargas: 6 equipos con 1 y 6 con 1 → todos con exactamente 1.
    expect(new Set(load.values())).toEqual(new Set([1]));
  });

  it('reparte entre zonas: posterga de las dos listas, no de una sola', () => {
    // Simula el bug viejo: si el orden pone toda la zona A primero, el
    // recorte "últimos" caía siempre en la B. El selector equilibra.
    const load = new Map();
    const zonaA = Array.from({ length: 11 }, (_, i) => ({ home: i + 1, away: ((i + 1) % 11) + 1 }));
    const zonaB = Array.from({ length: 11 }, (_, i) => ({ home: i + 100, away: ((i + 1) % 11) + 100 }));
    const all = [...zonaA, ...zonaB];
    const deferred = pickDeferred(all, 14, load, alternado);
    const enA = [...deferred].filter((i) => i < 11).length;
    const enB = [...deferred].filter((i) => i >= 11).length;
    // Con carga inicial pareja y todos los partidos con carga 0, el pool son
    // todos: el reparto es aleatorio pero cubre ambas zonas (no 11 y 3).
    expect(enA).toBeGreaterThan(3);
    expect(enB).toBeGreaterThan(3);
  });

  it('sin excedente no posterga nada', () => {
    const load = new Map();
    const d = pickDeferred([{ home: 1, away: 2 }], 0, load, rngFijo);
    expect(d.size).toBe(0);
    expect(load.size).toBe(0);
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
