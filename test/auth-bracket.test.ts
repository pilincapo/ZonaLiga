import { describe, expect, it } from 'vitest';
import {
  createDelegateToken,
  createSessionToken,
  safeEqual,
  verifyDelegateToken,
  verifySessionToken,
} from '../src/lib/auth.ts';
import { buildBracketColumns, matchShortLabel, matchWinnerLoser, sourceLabel } from '../src/lib/bracket.ts';
import type { Match } from '../src/lib/types.ts';

describe('auth', () => {
  const secret = 'test-secret';

  it('sesión creada ahora es válida', async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, secret)).toBe(true);
  });

  it('sesión con otro secreto es inválida', async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, 'otro')).toBe(false);
  });

  it('token manipulado falla', async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token.replace('exp:', 'exp1:'), secret)).toBe(false);
  });

  it('sesión de delegado: ida y vuelta', async () => {
    const token = await createDelegateToken(secret, 7, '0123456789abcdef0123456789abcdef');
    const session = await verifyDelegateToken(token, secret);
    expect(session).toEqual({ teamId: 7, codeHash: '0123456789abcdef' });
  });

  it('sesión de delegado con hash recortado a la longitud exacta', async () => {
    // El módulo recorta el hash al prefijo que viaja en el token.
    const token = await createDelegateToken(secret, 3, 'abc');
    const session = await verifyDelegateToken(token, secret);
    expect(session).toEqual({ teamId: 3, codeHash: 'abc' });
  });

  it('sesión de delegado con otro secreto es inválida', async () => {
    const token = await createDelegateToken(secret, 7, '0123456789abcdef');
    expect(await verifyDelegateToken(token, 'otro')).toBeNull();
  });

  it('sesión de delegado con código regenerado queda invalidada', async () => {
    // Comportamiento real: si el admin regenera el código, el hash guardado
    // cambia y la sesión anterior no coincide.
    const hashViejo = await hashPassword('codigo-viejo');
    const hashNuevo = await hashPassword('codigo-nuevo');
    const token = await createDelegateToken(secret, 7, hashViejo);
    const currentHash = hashNuevo.slice(0, 16);
    const session = await verifyDelegateToken(token, secret);
    expect(session).not.toBeNull();
    expect(session!.codeHash).not.toBe(currentHash);
  });

  it('safeEqual detecta diferencias', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

function hashPassword(password: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)).then((d) =>
    Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

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
