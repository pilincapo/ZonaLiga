import { describe, expect, it } from 'vitest';
import { fxPageIndexFromUrl } from '../src/ui/public.ts';

// Fechas 1..4 más la etiqueta 'x' de partidos sin fecha asignada.
const KEYS = ['1', '2', '3', '4', 'x'];

describe('/fixture?f=N (compartir una fecha por link)', () => {
  it('f=3 señala la fecha 3 (índice 2)', () => {
    expect(fxPageIndexFromUrl('3', KEYS)).toBe(2);
  });

  it('f=1 señala la primera fecha', () => {
    expect(fxPageIndexFromUrl('1', KEYS)).toBe(0);
  });

  it('sin f no cambia la fecha por defecto', () => {
    expect(fxPageIndexFromUrl(undefined, KEYS)).toBe(-1);
    expect(fxPageIndexFromUrl('', KEYS)).toBe(-1);
  });

  it('f inválida (texto, 0, negativo o decimal) no cambia nada', () => {
    expect(fxPageIndexFromUrl('pepe', KEYS)).toBe(-1);
    expect(fxPageIndexFromUrl('0', KEYS)).toBe(-1);
    expect(fxPageIndexFromUrl('-2', KEYS)).toBe(-1);
    expect(fxPageIndexFromUrl('1.5', KEYS)).toBe(-1);
  });

  it('f más grande que la última fecha cae a la última', () => {
    expect(fxPageIndexFromUrl('99', KEYS)).toBe(3);
  });

  it('f apunta al round real, aunque las claves no empiecen en 1', () => {
    // 4 fechas con round 2..5 y una de partidos sin fecha.
    const keys = ['2', '3', '4', '5', 'x'];
    expect(fxPageIndexFromUrl('5', keys)).toBe(3);
    expect(fxPageIndexFromUrl('1', keys)).toBe(0); // cae a la más cercana (2)
  });

  it('partidos sin fecha asignada (x) no son alcanzables por f', () => {
    expect(fxPageIndexFromUrl('5', KEYS)).toBe(3); // se pega a la fecha 4
  });

  it('sin fechas en el fixture no hay índice', () => {
    expect(fxPageIndexFromUrl('1', [])).toBe(-1);
    expect(fxPageIndexFromUrl('1', ['x'])).toBe(-1);
  });
});
