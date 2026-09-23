import { describe, expect, it } from 'vitest';
import { MAX_GOALS, resolveGoalPicks, scoreFromEvents } from '../src/lib/sheet.ts';

const ALLOWED = [10, 11, 12, 13];

describe('resolveGoalPicks', () => {
  it('cantidades fijas 1..4 con las listas completas', () => {
    expect(resolveGoalPicks({ count: '1', picks: [10], allowed: ALLOWED })).toEqual({ ok: true, picks: [10] });
    expect(resolveGoalPicks({ count: '3', picks: [12, null, 11], allowed: ALLOWED })).toEqual({
      ok: true,
      picks: [12, null, 11],
    });
  });

  it('acepta "en contra" (null) mezclado con jugadores', () => {
    const r = resolveGoalPicks({ count: '2', picks: [null, 10], allowed: ALLOWED });
    expect(r).toEqual({ ok: true, picks: [null, 10] });
  });

  it('"más de 4": acepta entre 5 y el tope', () => {
    const five = [1, 2, 3, 4, 5];
    expect(resolveGoalPicks({ count: 'more', countMore: '5', picks: five, allowed: five })).toEqual({
      ok: true,
      picks: [1, 2, 3, 4, 5],
    });
    expect(resolveGoalPicks({ count: 'more', countMore: String(MAX_GOALS), picks: five, allowed: five }).ok).toBe(false);
  });

  it('"más de 4" fuera de rango o ilegible se rechaza', () => {
    for (const bad of ['', '4', 'x', '2.5', '0', '-1', '21']) {
      const r = resolveGoalPicks({ count: 'more', countMore: bad, picks: [], allowed: ALLOWED });
      expect(r.ok, `countMore=${bad}`).toBe(false);
    }
  });

  it('cantidad no elegida o inválida', () => {
    expect(resolveGoalPicks({ count: '', picks: [], allowed: ALLOWED })).toEqual({
      ok: false,
      error: 'Elegí cuántos goles hizo el equipo',
    });
    expect(resolveGoalPicks({ count: '7', picks: [], allowed: ALLOWED }).ok).toBe(false);
  });

  it('las listas tienen que estar completas: ni más ni menos', () => {
    const corto = resolveGoalPicks({ count: '2', picks: [10], allowed: ALLOWED });
    expect(corto).toEqual({ ok: false, error: 'Elegiste 1 de 2 gol(es): completá las listas.' });
    const sobra = resolveGoalPicks({ count: '1', picks: [10, 11], allowed: ALLOWED });
    expect(sobra).toEqual({ ok: false, error: 'Elegiste 2 de 1 gol(es): completá las listas.' });
    const vacio = resolveGoalPicks({ count: '1', picks: [], allowed: ALLOWED });
    expect(vacio.ok).toBe(false);
  });

  it('rechaza jugadores de otro equipo o basura', () => {
    expect(resolveGoalPicks({ count: '1', picks: [99], allowed: ALLOWED })).toEqual({
      ok: false,
      error: 'Ese jugador no es de la plantilla de este equipo',
    });
    expect(resolveGoalPicks({ count: '1', picks: [Number.NaN], allowed: ALLOWED }).ok).toBe(false);
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
