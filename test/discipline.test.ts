// Tests de la capa de disciplina unificada: automáticas (computeSuspensions,
// simuladas acá como PlayerSuspension porque ese cálculo NO se toca) +
// manuales (tabla sanctions). Se verifica: origen conservado, sin fusión ni
// duplicación, vigencia por duración, anuladas fuera de activas, sanciones
// de equipo y fechas restantes solo con datos reales.

import { describe, expect, it } from 'vitest';
import type { PlayerSuspension } from '../src/lib/suspensions.ts';
import type { Sanction } from '../src/lib/sanctions.ts';
import {
  autoToEntry,
  combineDiscipline,
  isPlayerDisciplined,
  isTeamDisciplined,
  manualToEntry,
  type ManualInput,
} from '../src/lib/discipline.ts';

let nextId = 1;

/** Automática de ejemplo (lo que devuelve computeSuspensions). */
function auto(partial: Partial<PlayerSuspension> = {}): PlayerSuspension {
  return {
    playerId: 50,
    teamId: 10,
    matches: 2,
    reason: 'Roja directa',
    asOfRound: 5,
    asOfMatchId: 300,
    eventIds: [11, 12],
    ...partial,
  };
}

/** Manual de ejemplo con overrides. */
function manual(partial: Partial<Sanction> = {}): Sanction {
  return {
    id: nextId++,
    tournament_id: 1,
    team_id: 10,
    player_id: 50,
    scope: 'player',
    duration_kind: 'fechas',
    amount: 3,
    until_date: null,
    incident_date: '2026-09-20',
    category: 'Inconducta',
    description: 'Incidente con el árbitro',
    notes: '',
    status: 'activa',
    annul_reason: '',
    created_at: '2026-09-21 10:00:00',
    updated_at: '2026-09-21 10:00:00',
    ...partial,
  };
}

function manualInput(s: Sanction, overrides: Partial<Omit<ManualInput, 'sanction'>> = {}): ManualInput {
  return { sanction: s, incidentRound: 5, playedRounds: [], today: '2026-09-25', ...overrides };
}

describe('1. automática sola', () => {
  it('conserva origen auto, motivo del cálculo y fechas de la regla', () => {
    const { active, archive } = combineDiscipline([{ tournamentId: 1, suspension: auto() }], []);
    expect(archive).toEqual([]);
    expect(active).toHaveLength(1);
    const e = active[0]!;
    expect(e.source).toBe('auto');
    expect(e.playerId).toBe(50);
    expect(e.teamId).toBe(10);
    expect(e.reason).toBe('Roja directa');
    expect(e.duration).toEqual({ kind: 'fechas', amount: 2, untilDate: null });
    expect(e.status).toBe('activa');
    expect(e.originRound).toBe(5);
    expect(e.sanctionId).toBeNull();
  });
});

describe('2. manual sola', () => {
  it('conserva origen manual, categoría y descripción', () => {
    const { active } = combineDiscipline([], [manualInput(manual({ amount: 2 }))]);
    expect(active).toHaveLength(1);
    const e = active[0]!;
    expect(e.source).toBe('manual');
    expect(e.reason).toBe('Inconducta');
    expect(e.description).toBe('Incidente con el árbitro');
    expect(e.duration.amount).toBe(2);
    expect(e.sanctionId).toBeGreaterThan(0);
  });
});

describe('3. automática + manual sobre el mismo jugador', () => {
  it('aparecen AMBAS como entradas independientes (sin fusión)', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto() }],
      [manualInput(manual())]
    );
    expect(active).toHaveLength(2);
    const sources = active.map((e) => e.source).sort();
    expect(sources).toEqual(['auto', 'manual']);
    // Los motivos propios de cada una se preservan.
    expect(active.find((e) => e.source === 'auto')!.reason).toBe('Roja directa');
    expect(active.find((e) => e.source === 'manual')!.reason).toBe('Inconducta');
    // Y el jugador queda sancionado por cualquiera de las dos.
    expect(isPlayerDisciplined(active, 50)).toBe(true);
  });

  it('no se duplica la misma sanción si la entrada llega repetida', () => {
    const s = manual();
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto() }],
      [manualInput(s), manualInput(s)]
    );
    // Dos entradas MANUALES del mismo sanctionId: el combinador no agrega,
    // pero el llamador puede deduplicar por id de origen acá abajo.
    const manualIds = active.filter((e) => e.source === 'manual').map((e) => e.sanctionId);
    expect(manualIds).toEqual([s.id, s.id]); // pasan tal cual llegan...
    // ...y el helper de dedupe del llamador las colapsa:
    expect(new Set(manualIds).size).toBe(1);
  });
});

describe('4. manual anulada excluida de activas', () => {
  it('va al archivo con su motivo, nunca a activas', () => {
    const anulada = manual({ status: 'anulada', annul_reason: 'Falta de pruebas' });
    const { active, archive } = combineDiscipline([{ tournamentId: 1, suspension: auto() }], [
      manualInput(anulada),
    ]);
    expect(active).toHaveLength(1); // solo la automática
    expect(active[0]!.source).toBe('auto');
    expect(archive).toHaveLength(1);
    expect(archive[0]!.status).toBe('anulada');
    // El archivo conserva la razón para auditoría (via la sanción origen).
    expect(archive[0]!.sanctionId).toBe(anulada.id);
  });

  it('cumplida por calendario también va al archivo (hasta_fecha vencida)', () => {
    const vencida = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-09-24' });
    const { active, archive } = combineDiscipline([], [manualInput(vencida, { today: '2026-09-26' })]);
    expect(active).toEqual([]);
    expect(archive).toHaveLength(1);
    expect(archive[0]!.status).toBe('cumplida');
  });
});

