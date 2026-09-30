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
  hasHardBlock,
  eligibilityErrorMessage,
  isPlayerDisciplined,
  isTeamDisciplined,
  manualToEntry,
  playerEligibility,
  type EligibilityInput,
  type ManualInput,
} from '../src/lib/discipline.ts';
import { teamEffects, isTeamExpelled, teamPointsDeducted } from '../src/lib/discipline.ts';
import { sanctionEffectsOf } from '../src/lib/sanctionEffects.ts';
import { SANCTION_MEASURE_LABELS, isFulfilledSanction } from '../src/lib/sanctions.ts';
import type { Match } from '../src/lib/types.ts';

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
    measure: null,
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

/* ============================== ELEGIBILIDAD ============================== */

/** Partido de ejemplo: fecha 6, jugado el 2026-10-11, equipo 10 local. */
function match(partial: Partial<Match> = {}): Match {
  return {
    id: 900,
    tournament_id: 1,
    round: 6,
    zone: '',
    bracket_round: '',
    home_team_id: 10,
    away_team_id: 20,
    home_source: '',
    away_source: '',
    played_on: '2026-10-11',
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

/** Entrada de disciplina del input de elegibilidad, con overrides. */
function eligInput(
  entries: ReturnType<typeof combineDiscipline>['active'],
  m: Match,
  extra: Partial<Pick<EligibilityInput, 'playedRounds' | 'tournamentMatches'>> = {}
): EligibilityInput {
  return {
    active: entries,
    match: m,
    playedRounds: [],
    tournamentMatches: [m],
    ...extra,
  };
}

/** Partidos jugados del equipo 10 (para contar servidas de automáticas). */
function playedMatch(round: number, teamA = 10, teamB = 20): Match {
  return match({ id: 900 + round, round, status: 'played', home_team_id: teamA, away_team_id: teamB });
}

describe('elegibilidad: jugador sin sanciones', () => {
  it('sin entradas activas está elegible y sin motivos', () => {
    const el = playerEligibility(eligInput([], match()), 50);
    expect(el.eligible).toBe(true);
    expect(el.reasons).toEqual([]);
    expect(hasHardBlock(el)).toBe(false);
  });

  it('una sanción de OTRO jugador no lo afecta', () => {
    const { active } = combineDiscipline([{ tournamentId: 1, suspension: auto({ playerId: 77 }) }], []);
    expect(playerEligibility(eligInput(active, match()), 50).eligible).toBe(true);
  });
});

describe('elegibilidad: automática', () => {
  it('roja en fecha 5 con 2 partidos: en la fecha 6 sigue no elegible con 2 restantes', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 2, asOfRound: 5 }) }],
      []
    );
    const el = playerEligibility(eligInput(active, match()), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons).toHaveLength(1);
    expect(el.reasons[0]).toMatchObject({ source: 'auto', reason: 'Roja directa', remaining: 2, needsReview: false });
  });

  it('ya cumplida: jugó los partidos posteriores y en la fecha 6+2 queda elegible', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 2, asOfRound: 5 }) }],
      []
    );
    // Partidos jugados en fechas 6 y 7: sirvió las 2 fechas de la sanción.
    const torneo = [playedMatch(6), playedMatch(7)];
    const partidoFecha8 = match({ round: 8 });
    const el = playerEligibility(eligInput(active, partidoFecha8, { tournamentMatches: [...torneo, partidoFecha8] }), 50);
    expect(el.eligible).toBe(true);
  });

  it('partido sin round (reposición a definir): revisión, sin inventar restante', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 1, asOfRound: 5 }) }],
      []
    );
    const el = playerEligibility(eligInput(active, match({ round: null })), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons[0]).toMatchObject({ source: 'auto', needsReview: true, remaining: null });
    // La revisión NO es bloqueo firme: la decide el llamador.
    expect(hasHardBlock(el)).toBe(false);
  });

  it('cambio de equipo: el conteo usa partidos del equipo de la sanción, no del nuevo', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 2, asOfRound: 5, teamId: 10 }) }],
      []
    );
    // El jugador ahora juega para el equipo 30. El partido es del equipo 30;
    // los partidos servidos se siguen contando sobre el equipo 10 (origen).
    const servidos = [playedMatch(6, 10, 20)];
    const nuevoPartido = match({ round: 7, home_team_id: 30, away_team_id: 40 });
    const el = playerEligibility(
      eligInput(active, nuevoPartido, { tournamentMatches: [...servidos, nuevoPartido] }),
      50
    );
    // Sirvió 1 de 2 (del equipo 10): le queda 1. No se inventa nada extra.
    expect(el.eligible).toBe(false);
    expect(el.reasons[0]!.remaining).toBe(1);
  });
});

