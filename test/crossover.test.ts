// Tests de la fecha de cruce entre zonas: reglas de emparejamiento según la
// tabla, config persistida y filtrado de tabla.

import { describe, expect, it } from 'vitest';
import {
  buildCrossoverPairs,
  crossoverRoundsOf,
  matchesForStandings,
  parseCrossoverConfig,
  parseCrossoverRule,
} from '../src/lib/crossover.ts';
import { regeneratePairings, verifyPairings } from '../src/lib/fixture.ts';
import { EMPTY_SCHEDULE } from '../src/lib/schedule.ts';
import type { Match, StandingRow } from '../src/lib/types.ts';

const row = (teamId: number, points: number): StandingRow => ({
  teamId,
  played: 4,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  diff: 0,
  points,
});

describe('buildCrossoverPairs', () => {
  const A = [row(1, 12), row(2, 9), row(3, 6), row(4, 3)]; // 1º..4º de la zona A
  const B = [row(5, 12), row(6, 9), row(7, 6), row(8, 3)]; // 1º..4º de la zona B

  it('espejo: primero contra primero, segundo contra segundo…', () => {
    const { pairs } = buildCrossoverPairs(A, B, 'espejo');
    expect(pairs.map((p) => [p.home, p.away])).toEqual([
      [1, 5],
      [6, 2],
      [3, 7],
      [8, 4],
    ]); // localía alternada: impares de A son locales
    expect(pairs.every((p) => p.posA === p.posB)).toBe(true);
  });

  it('invertido: primero de A contra último de B', () => {
    const { pairs } = buildCrossoverPairs(A, B, 'invertido');
    expect(pairs[0]).toMatchObject({ home: 1, away: 8 }); // 1ºA local vs último B
    expect(pairs[1]).toMatchObject({ home: 7, away: 2 }); // anteúltimo B local vs 2ºA
    // El rival de cada equipo de A es el espejo en la tabla de B.
    const rivalesDe = new Map<number, number>();
    for (const p of pairs) {
      rivalesDe.set(p.home, p.away);
      rivalesDe.set(p.away, p.home);
    }
    expect(rivalesDe.get(1)).toBe(8); // 1ºA ↔ último B
    expect(rivalesDe.get(4)).toBe(5); // último A ↔ 1ºB
  });

  it('cruzado: 1ºA vs 2ºB y 2ºA vs 1ºB', () => {
    const { pairs } = buildCrossoverPairs(A, B, 'cruzado');
    const flat = pairs.map((p) => `${p.home}-${p.away}`);
    expect(flat).toContain('1-6'); // 1ºA local vs 2ºB
    expect(flat).toContain('5-2'); // 1ºB local vs 2ºA
    // Nadie se repite: 8 equipos, 4 pares sin repetir equipo.
    const ids = pairs.flatMap((p) => [p.home, p.away]);
    expect(new Set(ids).size).toBe(8);
  });

  it('zonas desparejas: los sobrantes libran', () => {
    const { pairs, unpaired } = buildCrossoverPairs(A, B.slice(0, 2), 'espejo');
    expect(pairs.length).toBe(2);
    expect(unpaired.sort()).toEqual([3, 4]); // 3º y 4º de A sin rival
  });

  it('nadie juega contra un compañero de su propia zona', () => {
    for (const rule of ['espejo', 'invertido', 'cruzado'] as const) {
      const { pairs } = buildCrossoverPairs(A, B, rule);
      const inA = pairs.filter((p) => A.some((r) => r.teamId === p.home) && A.some((r) => r.teamId === p.away));
      expect(inA.length).toBe(0);
    }
  });
});

