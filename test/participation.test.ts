// Tests de participación equipo↔torneo (tournament_teams).
// Las consultas se prueban contra un stub mínimo de D1 que captura el SQL y
// devuelve resultados armados; los helpers de comparación, en cambio, se
// prueban como dominio puro.

import { describe, expect, it } from 'vitest';
import {
  BackfillPlanner,
  fixturePoolOfTournament,
  participationFromPairs,
  sameIds,
  participatingIdsFromForm,
  participantsOrAllTeams,
  participantsWithoutZone,
  zonedTeamIdsFromForm,
  replaceTournamentParticipation,
} from '../src/lib/participation.ts';
import type { ZoneConfig } from '../src/lib/zones.ts';
import { teamIdsOfTournament, participantsOfTournament, tournamentsOfTeam } from '../src/lib/participation.ts';

/** Stub de D1 para el escritor: captura los statements del batch. */
function writerDb() {
  const batches: { sql: string; params: unknown[] }[][] = [];
  const db = {
    prepare(sql: string) {
      return { bind: (...params: unknown[]) => ({ sql, params }) };
    },
    async batch(stmts: { sql: string; params: unknown[] }[]) {
      batches.push(stmts);
      return [];
    },
  };
  return { db: db as unknown as D1Database, batches };
}

/** Stub mínimo de D1: graba las consultas ejecutadas y devuelve lo encolado. */
function dbStub(results: Record<string, unknown[]> = {}) {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      const one = {
        all: async <T>() => ({ results: (results[sql] ?? []) as T[] }),
        first: async <T>() => (results[sql] ?? [])[0] as T | undefined,
      };
      return { ...one, bind: () => one };
    },
  };
  return { db: db as unknown as D1Database, queries };
}

function team(id: number, name: string): { id: number; name: string; active: number } {
  return { id, name, active: 1 };
}

describe('sameIds', () => {
  it('iguales en distinto orden y repetidos internos dan true', () => {
    expect(sameIds([3, 1, 2], [1, 2, 3])).toBe(true);
    expect(sameIds([1, 1, 2], [2, 1])).toBe(true);
    expect(sameIds([], [])).toBe(true);
  });

  it('distintas si difieren en un elemento', () => {
    expect(sameIds([1, 2], [1, 3])).toBe(false);
    expect(sameIds([1, 2, 3], [1, 2])).toBe(false);
    expect(sameIds([], [1])).toBe(false);
  });
});

describe('participationFromPairs', () => {
  it('une fuentes y elimina duplicados', () => {
    expect(
      participationFromPairs(
        [
          [1, 10],
          [1, 11],
        ],
        [
          [1, 11],
          [1, 12],
        ]
      )
    ).toEqual([
      [1, 10],
      [1, 11],
      [1, 12],
    ]);
  });

  it('no muta las entradas', () => {
    const a: [number, number][] = [[1, 10]];
    const b: [number, number][] = [[1, 10]];
    participationFromPairs(a, b);
    expect(a).toEqual([[1, 10]]);
    expect(b).toEqual([[1, 10]]);
  });

  it('con ambas fuentes vacías devuelve vacío', () => {
    expect(participationFromPairs([], [])).toEqual([]);
  });
});

describe('BackfillPlanner', () => {
  it('deduplica uniones de partidos y zonas', () => {
    const plan = BackfillPlanner.fromSources(
      [
        [1, 10],
        [1, 11],
      ],
      [[1, 11]]
    );
    expect(plan.rows()).toEqual([
      [1, 10],
      [1, 11],
    ]);
  });

  it('registra huérfanos y no los incluye', () => {
    const plan = BackfillPlanner.fromSources([[1, 99]], [[1, 10]]);
    const filtered = plan.withTeamIds([10, 11]);
    expect(filtered.rows()).toEqual([[1, 10]]);
    expect(filtered.orphanCount()).toBe(1);
    expect(filtered.orphans()).toEqual([[1, 99]]);
  });

  it('sin ninguna fuente no genera filas', () => {
    const plan = BackfillPlanner.fromSources([], []);
    expect(plan.rows()).toEqual([]);
    expect(plan.orphanCount()).toBe(0);
  });
});