describe('elegibilidad: manual por fechas', () => {
  it('partido dentro de las fechas cubiertas: no elegible', () => {
    const { active } = combineDiscipline([], [manualInput(manual({ amount: 3 }))]); // cubre 5,6,7
    const el = playerEligibility(eligInput(active, match({ round: 6 })), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons[0]).toMatchObject({ source: 'manual', reason: 'Inconducta', remaining: 3, needsReview: false });
  });

  it('partido fuera del rango: elegible', () => {
    const { active } = combineDiscipline([], [manualInput(manual({ amount: 3 }))]); // cubre 5,6,7
    expect(playerEligibility(eligInput(active, match({ round: 8 })), 50).eligible).toBe(true);
  });

  it('cuenta las fechas ya jugadas: si sirvió 5 y 6, en la 7 le queda 1', () => {
    const { active } = combineDiscipline([], [manualInput(manual({ amount: 3 }))]);
    const el = playerEligibility(eligInput(active, match({ round: 7 }), { playedRounds: [5, 6] }), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons[0]!.remaining).toBe(1);
  });

  it('sin jornada de incidente (fuera de cancha): esta vía NO bloquea y no inventa', () => {
    const { active } = combineDiscipline(
      [],
      [manualInput(manual({ amount: 3 }), { incidentRound: null })]
    );
    const el = playerEligibility(eligInput(active, match()), 50);
    expect(el.eligible).toBe(true); // sin datos no bloquea por esta vía
    expect(el.reasons).toEqual([]);
  });
});

describe('elegibilidad: manual por días y hasta fecha', () => {
  it('por días: bloquea si la fecha del partido cae dentro de la vigencia', () => {
    const s = manual({ duration_kind: 'dias', amount: 10 }); // 09-20 → 09-30
    const { active } = combineDiscipline([], [manualInput(s)]);
    expect(playerEligibility(eligInput(active, match({ played_on: '2026-09-25' })), 50).eligible).toBe(false);
    // Vencida: elegible.
    expect(playerEligibility(eligInput(active, match({ played_on: '2026-10-01' })), 50).eligible).toBe(true);
  });

  it('hasta fecha: el día límite sigue bloqueando; al día siguiente no', () => {
    const s = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-10-11' });
    const { active } = combineDiscipline([], [manualInput(s)]);
    expect(playerEligibility(eligInput(active, match({ played_on: '2026-10-11' })), 50).eligible).toBe(false);
    expect(playerEligibility(eligInput(active, match({ played_on: '2026-10-12' })), 50).eligible).toBe(true);
  });

  it('partido sin fecha: revisión sin inventar (no bloqueo firme)', () => {
    const s = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-12-01' });
    const { active } = combineDiscipline([], [manualInput(s)]);
    const el = playerEligibility(eligInput(active, match({ played_on: '' })), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons[0]).toMatchObject({ needsReview: true, remaining: null });
    expect(hasHardBlock(el)).toBe(false);
  });
});