describe('parseCrossoverConfig / crossoverRoundsOf', () => {
  it('lee la config guardada y tolera configs viejos', () => {
    expect(parseCrossoverConfig('{}')).toEqual([]);
    expect(parseCrossoverConfig('no-json')).toEqual([]);
    const cfg = JSON.stringify({ crossover: [{ round: 8, rule: 'invertido', counts: false }] });
    expect(parseCrossoverConfig(cfg)).toEqual([{ round: 8, rule: 'invertido', counts: false }]);
    expect(crossoverRoundsOf(cfg)).toEqual(new Set([8]));
    expect(crossoverRoundsOf(cfg, true)).toEqual(new Set([8])); // no cuenta => excluida
    const cfgCounts = JSON.stringify({ crossover: [{ round: 8, rule: 'espejo', counts: true }] });
    expect(crossoverRoundsOf(cfgCounts, true)).toEqual(new Set());
    expect(crossoverRoundsOf(cfgCounts)).toEqual(new Set([8]));
  });

  it('parseCrossoverRule acepta las 3 reglas y usa espejo por defecto', () => {
    expect(parseCrossoverRule('invertido')).toBe('invertido');
    expect(parseCrossoverRule('cruzado')).toBe('cruzado');
    expect(parseCrossoverRule('espejo')).toBe('espejo');
    expect(parseCrossoverRule('otra')).toBe('espejo');
    expect(parseCrossoverRule(undefined)).toBe('espejo');
  });
});

describe('matchesForStandings', () => {
  const mk = (id: number, round: number, status: Match['status']): Match => ({
    id,
    tournament_id: 1,
    round,
    zone: '',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-01-01',
    kickoff_time: '',
    venue: '',
    status,
    home_goals: 1,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
  });

  it('excluye los cruces que no cuentan y conserva el resto', () => {
    const cfg = JSON.stringify({ crossover: [{ round: 8, rule: 'espejo', counts: false }] });
    const matches = [mk(1, 1, 'played'), mk(2, 8, 'played')];
    const filtered = matchesForStandings(matches, cfg);
    expect(filtered.map((m) => m.id)).toEqual([1]);
    // Si el cruce cuenta, no se excluye.
    const cfgCounts = JSON.stringify({ crossover: [{ round: 8, rule: 'espejo', counts: true }] });
    expect(matchesForStandings(matches, cfgCounts).length).toBe(2);
  });
});

describe('regeneración y verificación con fechas de cruce', () => {
  const mk = (id: number, round: number, status: Match['status'], home: number, away: number): Match => ({
    id,
    tournament_id: 1,
    round,
    zone: '',
    bracket_round: '',
    home_team_id: home,
    away_team_id: away,
    home_source: '',
    away_source: '',
    played_on: '',
    kickoff_time: '',
    venue: '',
    status,
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
  });

  it('regeneratePairings conserva los partidos de la fecha de cruce aunque estén pendientes', () => {
    const existing = [mk(1, 1, 'scheduled', 1, 2), mk(2, 8, 'scheduled', 3, 4)];
    const plan = regeneratePairings({
      existing,
      activeTeamIds: [1, 2, 3, 4],
      mode: 'single',
      schedule: EMPTY_SCHEDULE,
      crossovers: [{ round: 8, rule: 'espejo', counts: false }],
    });
    expect(plan.keptMatchIds).toContain(2); // el cruce se conserva
    expect(plan.removeMatchIds).toEqual([1]); // lo pendiente normal se rearma
    expect(plan.create.every((m) => m.round !== 8)).toBe(true); // nadie se crea en la fecha de cruce
  });

  it('verifyPairings no marca como error los cruces entre zonas en una fecha de cruce', () => {
    // El mismo cruce 1-2 aparece dos veces: una en fecha de cruce, otra normal.
    const matches = [mk(1, 8, 'scheduled', 1, 2), mk(2, 1, 'scheduled', 2, 1)];
    expect(verifyPairings(matches, 'single', undefined, new Set([8]))).toEqual([]);
    // Sin registrar la fecha de cruce, sí se reporta el repetido.
    expect(verifyPairings(matches, 'single', undefined, new Set()).length).toBeGreaterThan(0);
  });
});