describe('teamIdsOfTournament', () => {
  it('devuelve los ids de la consulta', async () => {
    const { db } = dbStub({
      'SELECT team_id FROM tournament_teams WHERE tournament_id = ?1 ORDER BY team_id': [{ team_id: 4 }, { team_id: 7 }],
    });
    expect(await teamIdsOfTournament(db, 1)).toEqual([4, 7]);
  });

  it('sin participantes devuelve vacío', async () => {
    const { db } = dbStub();
    expect(await teamIdsOfTournament(db, 1)).toEqual([]);
  });
});

describe('participantsOfTournament', () => {
  it('hace join con teams y trae el equipo completo', async () => {
    const sql = `SELECT tm.* FROM tournament_teams tt
       JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1
       ORDER BY tm.name COLLATE NOCASE`;
    const { db } = dbStub({ [sql]: [team(4, 'Defensores')] });
    const rows = await participantsOfTournament(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Defensores');
  });

  it('sin participantes devuelve vacío', async () => {
    const { db } = dbStub();
    expect(await participantsOfTournament(db, 1)).toEqual([]);
  });
});

describe('tournamentsOfTeam', () => {
  it('devuelve los torneos del equipo ordenados', async () => {
    const { db } = dbStub();
    const rows = await tournamentsOfTeam(db, 4);
    expect(rows).toEqual([]);
  });
});

describe('participatingIdsFromForm', () => {
  it('lee solo los participate_<id> marcados, sin duplicados y ordenados', () => {
    const ids = participatingIdsFromForm({
      participate_12: 'on',
      participate_7: 'on',
      participate_12x: 'on', // clave inválida: se ignora
      participate_0: 'on', // id inválido: se ignora
      other: 'on',
    });
    expect(ids).toEqual([7, 12]);
  });

  it('sin marcas devuelve vacío', () => {
    expect(participatingIdsFromForm({ name: 'Copa', zone_of_1: '1' })).toEqual([]);
  });
});

describe('zonedTeamIdsFromForm', () => {
  it('cuenta solo zonas con índice válido (1..n); vacío y 0 no cuentan', () => {
    const ids = zonedTeamIdsFromForm({ zone_of_5: '2', zone_of_6: '', zone_of_7: '0', zone_of_8: 'x' });
    expect(ids).toEqual([5]);
  });

  it('sin zonas asignadas devuelve vacío', () => {
    expect(zonedTeamIdsFromForm({ participate_1: 'on' })).toEqual([]);
  });
});

describe('replaceTournamentParticipation', () => {
  it('un DELETE + un INSERT por equipo, en UN batch, sin duplicados', async () => {
    const { db, batches } = writerDb();
    const n = await replaceTournamentParticipation(db, 9, [4, 2, 4, 7]);
    expect(n).toBe(3);
    expect(batches).toHaveLength(1);
    const [del, ...ins] = batches[0]!;
    expect(del!.sql).toBe('DELETE FROM tournament_teams WHERE tournament_id = ?1');
    expect(del!.params).toEqual([9]);
    expect(ins.map((s) => s.params)).toEqual([[9, 2], [9, 4], [9, 7]]);
    expect(ins.every((s) => s.sql.startsWith('INSERT OR IGNORE'))).toBe(true);
  });

  it('con lista vacía deja solo el DELETE (torneo sin participantes)', async () => {
    const { db, batches } = writerDb();
    const n = await replaceTournamentParticipation(db, 9, []);
    expect(n).toBe(0);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.sql).toContain('DELETE');
  });
});