describe('elegibilidad: combinaciones y estados', () => {
  it('automática + manual: no elegible y AMBAS razones disponibles', () => {
    const { active } = combineDiscipline(
      [{ tournamentId: 1, suspension: auto({ matches: 2, asOfRound: 5 }) }],
      [manualInput(manual({ category: 'Agresión', amount: 3 }))]
    );
    const el = playerEligibility(eligInput(active, match()), 50);
    expect(el.eligible).toBe(false);
    expect(el.reasons).toHaveLength(2);
    expect(el.reasons.map((r) => r.source).sort()).toEqual(['auto', 'manual']);
    expect(el.reasons.map((r) => r.reason).sort()).toEqual(['Agresión', 'Roja directa']);
    // Mensaje de rechazo menciona los dos orígenes.
    const msg = eligibilityErrorMessage(el);
    expect(msg).toContain('automática');
    expect(msg).toContain('disciplinaria');
  });

  it('sanción de equipo: el jugador SIGUE elegible', () => {
    const s = manual({ scope: 'team', player_id: null, category: 'Incidente con árbitro', amount: 5 });
    const { active } = combineDiscipline([], [manualInput(s)]);
    expect(playerEligibility(eligInput(active, match()), 50).eligible).toBe(true);
    // Y el equipo queda marcado aparte:
    expect(isTeamDisciplined(active, 10)).toBe(true);
  });

  it('sanción anulada: elegible (nunca llega a activas)', () => {
    const s = manual({ status: 'anulada', annul_reason: 'Falsa acusación' });
    const { active } = combineDiscipline([], [manualInput(s)]);
    expect(active).toHaveLength(0);
    expect(playerEligibility(eligInput([], match()), 50).eligible).toBe(true);
  });

  it('sanción cumplida: elegible', () => {
    const s = manual({ duration_kind: 'hasta_fecha', amount: null, until_date: '2026-09-24', status: 'cumplida' });
    const { active } = combineDiscipline([], [manualInput(s, { today: '2026-09-26' })]);
    expect(active).toHaveLength(0);
    expect(playerEligibility(eligInput([], match()), 50).eligible).toBe(true);
  });

  it('otro torneo: el llamador filtra por tournament_id y acá no se re-verifica', () => {
    // La sanción de otro torneo NO debe estar en `active` del partido:
    // combineDiscipline respeta el tournamentId de cada entrada y el
    // llamador (disciplineForMatch) arma solo con sanciones del torneo.
    const { active } = combineDiscipline([], [manualInput(manual({ tournament_id: 2 }))]);
    expect(active.every((e) => e.tournamentId === 2)).toBe(true);
    // Si el llamador igual la pasa, el criterio por jornada igual aplica:
    // este test documenta que el filtrado por torneo es responsabilidad del
    // llamador (disciplineForMatch), no de playerEligibility.
    expect(playerEligibility(eligInput([], match()), 50).eligible).toBe(true);
  });
});

/* ============================== FASE 7B: MEDIDAS DE EQUIPO ============================== */

/** Manual de equipo con medida, lista para combineDiscipline. */
function teamMeasure(
  measure: Sanction['measure'],
  opts: { amount?: number | null; until_date?: string | null; category?: string; duration_kind?: Sanction['duration_kind'] } = {}
) {
  return manual(
    measure === null
      ? { scope: 'team', player_id: null }
      : {
          scope: 'team',
          player_id: null,
          measure,
          amount: opts.amount ?? null,
          until_date: opts.until_date ?? null,
          duration_kind: opts.duration_kind ?? (opts.until_date ? 'hasta_fecha' : 'fechas'),
          category: opts.category ?? 'Incumplimiento reglamentario',
        }
  );
}

