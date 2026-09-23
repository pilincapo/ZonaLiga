import { describe, expect, it } from 'vitest';
import { regeneratePairings, verifyPairings, slotConflicts, type NewMatch } from '../src/lib/fixture.ts';
import type { Match } from '../src/lib/types.ts';
import { EMPTY_SCHEDULE, type TournamentSchedule } from '../src/lib/schedule.ts';

const SCHED: TournamentSchedule = {
  ...EMPTY_SCHEDULE,
  venues: ['Norte', 'Sur'],
  kickoffs: ['10:00'],
  startDate: '2026-10-05',
  roundGapDays: 7,
  playWeekday: 6, // sábados: r1 = 2026-10-10, r2 = 2026-10-17, …
};

let seq = 1;
function mk(over: Partial<Match> = {}): Match {
  return {
    id: seq++,
    tournament_id: 1,
    round: 1,
    zone: '',
    bracket_round: '',
    home_team_id: 1,
    away_team_id: 2,
    home_source: '',
    away_source: '',
    played_on: '',
    kickoff_time: '',
    venue: '',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...over,
  };
}

function asMatch(n: NewMatch, i: number): Match {
  return mk({
    id: 900 + i,
    round: n.round,
    home_team_id: n.home,
    away_team_id: n.away,
    played_on: n.played_on,
    kickoff_time: n.kickoff_time,
    venue: n.venue,
    status: 'scheduled',
  });
}