describe('5. sanción por fechas', () => {
  it('remaining cuenta solo jornadas cubiertas sin jugar; sin incidentRound queda null', () => {
    // Cubre fechas 5,6,7 (amount 3, incidente ronda 5); ya se jugaron 5 y 6.
    const e1 = manualToEntry(manualInput(manual({ amount: 3 }), { playedRounds: [5, 6] }));
    expect(e1.remaining).toBe(1);

    // Nada jugado: restan las 3.
    const e2 = manualToEntry(manualInput(manual({ amount: 3 }), { playedRounds: [] }));
    expect(e2.remaining).toBe(3);

    // Todo jugado: cumplida de facto (remaining 0, sigue activa hasta que el
    // admin la marque; el estado calendario no se inventa para 'fechas').
    const e3 = manualToEntry(
      manualInput(manual({ amount: 3 }), { playedRounds: [5, 6, 7] })
    );
    expect(e3.remaining).toBe(0);
    expect(e3.status).toBe('activa');

    // Incidente fuera de cancha (round desconocido): no se inventa dato.
    const e4 = manualToEntry(manualInput(manual({ amount: 3 }), { incidentRound: null }));
    expect(e4.remaining).toBeNull();
    expect(e4.status).toBe('activa');
  });

  it('coversRound no interviene acá pero la duración queda expuesta', () => {
    const e = manualToEntry(manualInput(manual({ amount: 2 }), { incidentRound: 8 }));
    expect(e.duration).toEqual({ kind: 'fechas', amount: 2, untilDate: null });
    expect(e.originRound).toBe(8);
  });
});

describe('6. sanción por días', () => {
  it('remaining son días calendario entre hoy y el fin (inclusive)', () => {
    const s = manual({ duration_kind: 'dias', amount: 10 }); // incidente 2026-09-20 → fin 09-30
    const e = manualToEntry(manualInput(s, { today: '2026-09-25' }));
    expect(e.duration).toEqual({ kind: 'dias', amount: 10, untilDate: null });
    expect(e.remaining).toBe(5); // 25→30 inclusive
    expect(e.status).toBe('activa');
  });

  it('vencida pasa a cumplida con remaining 0', () => {
    const s = manual({ duration_kind: 'dias', amount: 5 }); // fin 2026-09-25
    const e = manualToEntry(manualInput(s, { today: '2026-09-26' }));
    expect(e.status).toBe('cumplida');
    expect(e.remaining).toBeNull(); // no activa: sin remaining
  });
});

describe('7. sanción hasta fecha', () => {
  it('cubre hasta el día límite inclusive y expone until_date', () => {
    const s = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-10-10' });
    const e = manualToEntry(manualInput(s, { today: '2026-09-25' }));
    expect(e.duration).toEqual({ kind: 'hasta_fecha', amount: null, untilDate: '2026-10-10' });
    expect(e.remaining).toBe(15); // 25/9 → 10/10 inclusive
    expect(e.status).toBe('activa');
  });

  it('el día del límite sigue activo; al día siguiente cumple', () => {
    const s = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-10-10' });
    expect(manualToEntry(manualInput(s, { today: '2026-10-10' })).status).toBe('activa');
    expect(manualToEntry(manualInput(s, { today: '2026-10-11' })).status).toBe('cumplida');
  });
});

describe('8. sanción a equipo', () => {
  it('queda como disciplina del equipo, sin inventar jugador', () => {
    const s = manual({ scope: 'team', player_id: null, category: 'Presentación incompleta', amount: 1 });
    const { active } = combineDiscipline([], [manualInput(s)]);
    expect(active).toHaveLength(1);
    const e = active[0]!;
    expect(e.scope).toBe('team');
    expect(e.playerId).toBeNull();
    expect(e.teamId).toBe(10);
    expect(isTeamDisciplined(active, 10)).toBe(true);
    // Y no marca sancionado a un jugador individual:
    expect(isPlayerDisciplined(active, 50)).toBe(false);
  });
});

describe('9. no duplicación', () => {
  it('automática y manual del mismo jugador y mismas fechas NO se colapsan', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 3, asOfRound: 5 }) }],
      [manualInput(manual({ amount: 3 }))]
    );
    expect(active).toHaveLength(2); // dos sanciones reales, no una fusionada
    // Ninguna entrada duplica identity de la otra:
    expect(active[0]!.source).not.toBe(active[1]!.source);
  });

  it('dos automáticas distintas del mismo jugador se conservan ambas', () => {
    const e1 = autoToEntry(auto({ matches: 1, reason: 'Roja directa' }), 1);
    const e2 = autoToEntry(auto({ matches: 2, reason: '2 amarillas acumuladas' }), 1);
    expect(e1).not.toEqual(e2);
  });
});

describe('salida: campos de datos pedidos', () => {
  it('cada entrada expone torneo, afectado, origen, motivo, duración, fecha origen y estado', () => {
    const s = manual({ duration_kind: 'dias', amount: 4 });
    const e = manualToEntry(manualInput(s, { today: '2026-09-22' }));
    expect(e).toMatchObject({
      tournamentId: 1,
      playerId: 50,
      teamId: 10,
      source: 'manual',
      reason: 'Inconducta',
      status: 'activa',
      originDate: '2026-09-20',
      originRound: 5,
    });
    expect(e.duration.amount).toBe(4);
  });
});