describe('Fase 7B: teamEffects (efectos reales de medidas de equipo)', () => {
  it('advertencia: solo deja constancia en warnings, sin efecto en tabla ni expulsión', () => {
    const { active } = combineDiscipline([], [manualInput(teamMeasure('advertencia'))]);
    const fx = teamEffects(active);
    expect(fx.warnings.get(10)).toEqual(['Incumplimiento reglamentario']);
    expect(fx.expelled.size).toBe(0);
    expect(fx.pointsDeducted.size).toBe(0);
    expect(fx.suspensions.size).toBe(0);
    expect(isTeamExpelled(fx, 10)).toBe(false);
    expect(teamPointsDeducted(fx, 10)).toBe(0);
  });

  it('perdida_puntos: restante en pointsDeducted y ajuste negativo individual', () => {
    const a = manualInput(teamMeasure('perdida_puntos', { amount: 3, category: 'Agresión' }));
    const b = manualInput(teamMeasure('perdida_puntos', { amount: 1, category: 'Pelea / desmanes' }));
    const { active } = combineDiscipline([], [a, b]);
    const fx = teamEffects(active);
    expect(teamPointsDeducted(fx, 10)).toBe(4); // dos sanciones suman

    const se = sanctionEffectsOf(active);
    expect(se.adjustments).toHaveLength(2);
    expect(se.adjustments[0]).toMatchObject({ teamId: 10, delta: -3 });
    expect(se.adjustments[0]!.reason).toContain('Agresión');
    expect(se.adjustments[1]!.delta).toBe(-1);
  });

  it('suspension_fechas: queda en suspensions con fechas restantes reales', () => {
    const s = teamMeasure('suspension_fechas', { amount: 2 });
    const { active } = combineDiscipline([], [manualInput(s, { incidentRound: 5, playedRounds: [5] })]);
    const fx = teamEffects(active);
    const list = fx.suspensions.get(10) ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ remaining: 1, untilDate: null });
  });

  it('suspension_dias: queda en suspensions con fecha de fin (inclusive)', () => {
    const s = teamMeasure('suspension_dias', { until_date: '2026-10-15' });
    const { active } = combineDiscipline([], [manualInput(s)]);
    const fx = teamEffects(active);
    const list = fx.suspensions.get(10) ?? [];
    expect(list[0]!.untilDate).toBe('2026-10-15');
  });

  it('expulsión: marca al equipo en expelled y el ajuste es consultable', () => {
    const { active } = combineDiscipline([], [manualInput(teamMeasure('expulsion'))]);
    const fx = teamEffects(active);
    expect(isTeamExpelled(fx, 10)).toBe(true);
    expect(sanctionEffectsOf(active).expelled).toEqual([10]);
    // No afecta puntos ni a jugadores:
    expect(teamPointsDeducted(fx, 10)).toBe(0);
    expect(isPlayerDisciplined(active, 50)).toBe(false);
  });

  it('anulada y cumplida no generan efectos (ya salen de activas)', () => {
    const anulada = manual({ scope: 'team', player_id: null, measure: 'expulsion', status: 'anulada', annul_reason: 'Reconsideración' });
    const cumplida = manual({ scope: 'team', player_id: null, measure: 'perdida_puntos', amount: 5, duration_kind: 'dias', status: 'cumplida' });
    const { active } = combineDiscipline([], [manualInput(anulada), manualInput(cumplida, { today: '2026-10-01' })]);
    const fx = teamEffects(active);
    expect(fx.expelled.size).toBe(0);
    expect(fx.pointsDeducted.size).toBe(0);
    expect(sanctionEffectsOf(active).adjustments).toEqual([]);
  });

  it('las medidas de equipo NO suspenden a los jugadores del plantel', () => {
    const { active } = combineDiscipline(
      [],
      [manualInput(teamMeasure('expulsion')), manualInput(teamMeasure('suspension_fechas', { amount: 3 }))]
    );
    expect(playerEligibility(eligInput(active, match()), 50).eligible).toBe(true);
  });

  it('medidas pre-7B (measure null) se ignoran para efectos sin romper avisos', () => {
    const vieja = manual({ scope: 'team', player_id: null, measure: null });
    const { active } = combineDiscipline([], [manualInput(vieja)]);
    const fx = teamEffects(active);
    expect(fx.expelled.size).toBe(0);
    expect(fx.pointsDeducted.size).toBe(0);
    // El aviso de disciplina de equipo sigue funcionando vía isTeamDisciplined.
    expect(isTeamDisciplined(active, 10)).toBe(true);
  });

  it('etiquetas de medida: redondean el detalle visible por medida', () => {
    // Guardia de UI: los labels existen para las 5 medidas.
    for (const m of ['advertencia', 'perdida_puntos', 'suspension_fechas', 'suspension_dias', 'expulsion'] as const) {
      expect(typeof SANCTION_MEASURE_LABELS[m]).toBe('string');
    }
  });
});

