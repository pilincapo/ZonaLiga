// Tests Fase 11C: generador de llaves de playoffs (buildBracketPlan).
// Cubre: validación de la instancia inicial (R16=16, QF=8, SF=4, F=2),
// emparejamiento espejo, ida y vuelta con localía invertida, tercer puesto,
// orígenes W/L entre rondas, clasificados de grupos con cruce cruzado
// (1.ºA vs 2.ºB y 1.ºB vs 2.ºA), y registro en config.
import { describe, expect, it } from 'vitest';
import {
  buildBracketPlan,
  entrantsFromGroupTables,
  entrantsFromTable,
  bracketHasPlayed,
  parseBracketConfig,
  bracketConfigJson,
} from '../src/lib/playoffsBracket.ts';

describe('Fase 11C: buildBracketPlan', () => {
  it('semifinales con 4 equipos: 2 SF + final (partido único)', () => {
    const slots = buildBracketPlan({ start: 'SF', entrants: [1, 2, 3, 4], startRound: 5, singleMatch: true, thirdPlace: false });
    expect(slots).toHaveLength(3);
    // Espejo: 1.º vs 4.º y 2.º vs 3.º.
    expect(slots[0]).toMatchObject({ bracket_round: 'SF', home: 1, away: 4, round: 5, tie: 1 });
    expect(slots[1]).toMatchObject({ bracket_round: 'SF', home: 2, away: 3, round: 5, tie: 2 });
    // Final con orígenes de ganadores.
    expect(slots[2]).toMatchObject({ bracket_round: 'F', home: null, away: null, home_source: 'WSF1', away_source: 'WSF2', round: 6 });
  });

  it('final con 2 equipos: solo la final', () => {
    const slots = buildBracketPlan({ start: 'F', entrants: [7, 8], startRound: 3, singleMatch: true, thirdPlace: false });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ bracket_round: 'F', home: 7, away: 8, round: 3 });
  });

  it('cuartos con 8 equipos: 4 QF + 2 SF + final', () => {
    const slots = buildBracketPlan({
      start: 'QF',
      entrants: [1, 2, 3, 4, 5, 6, 7, 8],
      startRound: 10,
      singleMatch: true,
      thirdPlace: false,
    });
    expect(slots.filter((s) => s.bracket_round === 'QF')).toHaveLength(4);
    expect(slots.filter((s) => s.bracket_round === 'SF')).toHaveLength(2);
    expect(slots.filter((s) => s.bracket_round === 'F')).toHaveLength(1);
    // Fechas: QF=10, SF=11, F=12 (partido único: una fecha por ronda).
    expect([...new Set(slots.filter((s) => s.bracket_round === 'QF').map((s) => s.round))]).toEqual([10]);
    expect([...new Set(slots.filter((s) => s.bracket_round === 'SF').map((s) => s.round))]).toEqual([11]);
    expect([...new Set(slots.filter((s) => s.bracket_round === 'F').map((s) => s.round))]).toEqual([12]);
  });

  it('octavos con 16 equipos: 8 R16 + 4 QF + 2 SF + final', () => {
    const entrants = Array.from({ length: 16 }, (_, i) => i + 1);
    const slots = buildBracketPlan({ start: 'R16', entrants, startRound: 1, singleMatch: true, thirdPlace: false });
    expect(slots).toHaveLength(15);
    expect(slots.filter((s) => s.bracket_round === 'R16')).toHaveLength(8);
    expect(slots.filter((s) => s.bracket_round === 'QF')).toHaveLength(4);
    expect(slots.filter((s) => s.bracket_round === 'SF')).toHaveLength(2);
    expect(slots.filter((s) => s.bracket_round === 'F')).toHaveLength(1);
  });

  it('rechaza cantidad incompatible con la instancia inicial', () => {
    expect(() => buildBracketPlan({ start: 'SF', entrants: [1, 2, 3], startRound: 1, singleMatch: true, thirdPlace: false })).toThrow(/necesita 4/);
    expect(() => buildBracketPlan({ start: 'QF', entrants: [1, 2, 3, 4, 5], startRound: 1, singleMatch: true, thirdPlace: false })).toThrow(/necesita 8/);
    expect(() => buildBracketPlan({ start: 'R16', entrants: [1, 2], startRound: 1, singleMatch: true, thirdPlace: false })).toThrow(/necesita 16/);
    expect(() => buildBracketPlan({ start: 'F', entrants: [1], startRound: 1, singleMatch: true, thirdPlace: false })).toThrow(/necesita 2/);
  });

  it('rechaza equipos repetidos', () => {
    expect(() => buildBracketPlan({ start: 'SF', entrants: [1, 2, 3, 3], startRound: 1, singleMatch: true, thirdPlace: false })).toThrow(/repetidos/);
  });

  it('ida y vuelta: cada llave tiene ida y revancha con localía invertida', () => {
    const slots = buildBracketPlan({ start: 'SF', entrants: [1, 2, 3, 4], startRound: 5, singleMatch: false, thirdPlace: false });
    expect(slots).toHaveLength(6); // 2 SF × 2 + final × 2
    const sf1 = slots.filter((s) => s.bracket_round === 'SF' && s.tie === 1);
    expect(sf1).toHaveLength(2);
    // Ida: 1 local; revancha: invertida.
    expect(sf1[0]).toMatchObject({ home: 1, away: 4, round: 5, leg: 1 });
    expect(sf1[1]).toMatchObject({ home: 4, away: 1, round: 6, leg: 2 });
    // La final también es ida/vuelta con orígenes invertidos.
    const fin = slots.filter((s) => s.bracket_round === 'F');
    expect(fin[0]).toMatchObject({ home_source: 'WSF1', away_source: 'WSF2', round: 7 });
    expect(fin[1]).toMatchObject({ home_source: 'WSF2', away_source: 'WSF1', round: 8 });
  });

  it('tercer puesto: perdedores de semis el día de la final', () => {
    const slots = buildBracketPlan({ start: 'SF', entrants: [1, 2, 3, 4], startRound: 5, singleMatch: true, thirdPlace: true });
    expect(slots).toHaveLength(4);
    const tp = slots.find((s) => s.bracket_round === '3P')!;
    expect(tp).toMatchObject({ home_source: 'LSF1', away_source: 'LSF2', round: 6 });
  });

  it('tercer puesto rechazado con instancia inicial = final', () => {
    expect(() => buildBracketPlan({ start: 'F', entrants: [1, 2], startRound: 1, singleMatch: true, thirdPlace: true })).toThrow(/tercer puesto/);
  });

  it('tercer puesto con ida y vuelta: partido único en la fecha de la final', () => {
    const slots = buildBracketPlan({ start: 'SF', entrants: [1, 2, 3, 4], startRound: 5, singleMatch: false, thirdPlace: true });
    const tp = slots.filter((s) => s.bracket_round === '3P');
    expect(tp).toHaveLength(1); // no tiene revancha
    expect(tp[0]!.round).toBe(7); // misma fecha que la final de ida
  });
});

