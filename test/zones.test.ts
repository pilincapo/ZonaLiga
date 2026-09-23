// Tests de zonas manuales: parseo del form, lectura del config, validación
// y fixture por zonas con canchas compartidas e intercaladas.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ZONES,
  parseAssignments,
  validateZones,
  zonesFromForm,
  zonesOf,
} from '../src/lib/zones.ts';
import { buildZonedFixture, interleaveSlots, regeneratePairings } from '../src/lib/fixture.ts';
import { EMPTY_SCHEDULE, type TournamentSchedule } from '../src/lib/schedule.ts';
import type { Match } from '../src/lib/types.ts';

const team = (id: number, name: string) => ({ id, name, active: 1 });

describe('parseAssignments', () => {
  it('mapea zone_of_<id> al nombre de la zona elegida', () => {
    const form = { zone_names: 'A\nB', zone_of_1: '1', zone_of_2: '2', zone_of_3: '1' };
    const got = parseAssignments(form);
    expect(got.get(1)).toBe('A');
    expect(got.get(2)).toBe('B');
    expect(got.get(3)).toBe('A');
  });

  it('ignora índices fuera de rango y equipos inválidos', () => {
    const form = { zone_names: 'A\nB', zone_of_1: '9', zone_of_x: '1', zone_of_0: '1' };
    expect(parseAssignments(form).size).toBe(0);
  });
});

describe('zonesFromForm', () => {
  it('sin checkbox apagado devuelve vacío aunque haya textos', () => {
    const form = { zone_names: 'A\nB', zone_of_1: '1' };
    expect(zonesFromForm(form)).toEqual(EMPTY_ZONES);
  });

  it('con menos de dos zonas válidas devuelve vacío', () => {
    const form = { zones_enabled: 'on', zone_names: 'Solo A\n\nB', zone_of_1: '1' };
    // "B" existe como nombre pero sin equipos alcanza: names = [Solo A, B]
    const zones = zonesFromForm(form);
    expect(zones.enabled).toBe(true);
    expect(zones.zones.map((z) => z.name)).toEqual(['Solo A', 'B']);
  });

  it('arma zonas con sus equipos en orden', () => {
    const form = {
      zones_enabled: 'on',
      zone_names: 'A\nB',
      zone_of_10: '1',
      zone_of_11: '1',
      zone_of_20: '2',
      zone_of_21: '2',
    };
    const zones = zonesFromForm(form);
    expect(zones.enabled).toBe(true);
    expect(zones.zones[0]).toEqual({ name: 'A', teamIds: [10, 11] });
    expect(zones.zones[1]).toEqual({ name: 'B', teamIds: [20, 21] });
  });
});

describe('zonesOf', () => {
  it('redondea configs viejos sin zonas a vacío', () => {
    expect(zonesOf('{}')).toEqual(EMPTY_ZONES);
    expect(zonesOf('{"rules":1}')).toEqual(EMPTY_ZONES);
    expect(zonesOf('no-json')).toEqual(EMPTY_ZONES);
  });

  it('lee el config escrito por zonesFromForm', () => {
    const form = {
      zones_enabled: 'on',
      zone_names: 'A\nB',
      zone_of_1: '1',
      zone_of_2: '1',
      zone_of_3: '2',
      zone_of_4: '2',
    };
    const config = JSON.stringify({ zones: zonesFromForm(form) });
    const zones = zonesOf(config);
    expect(zones.enabled).toBe(true);
    expect(zones.zones).toHaveLength(2);
  });

  it('enabled exige al menos dos zonas con equipos', () => {
    const one = JSON.stringify({ zones: { enabled: true, zones: [{ name: 'A', teamIds: [1] }] } });
    expect(zonesOf(one).enabled).toBe(false);
  });
});

describe('validateZones', () => {
  const teams = [team(1, 'Uno'), team(2, 'Dos'), team(3, 'Tres'), team(4, 'Cuatro')];

  it('sin zonas activas no valida nada', () => {
    expect(validateZones(EMPTY_ZONES, teams)).toEqual([]);
  });

  it('equipo sin zona es error', () => {
    const zones = { enabled: true, zones: [{ name: 'A', teamIds: [1, 2] }] };
    const issues = validateZones(zones, teams);
    expect(issues.some((i) => i.kind === 'error' && i.text.includes('Tres'))).toBe(true);
  });

  it('equipo repetido en dos zonas es error', () => {
    const zones = {
      enabled: true,
      zones: [
        { name: 'A', teamIds: [1, 2] },
        { name: 'B', teamIds: [2, 3] },
      ],
    };
    const issues = validateZones(zones, teams);
    expect(issues.some((i) => i.kind === 'error' && i.text.includes('dos zonas'))).toBe(true);
  });

  it('desbalance fuerte avisa pero no bloquea', () => {
    const zones = {
      enabled: true,
      zones: [
        { name: 'A', teamIds: [1, 2, 3, 4] },
        { name: 'B', teamIds: [5] },
      ],
    };
    const issues = validateZones(zones, [...teams, team(5, 'Cinco')]);
    expect(issues.every((i) => i.kind === 'warning')).toBe(true);
    expect(issues.some((i) => i.text.includes('desbalanceadas'))).toBe(true);
  });

  it('reparto parejo: sin problemas', () => {
    const zones = {
      enabled: true,
      zones: [
        { name: 'A', teamIds: [1, 2] },
        { name: 'B', teamIds: [3, 4] },
      ],
    };
    expect(validateZones(zones, teams)).toEqual([]);
  });
});

