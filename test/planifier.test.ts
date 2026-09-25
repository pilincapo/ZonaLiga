// Tests del planificador: bolsa única (zona + cruces), días únicos,
// un partido por equipo por día y slots sin forzar.

import { describe, expect, it } from 'vitest';
import { planFixture, verifyPlan, crossoverPoolFor, planSummary } from '../src/lib/planifier.ts';
import { EMPTY_SCHEDULE, type TournamentSchedule } from '../src/lib/schedule.ts';

function scheduleWith(venues: string[], kickoffs: string[], startDate = '2026-10-03', gap = 7): TournamentSchedule {
  return { ...EMPTY_SCHEDULE, venues, kickoffs, startDate, roundGapDays: gap };
}

const S = scheduleWith(['C1', 'C2', 'C3'], ['10:00', '11:00', '12:00', '13:00']); // 12 slots/día
// rng determinista para los tests.
const rng = () => 0.42;

const CONFIG_ZONAS = JSON.stringify({
  zones: { enabled: true, zones: [{ name: 'A', teamIds: [1, 2, 3, 4] }, { name: 'B', teamIds: [5, 6, 7, 8] }] },
  schedule: { startDate: '2026-10-03', roundGapDays: 7, playWeekday: 6, venues: ['C1', 'C2', 'C3'], kickoffs: ['10:00', '11:00', '12:00', '13:00'] },
});

const CONFIG_ZONAS_CRUCE = JSON.stringify({
  ...JSON.parse(CONFIG_ZONAS),
  crossover: [{ round: 5, rule: 'espejo', counts: false }],
});

describe('crossoverPoolFor', () => {
  it('sin cruces en la config, la bolsa de cruces es vacía', () => {
    expect(crossoverPoolFor({ configJson: CONFIG_ZONAS, teamIds: [1, 2, 3, 4, 5, 6, 7, 8], mode: 'single' })).toEqual([]);
  });

  it('con cruce espejo, genera un par por posición (4 vs 4)', () => {
    const pool = crossoverPoolFor({ configJson: CONFIG_ZONAS_CRUCE, teamIds: [1, 2, 3, 4, 5, 6, 7, 8], mode: 'single' });
    expect(pool).toHaveLength(4);
    for (const p of pool) {
      const enA = [1, 2, 3, 4].includes(p.home) || [1, 2, 3, 4].includes(p.away);
      const enB = [5, 6, 7, 8].includes(p.home) || [5, 6, 7, 8].includes(p.away);
      expect(enA && enB).toBe(true); // un equipo de cada zona
    }
  });

  it('sin 2 zonas declaradas, no hay cruces aunque la config los pida', () => {
    const solo = JSON.stringify({ crossover: [{ round: 2, rule: 'espejo', counts: false }] });
    expect(crossoverPoolFor({ configJson: solo, teamIds: [1, 2, 3], mode: 'single' })).toEqual([]);
  });
});

describe('planFixture', () => {
  it('planifica todos los partidos de zona sin postergados', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS, mode: 'single', schedule: S, rng });
    // 2 zonas de 4 => 2 fechas de zona por zona, 12 partidos en total.
    expect(plan.matches).toHaveLength(12);
    expect(plan.rounds).toBeGreaterThan(0);
    // Ningún partido sin día.
    expect(plan.matches.every((m) => m.day)).toBe(true);
  });

  it('los cruces entran a la bolsa y se planifican mezclados', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS_CRUCE, mode: 'single', schedule: S, rng });
    const cruces = plan.matches.filter((m) => m.kind === 'cruce');
    expect(cruces).toHaveLength(4);
    // Todos los cruces tienen día y slot asignados.
    expect(cruces.every((m) => m.day && m.venue && m.kickoff)).toBe(true);
  });

  it('ningún equipo juega dos veces el mismo día (regla dura)', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS_CRUCE, mode: 'single', schedule: S, rng });
    expect(() => verifyPlan(plan.matches, S)).not.toThrow();
  });

  it('capacidad chiquita: reparte en más días sin romper reglas', () => {
    // 1 cancha × 2 horarios = 2 slots/día con 12 partidos => 6+ días.
    const chico = scheduleWith(['C1'], ['10:00', '11:00']);
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS, mode: 'single', schedule: chico, rng });
    expect(plan.matches).toHaveLength(12);
    expect(plan.rounds).toBeGreaterThanOrEqual(6);
    const porDia = new Map<string, number>();
    for (const m of plan.matches) porDia.set(m.day, (porDia.get(m.day) ?? 0) + 1);
    for (const n of porDia.values()) expect(n).toBeLessThanOrEqual(2);
    expect(() => verifyPlan(plan.matches, chico)).not.toThrow();
  });

  it('cada fecha del fixture cae en un único día', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS, mode: 'single', schedule: S, rng });
    const diasPorFecha = new Map<number, Set<string>>();
    for (const m of plan.matches) {
      const s = diasPorFecha.get(m.fixtureRound) ?? new Set<string>();
      s.add(m.day);
      diasPorFecha.set(m.fixtureRound, s);
    }
    for (const [round, dias] of diasPorFecha) expect(dias.size, `fecha ${round}`).toBe(1);
  });

  it('sin zonas: círculo global con 6 equipos = 15 partidos', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6], configJson: '{}', mode: 'single', schedule: S, rng });
    expect(plan.matches).toHaveLength(15);
    expect(plan.matches.every((m) => m.kind === 'global')).toBe(true);
  });

  it('modo double duplica los partidos', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4], configJson: '{}', mode: 'double', schedule: S, rng });
    expect(plan.matches).toHaveLength(12); // 6 ida + 6 vuelta
  });

  it('resumen: conteos y rango de fechas libres', () => {
    const plan = planFixture({ teamIds: [1, 2, 3, 4, 5, 6, 7, 8], configJson: CONFIG_ZONAS_CRUCE, mode: 'single', schedule: S, rng });
    const resumen = planSummary(plan, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(resumen.total).toBe(16); // 12 zona + 4 cruce
    expect(resumen.cruces).toBe(4);
    expect(resumen.libresMax - resumen.libresMin).toBeLessThanOrEqual(1);
  });
});