describe('participantsOrAllTeams', () => {
  const SQL_PARTS_FULL = `SELECT tm.* FROM tournament_teams tt
       JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1
       ORDER BY tm.name COLLATE NOCASE`;
  const SQL_ALL = 'SELECT * FROM teams ORDER BY name COLLATE NOCASE';

  it('con participantes: solo esos', async () => {
    const { db } = dbStub({ [SQL_PARTS_FULL]: [team(4, 'D'), team(2, 'B')] });
    const { teams, fallback } = await participantsOrAllTeams(db, 1);
    expect(teams.map((t) => t.id)).toEqual([4, 2]);
    expect(fallback).toBe(false);
  });

  it('sin participantes: todos los equipos (compatibilidad)', async () => {
    const { db } = dbStub({ [SQL_ALL]: [team(1, 'A'), team(2, 'B'), team(3, 'C')] });
    const { teams, fallback } = await participantsOrAllTeams(db, 1);
    expect(teams.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(fallback).toBe(true);
  });
});

describe('participantsWithoutZone', () => {
  const zonesOn: ZoneConfig = { enabled: true, zones: [{ name: 'A', teamIds: [1, 2] }, { name: 'B', teamIds: [3] }] };
  const zonesOff: ZoneConfig = { enabled: false, zones: [] };

  it('detecta participantes sin zona cuando las zonas están activas', () => {
    expect(participantsWithoutZone([1, 2, 3, 4, 5], zonesOn)).toEqual([4, 5]);
  });

  it('participante con zona: no aparece (funciona normalmente)', () => {
    expect(participantsWithoutZone([1, 2, 3], zonesOn)).toEqual([]);
  });

  it('zonas apagadas: nunca hay avisos (círculo global)', () => {
    expect(participantsWithoutZone([1, 9, 44], zonesOff)).toEqual([]);
  });

  it('sin duplicados aunque la entrada los traiga', () => {
    expect(participantsWithoutZone([7, 7], zonesOn)).toEqual([7]);
  });
});

describe('fixturePoolOfTournament', () => {
  const SQL_PARTS = `SELECT tm.id, tm.name, tm.active
       FROM tournament_teams tt JOIN teams tm ON tm.id = tt.team_id
       WHERE tt.tournament_id = ?1 AND tm.active = 1
       ORDER BY tm.name COLLATE NOCASE`;
  const SQL_LEGACY = 'SELECT id, name FROM teams WHERE active = 1 ORDER BY id';

  it('con participantes registrados: solo esos, y sin fallback', async () => {
    const { db } = dbStub({ [SQL_PARTS]: [team(4, 'D'), team(2, 'A'), team(9, 'Z')] });
    const pool = await fixturePoolOfTournament(db, 1);
    expect(pool!.ids).toEqual([4, 2, 9]);
    expect(pool!.fallback).toBe(false);
  });

  it('un equipo activo global que no participa NO entra al pool', async () => {
    // Participantes: 4 y 2. El global 3 (activo) NO participa: no aparece.
    const { db } = dbStub({
      [SQL_PARTS]: [team(4, 'D'), team(2, 'B')],
      [SQL_LEGACY]: [team(1, 'A'), team(2, 'B'), team(3, 'C'), team(4, 'D')],
    });
    const pool = await fixturePoolOfTournament(db, 1);
    expect(pool!.ids).toEqual([4, 2]);
    expect(pool!.ids).not.toContain(3);
    expect(pool!.fallback).toBe(false);
  });

  it('torneo sin filas de participación: fallback al pool histórico (todos los activos)', async () => {
    const { db } = dbStub({ [SQL_PARTS]: [], [SQL_LEGACY]: [team(1, 'A'), team(2, 'B'), team(3, 'C')] });
    const pool = await fixturePoolOfTournament(db, 1);
    expect(pool!.ids).toEqual([1, 2, 3]);
    expect(pool!.fallback).toBe(true);
  });

  it('torneo con un solo participante: ese único equipo es el pool (sin fallback)', async () => {
    const { db } = dbStub({ [SQL_PARTS]: [team(4, 'D')] });
    const pool = await fixturePoolOfTournament(db, 1);
    expect(pool!.ids).toEqual([4]);
    expect(pool!.fallback).toBe(false);
  });
});