describe('regeneratePairings', () => {
  it('conserva lo jugado, borra los pendientes y rearma completo y verificado', () => {
    const played = mk({
      id: 1,
      round: 1,
      home_team_id: 1,
      away_team_id: 2,
      status: 'played',
      played_on: '2026-10-10',
      kickoff_time: '10:00',
      venue: 'Norte',
      home_goals: 2,
      away_goals: 0,
    });
    const pend1 = mk({ id: 2, round: 1, home_team_id: 3, away_team_id: 4 });
    const pend2 = mk({ id: 3, round: 2, home_team_id: 1, away_team_id: 3 });

    const plan = regeneratePairings({
      existing: [played, pend1, pend2],
      activeTeamIds: [1, 2, 3, 4],
      mode: 'single',
      schedule: SCHED,
    });

    expect(plan.keptMatchIds).toEqual([1]);
    expect(plan.removeMatchIds).toEqual([2, 3]);

    // El partido nuevo de la fecha 1 evita la cancha del que ya se jugó
    // y comparte su día (la jornada mixta juega el mismo sábado).
    const r1 = plan.create.find((m) => m.round === 1)!;
    expect(r1.played_on).toBe('2026-10-10');
    expect(r1.venue).toBe('Sur');
    expect(plan.create.find((m) => m.round === 2)!.played_on).toBe('2026-10-17');

    // Estado final: 4 equipos, single → los 6 cruces posibles, sin choques.
    const final = [played, ...plan.create.map(asMatch)];
    expect(final).toHaveLength(6);
    expect(verifyPairings(final, 'single')).toEqual([]);
  });

  it('el cruce ya jugado no vuelve a aparecer (single) y el equipo nuevo entra', () => {
    const played = mk({ id: 1, round: 1, home_team_id: 1, away_team_id: 2, status: 'played' });
    const plan = regeneratePairings({
      existing: [played],
      activeTeamIds: [1, 2, 3, 4, 5], // 5 es el recién agregado
      mode: 'single',
      schedule: SCHED,
    });

    expect(plan.keptMatchIds).toEqual([1]);
    expect(plan.create.some((m) => m.home === 5 || m.away === 5)).toBe(true);

    const pairs = new Map<string, number>();
    for (const m of [played, ...plan.create.map(asMatch)]) {
      const k = [m.home_team_id, m.away_team_id].sort((a, b) => (a ?? 0) - (b ?? 0)).join('-');
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    expect(pairs.get('1-2')).toBe(1); // solo el que se jugó
    expect(verifyPairings([played, ...plan.create.map(asMatch)], 'single')).toEqual([]);
  });

  it('el equipo que se fue no juega más, pero su historia queda', () => {
    const played = mk({ id: 1, round: 1, home_team_id: 1, away_team_id: 4, status: 'played' });
    const pend = mk({ id: 2, round: 2, home_team_id: 1, away_team_id: 4 });
    const plan = regeneratePairings({
      existing: [played, pend],
      activeTeamIds: [1, 2, 3], // 4 dejó el torneo
      mode: 'single',
      schedule: SCHED,
    });

    expect(plan.keptMatchIds).toEqual([1]);
    expect(plan.removeMatchIds).toEqual([2]);
    expect(plan.create.every((m) => m.home !== 4 && m.away !== 4)).toBe(true);
    expect(verifyPairings([played, ...plan.create.map(asMatch)], 'single')).toEqual([]);
  });

  it('las jornadas de más sin partidos jugados desaparecen', () => {
    const plan = regeneratePairings({
      existing: [mk({ id: 1, round: 4 }), mk({ id: 2, round: 5 })],
      activeTeamIds: [1, 2, 3, 4], // single → 3 jornadas
      mode: 'single',
      schedule: SCHED,
    });
    expect(plan.removeMatchIds).toEqual([1, 2]);
    expect(plan.create.every((m) => m.round <= 3)).toBe(true);
  });

  it('modo double: hasta 2 cruces, y sin choques de cancha en la jornada mixta', () => {
    const played = mk({ id: 1, round: 1, home_team_id: 1, away_team_id: 2, status: 'played' });
    const plan = regeneratePairings({
      existing: [played],
      activeTeamIds: [1, 2, 3, 4],
      mode: 'double',
      schedule: SCHED,
    });
    const final = [played, ...plan.create.map(asMatch)];
    expect(verifyPairings(final, 'double')).toEqual([]);
    const count12 = final.filter(
      (m) => [m.home_team_id, m.away_team_id].sort().join('-') === '1-2'
    ).length;
    expect(count12).toBeLessThanOrEqual(2);
  });

  it('sin fecha de inicio igual reparte cancha y hora si hay config', () => {
    const plan = regeneratePairings({
      existing: [
        mk({ id: 1, round: 1, status: 'played', home_team_id: 1, away_team_id: 2, kickoff_time: '10:00', venue: 'Norte' }),
      ],
      activeTeamIds: [1, 2, 3, 4],
      mode: 'single',
      schedule: { ...EMPTY_SCHEDULE, venues: ['Norte'], kickoffs: ['10:00', '12:00'] },
    });
    // Una sola cancha: el nuevo no puede tomar el slot del jugado ese día.
    const r1 = plan.create.find((m) => m.round === 1);
    expect(r1).toBeDefined();
    expect(r1!.venue).toBe('Norte');
    expect(r1!.kickoff_time).toBe('12:00');
  });
});

describe('verifyPairings', () => {
  const name = (id: number) => `Equipo${id}`;

  it('detecta un equipo dos veces en la misma fecha', () => {
    const issues = verifyPairings(
      [mk({ round: 1, home_team_id: 1, away_team_id: 2 }), mk({ round: 1, home_team_id: 1, away_team_id: 3 })],
      'single',
      name
    );
    expect(issues.some((i) => i.includes('Equipo1 juega 2 veces en la fecha 1'))).toBe(true);
  });

  it('detecta un cruce repetido más allá del modo', () => {
    const three = [1, 2, 3].map((r) => mk({ round: r, home_team_id: 1, away_team_id: 2 }));
    expect(verifyPairings(three, 'single', name).some((i) => i.includes('se cruzan 3 veces'))).toBe(true);
    expect(verifyPairings(three, 'double', name).some((i) => i.includes('se cruzan 3 veces'))).toBe(true);
    expect(verifyPairings(three.slice(0, 2), 'double', name)).toEqual([]);
  });

  it('detecta una cancha doblemente reservada (mismo día y hora)', () => {
    const issues = verifyPairings(
      [
        mk({ round: 1, home_team_id: 1, away_team_id: 2, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
        mk({ round: 2, home_team_id: 3, away_team_id: 4, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
      ],
      'single',
      name
    );
    expect(issues.some((i) => i.includes('Norte tiene 2 partidos'))).toBe(true);
    // Día distinto no choca.
    expect(
      verifyPairings(
        [
          mk({ round: 1, home_team_id: 1, away_team_id: 2, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
          mk({ round: 2, home_team_id: 3, away_team_id: 4, played_on: '2026-10-17', kickoff_time: '10:00', venue: 'Norte' }),
        ],
        'single',
        name
      )
    ).toEqual([]);
  });

  it('ignora los cruces de llave (en eliminatorias repetir rival es legal)', () => {
    const issues = verifyPairings(
      [
        mk({ round: 9, bracket_round: 'SF', home_team_id: 1, away_team_id: 2 }),
        mk({ round: 9, bracket_round: 'SF', home_team_id: 2, away_team_id: 1 }),
      ],
      'single',
      name
    );
    expect(issues).toEqual([]);
  });

  it('fixture sano: sin problemas', () => {
    expect(
      verifyPairings(
        [
          mk({ round: 1, home_team_id: 1, away_team_id: 2, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
          mk({ round: 1, home_team_id: 3, away_team_id: 4, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Sur' }),
          mk({ round: 2, home_team_id: 1, away_team_id: 3, played_on: '2026-10-17', kickoff_time: '10:00', venue: 'Norte' }),
        ],
        'single',
        name
      )
    ).toEqual([]);
  });
});

describe('slotConflicts', () => {
  it('reporta cancha + hora + día repetidos', () => {
    const issues = slotConflicts([
      mk({ played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
      mk({ played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Norte tiene 2 partidos el 2026-10-10 a las 10:00');
  });

  it('mismo día y cancha pero distinta hora no es choque; otro día tampoco', () => {
    expect(
      slotConflicts([
        mk({ played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' }),
        mk({ played_on: '2026-10-10', kickoff_time: '12:00', venue: 'Norte' }),
        mk({ played_on: '2026-10-17', kickoff_time: '10:00', venue: 'Norte' }),
      ])
    ).toEqual([]);
  });

  it('partidos sin día, hora o cancha se ignoran', () => {
    expect(
      slotConflicts([
        mk({ played_on: '', kickoff_time: '10:00', venue: 'Norte' }),
        mk({ played_on: '2026-10-10', kickoff_time: '', venue: 'Norte' }),
        mk({ played_on: '2026-10-10', kickoff_time: '10:00', venue: '' }),
      ])
    ).toEqual([]);
  });

  it('con inScope: atribuye solo los choques que tocan a la jornada', () => {
    const inR1 = mk({ round: 1, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' });
    const inR2 = mk({ round: 2, played_on: '2026-10-17', kickoff_time: '10:00', venue: 'Norte' });
    const outR2 = mk({ round: 3, played_on: '2026-10-17', kickoff_time: '10:00', venue: 'Norte' });
    const inScope = (m: { round: number | null }) => m.round === 1;
    // Choque ajeno a la ronda 1: no se reporta.
    expect(slotConflicts([inR1, inR2, outR2], inScope)).toEqual([]);
    // Choque que involucra a la ronda 1: se reporta.
    const other = mk({ round: 4, played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Norte' });
    expect(slotConflicts([inR1, inR2, outR2, other], inScope)).toHaveLength(1);
  });
});
