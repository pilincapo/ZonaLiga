// Tests Fase 11B: generador de fixture por grupos (FASE_DE_GRUPOS y
// GRUPOS_PLAYOFFS). Cubre: distribución en grupos, round-robin independiente
// por grupo, 1 y 2 ruedas, impar con descansos, sin repetidos ni autogoles,
// un partido por equipo por fecha y respeto de la config de localía.
import { describe, expect, it } from 'vitest';
import { planFixture, verifyPlan } from '../src/lib/planifier.ts';
import { EMPTY_SCHEDULE, type TournamentSchedule } from '../src/lib/schedule.ts';
import { distributeGroups } from '../src/lib/competition.ts';
import type { PlannedMatch } from '../src/lib/planifier.ts';

const S: TournamentSchedule = {
  ...EMPTY_SCHEDULE,
  startDate: '2026-10-03',
  venues: ['C1', 'C2', 'C3'],
  kickoffs: ['10:00', '11:00', '12:00', '13:00'],
};

const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

interface GroupPlanInput {
  teamCount: number;
  groupCount: number;
  wheels: 1 | 2;
  format: 'FASE_DE_GRUPOS' | 'GRUPOS_PLAYOFFS';
}

function planGroups(opts: GroupPlanInput): { matches: PlannedMatch[]; groups: { name: string; teamIds: number[] }[] } {
  const groups = distributeGroups(ids(opts.teamCount), opts.groupCount);
  const matches = planFixture({
    teamIds: ids(opts.teamCount),
    configJson: '{}',
    mode: opts.wheels === 2 ? 'double' : 'single',
    competitionFormat: opts.format,
    groups,
    groupStageWheels: opts.wheels,
    schedule: S,
    rng: () => 0.5,
  }).matches;
  return { matches, groups };
}

const nameOf = (g: { name: string }): string => g.name;

describe('Fase 11B: distributeGroups', () => {
  it('reparte 8 equipos en 2 grupos de 4', () => {
    const groups = distributeGroups(ids(8), 2);
    expect(groups.map(nameOf)).toEqual(['A', 'B']);
    expect(groups[0]!.teamIds.length).toBe(4);
    expect(groups[1]!.teamIds.length).toBe(4);
    // Sin superposición: todos los equipos aparecen una sola vez.
    const all = groups.flatMap((g) => g.teamIds);
    expect(new Set(all).size).toBe(8);
    expect([...all].sort((a, b) => a - b)).toEqual(ids(8));
  });

  it('reparto serpentina: grupo A toma el 1º y el 4º, B el 2º y el 3º', () => {
    const groups = distributeGroups([1, 2, 3, 4], 2);
    expect(groups[0]!.teamIds).toEqual([1, 4]);
    expect(groups[1]!.teamIds).toEqual([2, 3]);
  });

  it('con reparto desparejo (7 en 2 grupos): tamaños 4 y 3', () => {
    const groups = distributeGroups(ids(7), 2);
    const sizes = groups.map((g) => g.teamIds.length).sort((a, b) => b - a);
    expect(sizes).toEqual([4, 3]);
    const all = groups.flatMap((g) => g.teamIds);
    expect(new Set(all).size).toBe(7);
  });

  it('cantidad inválida devuelve vacío', () => {
    expect(distributeGroups(ids(4), 0)).toEqual([]);
    expect(distributeGroups([1], 2)).toEqual([]);
  });
});

