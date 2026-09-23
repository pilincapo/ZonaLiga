import { describe, expect, it } from 'vitest';
import { computeSuspensions, remainingSuspensionMatches } from '../src/lib/suspensions.ts';
import type { EventLike } from '../src/lib/suspensions.ts';
import { DEFAULT_RULES } from '../src/lib/types.ts';
import type { Match } from '../src/lib/types.ts';

function mkMatch(id: number, round: number, status: Match['status'] = 'played'): Match {
  return {
    id,
    tournament_id: 1,
    round,
    zone: '',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '2026-01-01',
    kickoff_time: '',
    venue: '',
    status,
    home_goals: 1,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
  };
}

function evt(id: number, matchId: number, playerId: number, type: EventLike['type']): EventLike {
  return { id, match_id: matchId, player_id: playerId, type, minute: null };
}

describe('computeSuspensions', () => {
  it('roja directa suspende según la regla', () => {
    const matches = [mkMatch(1, 1)];
    const events = [evt(1, 1, 10, 'red')];
    const s = computeSuspensions(events, matches, { ...DEFAULT_RULES, redSuspensionMatches: 2 }, 1);
    expect(s).toHaveLength(1);
    expect(s[0]!.matches).toBe(2);
    expect(s[0]!.reason).toBe('Roja directa');
  });

  it('acumulación de amarillas dispara 1 partido y resetea el contador', () => {
    const matches = [mkMatch(1, 1), mkMatch(2, 2), mkMatch(3, 3)];
    const events = [evt(1, 1, 7, 'yellow'), evt(2, 2, 7, 'yellow'), evt(3, 3, 7, 'yellow')];
    const s = computeSuspensions(events, matches, { ...DEFAULT_RULES, yellowAccumulation: 3 }, 3);
    expect(s).toHaveLength(1);
    expect(s[0]!.matches).toBe(1);
    expect(s[0]!.eventIds).toHaveLength(3);
  });

  it('con ventana de 2 fechas las amarillas viejas no cuentan', () => {
    const matches = [mkMatch(1, 1), mkMatch(2, 3), mkMatch(3, 4)];
    // Amarilla en fecha 1, luego en 3 y 4: con ventana 2, la de la fecha 1 ya no vale al llegar la 4.
    const events = [evt(1, 1, 7, 'yellow'), evt(2, 2, 7, 'yellow'), evt(3, 3, 7, 'yellow')];
    const s = computeSuspensions(events, matches, { ...DEFAULT_RULES, yellowAccumulation: 3, yellowAccumWindow: 2 }, 4);
    expect(s).toHaveLength(0);
  });

  it('dos rojas generan la sanción mayor (no se suman)', () => {
    const matches = [mkMatch(1, 1), mkMatch(2, 2)];
    const events = [evt(1, 1, 10, 'red'), evt(2, 2, 10, 'red')];
    const s = computeSuspensions(events, matches, { ...DEFAULT_RULES, redSuspensionMatches: 1 }, 2);
    expect(s).toHaveLength(1);
    expect(s[0]!.matches).toBe(1);
  });

  it('no considera eventos de rondas futuras', () => {
    const matches = [mkMatch(9, 5)];
    const events = [evt(1, 9, 10, 'red')];
    const s = computeSuspensions(events, matches, DEFAULT_RULES, 3);
    expect(s).toHaveLength(0);
  });
});

describe('remainingSuspensionMatches', () => {
  it('cuenta partidos ya jugados como sanción cumplida', () => {
    const matches = [mkMatch(1, 2, 'played'), mkMatch(2, 3, 'scheduled')];
    const s = { playerId: 10, teamId: 1, matches: 2, reason: '', asOfRound: 1, asOfMatchId: 1, eventIds: [] };
    const pending = remainingSuspensionMatches(s, matches, 1);
    expect(pending).toHaveLength(1);
  });

  it('sin partidos programados no queda pendiente mostrable', () => {
    const matches = [mkMatch(1, 2, 'played')];
    const s = { playerId: 10, teamId: 1, matches: 2, reason: '', asOfRound: 1, asOfMatchId: 1, eventIds: [] };
    expect(remainingSuspensionMatches(s, matches, 1)).toHaveLength(0);
  });
});
