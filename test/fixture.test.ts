import { describe, expect, it } from 'vitest';
import { generateDoubleRoundRobin, generateRoundRobin, shuffled } from '../src/lib/fixture.ts';

describe('generateRoundRobin', () => {
  it('con 4 equipos genera 3 fechas con 2 partidos', () => {
    const f = generateRoundRobin([1, 2, 3, 4]);
    expect(f.rounds).toHaveLength(3);
    for (const r of f.rounds) expect(r).toHaveLength(2);
  });

  it('cada equipo juega contra todos exactamente una vez', () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const f = generateRoundRobin(ids);
    const played = new Set<string>();
    const games = new Map<number, number>();
    for (const round of f.rounds) {
      for (const p of round) {
        expect(p.home).not.toBe(p.away);
        const key = [p.home, p.away].sort((a, b) => a - b).join('-');
        expect(played.has(key)).toBe(false);
        played.add(key);
        games.set(p.home, (games.get(p.home) ?? 0) + 1);
        games.set(p.away, (games.get(p.away) ?? 0) + 1);
      }
    }
    expect(played.size).toBe((ids.length * (ids.length - 1)) / 2);
    for (const id of ids) expect(games.get(id)).toBe(ids.length - 1);
  });

  it('con 5 equipos cada fecha tiene un libre y todos libran una vez', () => {
    const ids = [1, 2, 3, 4, 5];
    const f = generateRoundRobin(ids);
    expect(f.rounds).toHaveLength(5);
    const byes = f.byes.filter((b) => b != null);
    expect(byes).toHaveLength(5);
    expect(new Set(byes).size).toBe(5);
    for (const round of f.rounds) expect(round).toHaveLength(2);
  });

  it('localías alternadas: nadie juega más de dos veces seguidas de local', () => {
    const f = generateRoundRobin([1, 2, 3, 4, 5, 6, 7, 8]);
    const homeStreak = new Map<number, number>();
    for (const round of f.rounds) {
      const homeThisRound = new Set(round.map((p) => p.home));
      for (const [id, streak] of homeStreak) {
        if (homeThisRound.has(id)) expect(streak + 1).toBeLessThanOrEqual(2);
      }
      for (const id of homeThisRound) homeStreak.set(id, (homeStreak.get(id) ?? 0) + 1);
      for (const p of round) if (!homeThisRound.has(p.away)) homeStreak.set(p.away, 0);
    }
  });
});

describe('generateDoubleRoundRobin', () => {
  it('segunda vuelta espejo: mismos cruces con localía invertida', () => {
    const f = generateDoubleRoundRobin([1, 2, 3, 4]);
    expect(f.rounds).toHaveLength(6);
    const first = f.rounds.slice(0, 3);
    const second = f.rounds.slice(3);
    for (let i = 0; i < 3; i++) {
      const a = first[i]!.map((p) => `${p.home}-${p.away}`).sort();
      const b = second[i]!.map((p) => `${p.away}-${p.home}`).sort();
      expect(b).toEqual(a);
    }
  });
});

describe('shuffled', () => {
  it('es determinista con RNG inyectado', () => {
    const rng = () => 0.5;
    const a = shuffled([1, 2, 3, 4, 5], rng);
    const b = shuffled([1, 2, 3, 4, 5], rng);
    expect(a).toEqual(b);
  });

  it('contiene los mismos elementos', () => {
    const out = shuffled([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