describe('Fase 11B: fixture por grupo (1 rueda)', () => {
  it('8 equipos en 2 grupos: 12 partidos (2 × C(4,2))', () => {
    const { matches } = planGroups({ teamCount: 8, groupCount: 2, wheels: 1, format: 'FASE_DE_GRUPOS' });
    expect(matches.length).toBe(12);
    // Cada partido es de su grupo (zona = nombre del grupo).
    for (const m of matches) {
      expect(m.zone === 'A' || m.zone === 'B').toBe(true);
    }
  });

  it('cada pareja juega una vez DENTRO de su grupo', () => {
    const { matches, groups } = planGroups({ teamCount: 8, groupCount: 2, wheels: 1, format: 'FASE_DE_GRUPOS' });
    for (const g of groups) {
      const delGrupo = matches.filter((m) => m.zone === g.name);
      const pairs = delGrupo.map((m) => [m.home, m.away].sort((a, b) => a - b).join('-'));
      expect(new Set(pairs).size).toBe(pairs.length);
      // Solo equipos del grupo.
      const set = new Set(g.teamIds);
      for (const m of delGrupo) {
        expect(set.has(m.home)).toBe(true);
        expect(set.has(m.away)).toBe(true);
      }
    }
  });

  it('nunca se cruzan equipos de grupos distintos', () => {
    const { matches, groups } = planGroups({ teamCount: 8, groupCount: 2, wheels: 1, format: 'FASE_DE_GRUPOS' });
    const zoneOf = new Map<number, string>();
    for (const g of groups) for (const id of g.teamIds) zoneOf.set(id, g.name);
    for (const m of matches) {
      expect(zoneOf.get(m.home)).toBe(zoneOf.get(m.away));
    }
  });
});

describe('Fase 11B: fixture por grupo (2 ruedas)', () => {
  it('8 equipos en 2 grupos con 2 ruedas: 24 partidos, localía invertida', () => {
    const { matches } = planGroups({ teamCount: 8, groupCount: 2, wheels: 2, format: 'FASE_DE_GRUPOS' });
    expect(matches.length).toBe(24);
    // Cada pareja de grupo se cruza 2 veces con localías distintas.
    const seen = new Map<string, Set<number>>();
    for (const m of matches) {
      const key = [m.home, m.away].sort((a, b) => a - b).join('-');
      const locals = seen.get(key) ?? new Set<number>();
      locals.add(m.home);
      seen.set(key, locals);
    }
    for (const [, locals] of seen) expect(locals.size).toBe(2);
  });

  it('1 rueda es el default: wheels=1 da la mitad que 2', () => {
    const una = planGroups({ teamCount: 8, groupCount: 2, wheels: 1, format: 'GRUPOS_PLAYOFFS' });
    const dos = planGroups({ teamCount: 8, groupCount: 2, wheels: 2, format: 'GRUPOS_PLAYOFFS' });
    expect(una.matches.length * 2).toBe(dos.matches.length);
  });
});

describe('Fase 11B: impar, descansos y fechas', () => {
  it('grupos de 3 y 4 (7 equipos): cada grupo respeta su impar con descanso', () => {
    const { matches } = planGroups({ teamCount: 7, groupCount: 2, wheels: 1, format: 'FASE_DE_GRUPOS' });
    // C(4,2)=6 + C(3,2)=3 = 9 partidos.
    expect(matches.length).toBe(9);
  });

  it('ningún equipo juega dos veces la misma fecha (2 grupos intercalados)', () => {
    for (const wheels of [1, 2] as const) {
      const { matches } = planGroups({ teamCount: 8, groupCount: 2, wheels, format: 'FASE_DE_GRUPOS' });
      const byRound = new Map<number, PlannedMatch[]>();
      for (const m of matches) {
        const arr = byRound.get(m.fixtureRound) ?? [];
        arr.push(m);
        byRound.set(m.fixtureRound, arr);
      }
      for (const [round, list] of byRound) {
        const seen = new Set<number>();
        for (const m of list) {
          expect(seen.has(m.home), `equipo ${m.home} repetido en fecha ${round}`).toBe(false);
          expect(seen.has(m.away), `equipo ${m.away} repetido en fecha ${round}`).toBe(false);
          seen.add(m.home);
          seen.add(m.away);
        }
      }
    }
  });

  it('verifyPlan no lanza con los planes de grupos', () => {
    for (const wheels of [1, 2] as const) {
      const { matches } = planGroups({ teamCount: 8, groupCount: 2, wheels, format: 'GRUPOS_PLAYOFFS' });
      expect(() => verifyPlan(matches, S)).not.toThrow();
    }
  });
});
