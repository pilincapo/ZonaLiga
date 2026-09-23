// Tests del dominio de la declaración de goles (lib/sheet.ts).
import { describe, expect, it } from 'vitest';
import {
  MAX_GOALS,
  picksWithoutRoster,
  picksFromEvents,
  resolveGoalPlan,
  scorerOptions,
} from '../src/lib/sheet.ts';

const P = [11, 22, 33];

describe('resolveGoalPlan', () => {
  it('0 goles: sin picks y sin requerir listas', () => {
    expect(resolveGoalPlan({ goals: 0, raws: [], allowed: P })).toEqual({ ok: true, picks: [] });
  });

  it('cantidad cubierta por jugadores del equipo', () => {
    const r = resolveGoalPlan({ goals: 2, raws: ['11', '22'], allowed: P });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.picks).toEqual([{ kind: 'player', id: 11 }, { kind: 'player', id: 22 }]);
  });

  it('acepta "own" y "none"', () => {
    const r = resolveGoalPlan({ goals: 2, raws: ['own', 'none'], allowed: P });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.picks).toEqual([{ kind: 'own' }, { kind: 'anon' }]);
  });

  it('lista vacía = falta elegir (error con cantidad faltante)', () => {
    const r = resolveGoalPlan({ goals: 3, raws: ['11', '', '22'], allowed: P });
    expect(r).toEqual({ ok: false, error: 'Completá las listas: falta el autor de 1 gol(es)' });
  });

  it('todas vacías con goles > 0: falta el autor de todos', () => {
    const r = resolveGoalPlan({ goals: 2, raws: ['', ''], allowed: P });
    expect(r).toEqual({ ok: false, error: 'Completá las listas: falta el autor de 2 gol(es)' });
  });

  it('raws de más se ignoran', () => {
    const r = resolveGoalPlan({ goals: 1, raws: ['11', '22'], allowed: P });
    expect(r.ok).toBe(true);
  });

  it('valor raro (id ajeno) es error', () => {
    expect(resolveGoalPlan({ goals: 1, raws: ['999'], allowed: P })).toEqual({
      ok: false,
      error: 'Hay un autor inválido en las listas de goles',
    });
  });

  it('goles negativos y por encima del tope son error', () => {
    expect(resolveGoalPlan({ goals: -1, raws: [], allowed: P }).ok).toBe(false);
    expect(resolveGoalPlan({ goals: MAX_GOALS + 1, raws: [], allowed: P }).ok).toBe(false);
  });
});

describe('picksWithoutRoster', () => {
  it('sin plantilla: goles anónimos salvo los marcados "en contra"', () => {
    expect(picksWithoutRoster(['own', '', 'own'], 3)).toEqual([
      { kind: 'own' },
      { kind: 'anon' },
      { kind: 'own' },
    ]);
  });

  it('recorta a la cantidad declarada', () => {
    expect(picksWithoutRoster(['own', 'own', 'own'], 2)).toEqual([{ kind: 'own' }, { kind: 'own' }]);
    expect(picksWithoutRoster([], 3)).toEqual([]);
  });
});

describe('scorerOptions', () => {
  it('placeholder numerado, en contra, sin autor y la plantilla', () => {
    const opts = scorerOptions({ index: 1, teamName: 'Racing', players: [{ id: 7, name: 'Juan', number: 9 }] });
    expect(opts.map((o) => o.value)).toEqual(['', 'own', 'none', '7']);
    expect(opts[0]!.label).toBe('Gol 2: elegí…');
    expect(opts[1]!.label).toContain('Racing');
    expect(opts[3]!.label).toBe('#9 Juan');
  });

  it('sin número de camiseta no agrega el "#"', () => {
    const opts = scorerOptions({ index: 0, teamName: 'X', players: [{ id: 1, name: 'Ana', number: null }] });
    expect(opts[3]!.label).toBe('Ana');
  });
});

describe('picksFromEvents', () => {
  it('mapea goles y en contra del equipo', () => {
    const evs = [
      { teamId: 1, type: 'goal', playerId: 11 },
      { teamId: 1, type: 'goal', playerId: null },
      { teamId: 1, type: 'own_goal', playerId: null },
      { teamId: 1, type: 'yellow', playerId: 11 },
      { teamId: 2, type: 'goal', playerId: 5 },
    ];
    expect(picksFromEvents(evs, 1)).toEqual(['11', 'none', 'own']);
    expect(picksFromEvents(evs, null)).toEqual([]);
  });
});