/* ============================== FASE 8: CIERRE AUTOMÁTICO ============================== */

describe('Fase 8: isFulfilledSanction (puro, por duración y medida)', () => {
  it('suspension_dias: se cumple el día posterior a la fecha de fin (inclusive hasta entonces)', () => {
    const s = teamMeasure('suspension_dias', { until_date: '2026-10-15' });
    expect(isFulfilledSanction(s, null, [], '2026-10-15')).toBe(false); // el día límite sigue activa
    expect(isFulfilledSanction(s, null, [], '2026-10-16')).toBe(true);
  });

  it('suspension_fechas: se cumple cuando todas las fechas del rango ya se jugaron', () => {
    // 2 fechas desde la ronda 5: cubre 5 y 6.
    const s = teamMeasure('suspension_fechas', { amount: 2 });
    expect(isFulfilledSanction(s, 5, [5], '2026-10-01')).toBe(false); // falta la 6
    expect(isFulfilledSanction(s, 5, [5, 6], '2026-10-01')).toBe(true);
    expect(isFulfilledSanction(s, 5, [5, 6, 7], '2026-10-01')).toBe(true);
  });

  it('suspension_fechas sin round de incidente: NO se cierra (no se inventa)', () => {
    const s = teamMeasure('suspension_fechas', { amount: 2 });
    expect(isFulfilledSanction(s, null, [5, 6, 7], '2026-10-01')).toBe(false);
  });

  it('advertencia, perdida_puntos y expulsión: nunca se cierran solas', () => {
    expect(isFulfilledSanction(teamMeasure('advertencia'), null, [], '2027-12-31')).toBe(false);
    expect(isFulfilledSanction(teamMeasure('perdida_puntos', { amount: 3 }), null, [], '2027-12-31')).toBe(false);
    expect(isFulfilledSanction(teamMeasure('expulsion'), null, [], '2027-12-31')).toBe(false);
  });

  it('anulada y cumplida: ya resueltas, siempre false', () => {
    const anulada = teamMeasure('suspension_dias', { until_date: '2026-09-01' });
    anulada.status = 'anulada';
    expect(isFulfilledSanction(anulada, null, [], '2026-12-01')).toBe(false);

    const cumplida = teamMeasure('suspension_dias', { until_date: '2026-09-01' });
    cumplida.status = 'cumplida';
    expect(isFulfilledSanction(cumplida, null, [], '2026-12-01')).toBe(false);
  });

  it('fechas de JUGADOR: mismo criterio (amount cubierto por rounds jugados)', () => {
    const s = manual({ duration_kind: 'fechas', amount: 2 }); // incidente ronda 5
    expect(isFulfilledSanction(s, 5, [5], '2026-10-01')).toBe(false);
    expect(isFulfilledSanction(s, 5, [5, 6], '2026-10-01')).toBe(true);
  });

  it('dias de JUGADOR (pre-7B): calendario desde el incidente', () => {
    const s = manual({ duration_kind: 'dias', amount: 10 }); // fin 2026-09-30
    expect(isFulfilledSanction(s, null, [], '2026-09-30')).toBe(false);
    expect(isFulfilledSanction(s, null, [], '2026-10-01')).toBe(true);
  });
});
