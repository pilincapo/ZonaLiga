import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  safeEqual,
  sign,
  verify,
  verifySessionToken,
} from '../src/lib/auth.ts';
import { buildBracketColumns, matchShortLabel, matchWinnerLoser, sourceLabel } from '../src/lib/bracket.ts';
import type { Match } from '../src/lib/types.ts';

describe('auth', () => {
  const secret = 'test-secret';

  it('sign/verify roundtrip', async () => {
    const token = await sign('payload-de-prueba', secret);
    expect(await verify(token, secret)).toBe('payload-de-prueba');
  });

  it('verificar con otra clave falla', async () => {
    const token = await sign('hola', secret);
    expect(await verify(token, 'otra-clave')).toBeNull();
  });

  it('token manipulado falla', async () => {
    const token = await sign('exp:9999999999.abc', secret);
    const manipulated = token.replace('9999999999', '9999999999');
    expect(await verify(manipulated.replace('exp:', 'exp1:'), secret)).toBeNull();
  });

  it('sesión creada ahora es válida', async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, secret)).toBe(true);
  });

  it('sesión con otro secreto es inválida', async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, 'otro')).toBe(false);
  });

  it('safeEqual detecta diferencias', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

function mkMatch(partial: Partial<Match>): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 1,
    zone: '',
    bracket_round: 'QF',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-01-01',
    kickoff_time: '',
    venue: '',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

describe('bracket', () => {
  it('sourceLabel traduce orígenes', () => {
    expect(sourceLabel('W12')).toBe('Ganador 12');
    expect(sourceLabel('L3')).toBe('Perdedor 3');
    expect(sourceLabel('Z1')).toBe('1');
    expect(sourceLabel('')).toBe('Por definir');
  });

  it('matchWinnerLoser solo con partidos definidos', () => {
    expect(matchWinnerLoser(mkMatch({ home_goals: 2, away_goals: 1, status: 'played' }))).toEqual({ winner: 1, loser: 2 });
    expect(matchWinnerLoser(mkMatch({ home_goals: 0, away_goals: 0, status: 'played' }))).toBeNull();
    expect(matchWinnerLoser(mkMatch({ status: 'scheduled' }))).toBeNull();
  });

  it('buildBracketColumns agrupa por ronda en orden', () => {
    const matches = [
      mkMatch({ id: 1, bracket_round: 'F' }),
      mkMatch({ id: 2, bracket_round: 'SF' }),
      mkMatch({ id: 3, bracket_round: 'SF' }),
    ];
    const cols = buildBracketColumns(matches);
    expect(cols.map((c) => c.round)).toEqual(['SF', 'F']);
    expect(cols[0]!.matches).toHaveLength(2);
  });

  it('matchShortLabel numera dentro de la ronda', () => {
    const matches = [mkMatch({ id: 1, bracket_round: 'SF' }), mkMatch({ id: 2, bracket_round: 'SF' })];
    expect(matchShortLabel(matches[0]!, matches)).toBe('SF1');
    expect(matchShortLabel(matches[1]!, matches)).toBe('SF2');
  });
});
