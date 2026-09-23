import { describe, expect, it } from 'vitest';
import { MAX_GOALS, resolveScorers, scoreFromEvents } from '../src/lib/sheet.ts';

const ALLOWED = [10, 11, 12, 13];

describe('resolveScorers', () => {
  it('cantidades fijas 1..4 con los goleadores exactos', () => {
    expect(resolveScorers({ count: '1', checked: [10], allowed: ALLOWED })).toEqual({ ok: true, ids: [10] });
    expect(resolveScorers({ count: '2', checked: [12, 11], allowed: ALLOWED })).toEqual({ ok: true, ids: [12, 11] });
    expect(resolveScorers({ count: '4', checked: [10, 11, 12, 13], allowed: ALLOWED })).toEqual({
      ok: true,
      ids: [10, 11, 12, 13],
    });
  });

  it('"más de 4": acepta entre 5 y el tope', () => {
    expect(resolveScorers({ count: 'more', countMore: '5', checked: [10, 11, 12, 13], allowed: ALLOWED })).toEqual({
      ok: false,
      error: 'Tildaste 4 goleador(es) para 5 gol(es): tildá exactamente 5.',
    });
    const five = [1, 2, 3, 4, 5];
    expect(resolveScorers({ count: 'more', countMore: '5', checked: five, allowed: five })).toEqual({
      ok: true,
      ids: [1, 2, 3, 4, 5],
    });
    expect(resolveScorers({ count: 'more', countMore: String(MAX_GOALS), checked: five, allowed: five }).ok).toBe(false);
  });

  it('"más de 4" fuera de rango o ilegible se rechaza', () => {
    for (const bad of ['', '4', 'x', '2.5', '0', '-1', '21']) {
      const r = resolveScorers({ count: 'more', countMore: bad, checked: [], allowed: ALLOWED });
      expect(r.ok, `countMore=${bad}`).toBe(false);
    }
  });

  it('cantidad no elegida o inválida', () => {
    expect(resolveScorers({ count: '', checked: [], allowed: ALLOWED })).toEqual({
      ok: false,
      error: 'Elegí cuántos goles hizo el equipo',
    });
    expect(resolveScorers({ count: '7', checked: [], allowed: ALLOWED }).ok).toBe(false);
  });

  it('la cantidad y los tildados tienen que coincidir', () => {
    const menos = resolveScorers({ count: '3', checked: [10, 11], allowed: ALLOWED });
    expect(menos).toEqual({ ok: false, error: 'Tildaste 2 goleador(es) para 3 gol(es): tildá exactamente 3.' });
    const mas = resolveScorers({ count: '1', checked: [10, 11], allowed: ALLOWED });
    expect(mas.ok).toBe(false);
    const ninguno = resolveScorers({ count: '1', checked: [], allowed: ALLOWED });
    expect(ninguno.ok).toBe(false);
  });

  it('rechaza jugadores de otro equipo o basura', () => {
    expect(resolveScorers({ count: '1', checked: [99], allowed: ALLOWED })).toEqual({
      ok: false,
      error: 'Ese jugador no es de la plantilla de este equipo',
    });
    expect(resolveScorers({ count: '1', checked: [Number.NaN], allowed: ALLOWED }).ok).toBe(false);
  });
});

describe('scoreFromEvents', () => {
  const H = 1;
  const A = 2;

  it('cada gol suma para el equipo que lo cargó', () => {
    const score = scoreFromEvents(
      [
        { teamId: H, type: 'goal' },
        { teamId: H, type: 'goal' },
        { teamId: A, type: 'goal' },
      ],
      H,
      A
    );
    expect(score).toEqual({ home: 2, away: 1 });
  });

  it('el gol en contra favorece al rival', () => {
    const score = scoreFromEvents(
      [
        { teamId: A, type: 'own_goal' }, // en contra de la visita: gol local
        { teamId: H, type: 'own_goal' }, // en contra del local: gol visita
      ],
      H,
      A
    );
    expect(score).toEqual({ home: 1, away: 1 });
  });

  it('ignora eventos sin equipo, de terceros y que no son goles', () => {
    const score = scoreFromEvents(
      [
        { teamId: null, type: 'goal' },
        { teamId: 99, type: 'goal' },
        { teamId: H, type: 'yellow' },
        { teamId: A, type: 'red' },
      ],
      H,
      A
    );
    expect(score).toEqual({ home: 0, away: 0 });
  });

  it('sin eventos: 0-0', () => {
    expect(scoreFromEvents([], H, A)).toEqual({ home: 0, away: 0 });
  });
});
