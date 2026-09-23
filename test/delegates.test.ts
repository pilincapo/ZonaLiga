import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  canSubmitFor,
  differsFromOfficial,
  eventCounts,
  generateDelegateCode,
  hasOfficialResult,
  maxEvents,
  normalizeCode,
  parseEvent,
  parseSubmission,
  reviewLabel,
} from '../src/lib/delegates.ts';
import type { Match } from '../src/lib/types.ts';

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.append(k, v);
  return form;
}

function mkMatch(partial: Partial<Match> = {}): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 7,
    zone: '',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-09-27',
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

describe('códigos de delegado', () => {
  it('genera códigos del largo pedido y del alfabeto seguro', () => {
    const code = generateDelegateCode();
    expect(code).toHaveLength(8);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });

  it('no usa caracteres ambiguos (I, O, 0, 1)', () => {
    for (const ch of 'IO01') expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('es determinista con un rng inyectado', () => {
    const rng = () => 0;
    expect(generateDelegateCode(4, rng)).toBe('AAAA');
    expect(generateDelegateCode(4, rng)).toHaveLength(4);
  });

  it('normaliza lo que escribe el usuario', () => {
    expect(normalizeCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeCode('abcd 2345')).toBe('ABCD2345');
    expect(normalizeCode('aBcD2345')).toBe('ABCD2345');
  });
});

describe('canSubmitFor', () => {
  it('acepta solo partidos de mi equipo', () => {
    const m = mkMatch();
    expect(canSubmitFor(m, 1)).toBe(true);
    expect(canSubmitFor(m, 2)).toBe(true);
    expect(canSubmitFor(m, 3)).toBe(false);
  });

  it('rechaza partidos sin equipos definidos o con bye', () => {
    expect(canSubmitFor(mkMatch({ home_team_id: null }), 1)).toBe(false);
    expect(canSubmitFor(mkMatch({ status: 'bye' }), 1)).toBe(false);
  });
});

describe('parseSubmission', () => {
  it('acepta un resultado jugado válido', () => {
    const r = parseSubmission(fd({ status: 'played', home_goals: '3', away_goals: '2', notes: ' buen partido ' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ status: 'played', homeGoals: 3, awayGoals: 2, notes: 'buen partido' });
    }
  });

  it('rechaza estados que un delegado no puede fijar', () => {
    expect(parseSubmission(fd({ status: 'bye' })).ok).toBe(false);
    expect(parseSubmission(fd({ status: 'scheduled' })).ok).toBe(false);
  });

  it('rechaza goles no numéricos o fuera de rango', () => {
    expect(parseSubmission(fd({ status: 'played', home_goals: 'dos', away_goals: '1' })).ok).toBe(false);
    expect(parseSubmission(fd({ status: 'played', home_goals: '99', away_goals: '1' })).ok).toBe(false);
    expect(parseSubmission(fd({ status: 'played', home_goals: '-3', away_goals: '1' })).ok).toBe(false);
  });

  it('postergado y suspendido fuerzan 0-0', () => {
    const p = parseSubmission(fd({ status: 'postponed', home_goals: '2', away_goals: '1' }));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value).toEqual({ status: 'postponed', homeGoals: 0, awayGoals: 0, notes: '' });
  });

  it('walkover exige un ganador', () => {
    expect(parseSubmission(fd({ status: 'walkover', home_goals: '1', away_goals: '1' })).ok).toBe(false);
    const ok = parseSubmission(fd({ status: 'walkover', home_goals: '1', away_goals: '0' }));
    expect(ok.ok).toBe(true);
  });

  it('goles vacíos se toman como 0', () => {
    const r = parseSubmission(fd({ status: 'played', home_goals: '', away_goals: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.homeGoals).toBe(0);
  });
});

describe('parseEvent', () => {
  const allowed = new Set([10, 11]);

  it('acepta un evento de un jugador del equipo', () => {
    const r = parseEvent(fd({ type: 'goal', player_id: '10', minute: '23' }), allowed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ type: 'goal', playerId: 10, minute: 23 });
  });

  it('rechaza jugadores de otro equipo', () => {
    expect(parseEvent(fd({ type: 'goal', player_id: '99' }), allowed).ok).toBe(false);
  });

  it('rechaza tipos inválidos y minutos fuera de rango', () => {
    expect(parseEvent(fd({ type: 'penalty', player_id: '10' }), allowed).ok).toBe(false);
    expect(parseEvent(fd({ type: 'goal', player_id: '10', minute: '200' }), allowed).ok).toBe(false);
  });

  it('el minuto es opcional', () => {
    const r = parseEvent(fd({ type: 'yellow', player_id: '11' }), allowed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.minute).toBeNull();
  });
});

describe('comparación con el resultado oficial', () => {
  it('detecta diferencias de goles y de estado', () => {
    const oficial = mkMatch({ status: 'played', home_goals: 1, away_goals: 1 });
    expect(differsFromOfficial({ status: 'played', home_goals: 1, away_goals: 1 }, oficial)).toBe(false);
    expect(differsFromOfficial({ status: 'played', home_goals: 2, away_goals: 1 }, oficial)).toBe(true);
    expect(differsFromOfficial({ status: 'postponed', home_goals: 0, away_goals: 0 }, oficial)).toBe(true);
  });

  it('hasOfficialResult distingue lo que ya está resuelto', () => {
    expect(hasOfficialResult(mkMatch({ status: 'scheduled' }))).toBe(false);
    expect(hasOfficialResult(mkMatch({ status: 'played' }))).toBe(true);
    expect(hasOfficialResult(mkMatch({ status: 'postponed' }))).toBe(true);
  });
});

describe('helpers de presentación', () => {
  it('cuenta eventos por tipo', () => {
    const counts = eventCounts([{ type: 'goal' }, { type: 'goal' }, { type: 'yellow' }, { type: 'red' }, { type: 'own_goal' }]);
    expect(counts).toEqual({ goals: 2, ownGoals: 1, yellows: 1, reds: 1 });
  });

  it('traduce el estado de la entrega', () => {
    expect(reviewLabel('pending')).toBe('Pendiente de aprobación');
    expect(reviewLabel('approved')).toBe('Publicado');
    expect(reviewLabel('rejected')).toBe('Rechazado');
  });

  it('el tope de eventos es razonable', () => {
    expect(maxEvents()).toBeGreaterThanOrEqual(10);
  });
});