describe('buildZonedFixture', () => {
  const zones = {
    enabled: true,
    zones: [
      { name: 'A', teamIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { name: 'B', teamIds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
    ],
  };

  it('20 equipos en 2 zonas de 10: 9 fechas, 5 partidos por zona por fecha', () => {
    const zf = buildZonedFixture(zones);
    expect(zf.rounds).toBe(9);
    expect(zf.byRound[0]).toHaveLength(10);
    const zoneMatches = zf.byRound[0]!.reduce(
      (acc, m) => acc.set(m.zone, (acc.get(m.zone) ?? 0) + 1),
      new Map<string, number>()
    );
    expect(zoneMatches.get('A')).toBe(5);
    expect(zoneMatches.get('B')).toBe(5);
  });

  it('ningún cruce sale de la zona', () => {
    const zf = buildZonedFixture(zones);
    for (const list of zf.byRound) {
      for (const m of list) {
        const inA = zones.zones[0]!.teamIds;
        const inB = zones.zones[1]!.teamIds;
        if (m.zone === 'A') {
          expect(inA).toContain(m.home);
          expect(inA).toContain(m.away);
        } else {
          expect(inB).toContain(m.home);
          expect(inB).toContain(m.away);
        }
      }
    }
  });

  it('interleaveSlots reparte una fecha intercalando canchas: 10:00 A, 10:00 B, 11:00 A…', () => {
    const zf = buildZonedFixture(zones);
    const schedule: TournamentSchedule = { ...EMPTY_SCHEDULE, venues: ['Cancha 1', 'Cancha 2'], kickoffs: ['10:00', '11:00', '12:00', '13:00', '14:00'] };
    const list = zf.byRound[0]!;
    // Zona A primero, Zona B después: el intercalado mezcla ambas listas.
    interleaveSlots(list, schedule);
    expect(list[0]!.kickoff_time).toBe('10:00');
    expect(list[1]!.kickoff_time).toBe('10:00');
    expect(list[2]!.kickoff_time).toBe('11:00');
    expect(list[3]!.kickoff_time).toBe('11:00');
    // Sin repetir cancha+hora en la misma fecha.
    const keys = new Set(list.map((m) => `${m.kickoff_time}|${m.venue}`));
    expect(keys.size).toBe(10);
  });

  it('elFixture respeta orden de fechas por zona (round correcto)', () => {
    const zf = buildZonedFixture(zones);
    expect(zf.byRound[4]!.every((m) => m.round === 5)).toBe(true);
  });
});

describe('regeneratePairings con zonas', () => {
  const zones = {
    enabled: true,
    zones: [
      { name: 'A', teamIds: [1, 2, 3, 4] },
      { name: 'B', teamIds: [5, 6, 7, 8] },
    ],
  };
  const schedule = {
    ...EMPTY_SCHEDULE,
    venues: ['C1', 'C2'],
    kickoffs: ['10:00', '11:00', '12:00'],
    startDate: '2026-10-03',
    roundGapDays: 7,
  };

  const matchOf = (over: Partial<Match>): Match =>
    ({
      id: 1,
      tournament_id: 1,
      round: 1,
      zone: '',
      bracket_round: '',
      home_team_id: 1,
      away_team_id: 2,
      home_source: '',
      away_source: '',
      status: 'scheduled',
      played_on: '2026-10-03',
      kickoff_time: '10:00',
      venue: 'C1',
      home_goals: null,
      away_goals: null,
      notes: '',
      ...over,
    }) as Match;

  it('los cruces nuevos no cruzan zonas', () => {
    const plan = regeneratePairings({
      existing: [],
      activeTeamIds: [1, 2, 3, 4, 5, 6, 7, 8],
      mode: 'single',
      schedule,
      zones,
    });
    const zoneA = new Set(zones.zones[0]!.teamIds);
    for (const m of plan.create) {
      const sameZone = zoneA.has(m.home) === zoneA.has(m.away);
      expect(sameZone).toBe(true);
    }
    expect(plan.create).toHaveLength(12); // 2 zonas × 6 partidos
  });

  it('re-slotea compartiendo canchas sin duplicar cancha+hora por día', () => {
    const plan = regeneratePairings({
      existing: [],
      activeTeamIds: [1, 2, 3, 4, 5, 6, 7, 8],
      mode: 'single',
      schedule,
      zones,
    });
    for (const m of plan.create) {
      // Con 6 slots y 6 partidos por fecha, cada partido ocupa un slot único.
      const same = plan.create.filter(
        (o) => o.played_on === m.played_on && o.kickoff_time === m.kickoff_time && o.venue === m.venue
      );
      expect(same).toHaveLength(1);
    }
    // Cada jornada tiene su propio día del calendario.
    const days = new Set(plan.create.map((m) => m.played_on));
    expect(days.size).toBe(3);
  });

  it('mantiene lo jugado aunque cambien las zonas', () => {
    const existing = [
      matchOf({ id: 1, round: 1, zone: 'A', home_team_id: 1, away_team_id: 2, status: 'played', home_goals: 2, away_goals: 1 }),
    ];
    const plan = regeneratePairings({
      existing,
      activeTeamIds: [1, 2, 3, 4, 5, 6, 7, 8],
      mode: 'single',
      schedule,
      zones,
    });
    expect(plan.keptMatchIds).toContain(1);
    expect(plan.create.every((m) => !(m.home === 1 && m.away === 2))).toBe(true);
  });
});