describe('Fase 11C: clasificados', () => {
  it('grupos: cruce cruzado 1.ºA vs 2.ºB y 1.ºB vs 2.ºA con el emparejamiento espejo', () => {
    // Grupos A y B con 4 equipos cada uno, ordenados por posición.
    const tables = [
      { name: 'A', rows: [{ teamId: 1 }, { teamId: 2 }, { teamId: 3 }, { teamId: 4 }] },
      { name: 'B', rows: [{ teamId: 5 }, { teamId: 6 }, { teamId: 7 }, { teamId: 8 }] },
    ];
    const entrants = entrantsFromGroupTables(tables, 2);
    expect(entrants).toEqual([1, 5, 2, 6]);
    const slots = buildBracketPlan({ start: 'SF', entrants, startRound: 3, singleMatch: true, thirdPlace: false });
    // Espejo: entrants[0] vs entrants[3] = 1.ºA vs 2.ºB; entrants[1] vs entrants[2] = 1.ºB vs 2.ºA.
    expect(slots[0]).toMatchObject({ home: 1, away: 6 }); // 1.ºA vs 2.ºB
    expect(slots[1]).toMatchObject({ home: 5, away: 2 }); // 1.ºB vs 2.ºA
  });

  it('grupos con 3 clasificados por grupo: 6 entrantes en orden', () => {
    const tables = [
      { name: 'A', rows: [{ teamId: 1 }, { teamId: 2 }, { teamId: 3 }] },
      { name: 'B', rows: [{ teamId: 4 }, { teamId: 5 }, { teamId: 6 }] },
    ];
    expect(entrantsFromGroupTables(tables, 3)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('falta clasificado en un grupo: lanza con mensaje claro', () => {
    const tables = [
      { name: 'A', rows: [{ teamId: 1 }] },
      { name: 'B', rows: [{ teamId: 2 }, { teamId: 3 }] },
    ];
    expect(() => entrantsFromGroupTables(tables, 2)).toThrow(/grupo A/);
  });

  it('tabla general: primeros N en orden', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ teamId: i + 1 }));
    expect(entrantsFromTable(rows, 4)).toEqual([1, 2, 3, 4]);
    expect(() => entrantsFromTable(rows.slice(0, 3), 4)).toThrow(/necesita 4/);
  });
});

describe('Fase 11C: registro en config y protecciones', () => {
  it('parseBracketConfig tolera configs sin llave o corruptos', () => {
    expect(parseBracketConfig('{}')).toBeNull();
    expect(parseBracketConfig('no-json')).toBeNull();
    expect(parseBracketConfig(JSON.stringify({ bracket: { format: 'ELIMINACION_DIRECTA', startRound: 5, singleMatch: true, thirdPlace: false } }))).toEqual({
      format: 'ELIMINACION_DIRECTA',
      startRound: 5,
      singleMatch: true,
      thirdPlace: false,
    });
    expect(bracketConfigJson(null)).toEqual({});
  });

  it('bracketHasPlayed: solo partidos de llave jugados cuentan', () => {
    const mk = (o: Partial<{ bracket_round: string; status: string }>) => ({
      bracket_round: '',
      status: 'scheduled',
      ...o,
    });
    expect(bracketHasPlayed([])).toBe(false);
    expect(bracketHasPlayed([mk({ bracket_round: 'SF', status: 'scheduled' })])).toBe(false);
    expect(bracketHasPlayed([mk({ bracket_round: 'SF', status: 'played' })])).toBe(true);
    expect(bracketHasPlayed([mk({ status: 'played' })])).toBe(false); // liga jugada no bloquea
    expect(bracketHasPlayed([mk({ bracket_round: 'F', status: 'walkover' })])).toBe(true);
  });
});
