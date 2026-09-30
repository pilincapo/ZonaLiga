// Tests Fase 11A: generador de fixture todos contra todos según la
// configuración de competencia (TODOS_CONTRA_TODOS, UNA_RUEDA, DOS_RUEDAS).
// Cubre: cantidad de fechas/partidos, impar con descansos, sin partidos de un
// equipo contra sí mismo, sin cruces duplicados, un partido por equipo por
// fecha, ruedas con localía invertida y formato que manda sobre el mode.
import { describe, expect, it } from 'vitest';
import { planFixture, verifyPlan } from '../src/lib/planifier.ts';
import { EMPTY_SCHEDULE, type TournamentSchedule } from '../src/lib/schedule.ts';
import type { PlannedMatch } from '../src/lib/planifier.ts';

// Schedule con fecha de inicio: sin startDate no hay días y el plan sale vacío.
const S: TournamentSchedule = {
  ...EMPTY_SCHEDULE,
  startDate: '2026-10-03',
  venues: ['C1', 'C2', 'C3'],
  kickoffs: ['10:00', '11:00', '12:00', '13:00'],
};

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

function plan(teamCount: number, competitionFormat: string, mode: 'single' | 'double' = 'single'): PlannedMatch[] {
  return planFixture({
    teamIds: ids(teamCount),
    configJson: '{}',
    mode,
    competitionFormat,
    schedule: S,
    rng: () => 0.5,
  }).matches;
}

describe('Fase 11A: UNA_RUEDA', () => {
  it('con 6 equipos genera 15 partidos (una sola vuelta), empaquetados en fechas sin repetir equipo', () => {
    const ms = plan(6, 'UNA_RUEDA');
    expect(ms.length).toBe(15);
    // Cada pareja se cruza una vez.
    const pairs = ms.map((m) => [m.home, m.away].sort((a, b) => a - b).join('-'));
    expect(new Set(pairs).size).toBe(15);
  });

  it('nadie juega dos veces en la misma fecha y nadie juega contra sí mismo', () => {
    for (const count of [4, 6, 8, 10]) {
      const ms = plan(count, 'UNA_RUEDA');
      const byRound = new Map<number, PlannedMatch[]>();
      for (const m of ms) {
        const arr = byRound.get(m.fixtureRound) ?? [];
        arr.push(m);
        byRound.set(m.fixtureRound, arr);
      }
      for (const [round, list] of byRound) {
        const seen = new Set<number>();
        for (const m of list) {
          expect(m.home).not.toBe(m.away);
          for (const id of [m.home, m.away]) {
            expect(seen.has(id), `equipo ${id} repetido en fecha ${round}`).toBe(false);
            seen.add(id);
          }
        }
      }
    }
  });

  it('cada pareja juega exactamente una vez (sin duplicados)', () => {
    const ms = plan(8, 'UNA_RUEDA');
    const pairs = ms.map((m) => [m.home, m.away].sort((a, b) => a - b).join('-'));
    expect(new Set(pairs).size).toBe(ms.length);
    // C(8,2) = 28 partidos.
    expect(ms.length).toBe(28);
  });

  it('con impar (7) hay descanso: 21 partidos, máximo 3 por fecha, nadie 2 veces el mismo día', () => {
    const ms = plan(7, 'UNA_RUEDA');
    expect(ms.length).toBe(21); // C(7,2)
    const byRound = new Map<number, PlannedMatch[]>();
    for (const m of ms) {
      const arr = byRound.get(m.fixtureRound) ?? [];
      arr.push(m);
      byRound.set(m.fixtureRound, arr);
    }
    for (const [, list] of byRound) {
      expect(list.length).toBeLessThanOrEqual(3); // 7 impar: 3 partidos + 1 libre
      const seen = new Set<number>();
      for (const m of list) {
        expect(seen.has(m.home)).toBe(false);
        expect(seen.has(m.away)).toBe(false);
        seen.add(m.home);
        seen.add(m.away);
      }
    }
  });
});

describe('Fase 11A: DOS_RUEDAS y TODOS_CONTRA_TODOS', () => {
  it('DOS_RUEDAS con 6 equipos duplica: 30 partidos', () => {
    const ms = plan(6, 'DOS_RUEDAS');
    expect(ms.length).toBe(30);
    // Cada pareja se cruza exactamente 2 veces.
    const pairs = ms.map((m) => [m.home, m.away].sort((a, b) => a - b).join('-'));
    expect(new Set(pairs).size).toBe(15);
    const counts = new Map<string, number>();
    for (const p of pairs) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const [, c] of counts) expect(c).toBe(2);
  });

  it('TODOS_CONTRA_TODOS equivale a DOS_RUEDAS (ida y vuelta)', () => {
    expect(plan(6, 'TODOS_CONTRA_TODOS').length).toBe(plan(6, 'DOS_RUEDAS').length);
  });

  it('segunda rueda invierte localía de cada pareja', () => {
    const ms = plan(6, 'DOS_RUEDAS');
    // Clave de pareja ordenada → set de locales que vio.
    const seen = new Map<string, Set<number>>();
    for (const m of ms) {
      const key = [m.home, m.away].sort((a, b) => a - b).join('-');
      const set = seen.get(key) ?? new Set<number>();
      set.add(m.home);
      seen.set(key, set);
    }
    // Cada pareja se cruzó 2 veces con localías distintas.
    for (const [, locals] of seen) {
      expect(locals.size).toBe(2);
    }
  });

  it('UNA_RUEDA con mode=double del form igual genera una vuelta (formato manda)', () => {
    expect(plan(6, 'UNA_RUEDA', 'double').length).toBe(15);
  });

  it('DOS_RUEDAS con mode=single del form igual genera dos vueltas', () => {
    expect(plan(6, 'DOS_RUEDAS', 'single').length).toBe(30);
  });

  it('sin formato nuevo, el mode del form sigue mandando (compatibilidad)', () => {
    expect(plan(6, '', 'single').length).toBe(15);
    expect(plan(6, '', 'double').length).toBe(30);
  });
});

describe('Fase 11A: verificación dura del plan', () => {
  it('verifyPlan no lanza con los planes de los tres formatos', () => {
    for (const format of ['UNA_RUEDA', 'DOS_RUEDAS', 'TODOS_CONTRA_TODOS']) {
      for (const count of [4, 7, 8]) {
        expect(() => verifyPlan(plan(count, format), S)).not.toThrow();
      }
    }
  });

  it('todos los partidos usan solo equipos participantes', () => {
    const ms = plan(6, 'DOS_RUEDAS');
    for (const m of ms) {
      expect(m.home).toBeLessThanOrEqual(6);
      expect(m.away).toBeLessThanOrEqual(6);
      expect(m.home).toBeGreaterThan(0);
      expect(m.away).toBeGreaterThan(0);
    }
  });
});
