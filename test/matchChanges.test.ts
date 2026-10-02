// Fase 17 (cierre): bitácora de cambios por partido.
// Acá se prueban las funciones puras: comparar dos versiones de un partido,
// armar las frases de los eventos y la regla del motivo obligatorio de "Libre".
// Lo que toca la base (insertMatchChanges / listMatchChanges) se prueba en el e2e.

import { describe, expect, it } from 'vitest';
import {
  ACTION_LABELS,
  ACTOR_ADMIN,
  ACTOR_SYSTEM,
  cancelReasonError,
  cleanReason,
  delegateActor,
  describeEvent,
  diffEvents,
  diffMatch,
  eventChange,
  goalAuthorsChange,
  goalAuthorsLabel,
  needsCancelReason,
  type EventRow,
  type MatchSnapshot,
} from '../src/lib/matchChanges.ts';
import { EVENT_TYPE_LABELS, MATCH_STATUS_LABELS } from '../src/lib/matchOps.ts';

/** Un partido cualquiera, con todos los campos que mira el diff. */
function snap(over: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    played_on: '2026-05-10',
    kickoff_time: '18:00',
    venue: 'Cancha 1',
    notes: '',
    home_team_id: 1,
    away_team_id: 2,
    round: 3,
    zone: 'A',
    ...over,
  };
}

const NOMBRES = { 1: 'Deportivo', 2: 'Racing' };

describe('matchChanges: actores', () => {
  it('usa texto, no ids: el panel tiene una sola contraseña y no hay usuarios', () => {
    expect(ACTOR_ADMIN).toBe('admin');
    expect(ACTOR_SYSTEM).toBe('sistema');
  });

  it('el actor de un delegado dice de qué equipo es', () => {
    expect(delegateActor(7)).toBe('delegado:7');
  });

  it('todas las acciones tienen cómo se leen en la bitácora', () => {
    for (const label of Object.values(ACTION_LABELS)) expect(label.length).toBeGreaterThan(0);
    expect(ACTION_LABELS.estado).toBe('Estado');
    expect(ACTION_LABELS.evento).toBe('Evento');
  });
});

describe('matchChanges: diffMatch', () => {
  it('si no cambió nada, no escribe nada (guardar sin tocar no ensucia el historial)', () => {
    expect(diffMatch(snap(), snap())).toEqual([]);
  });

  it('detecta el cambio de estado', () => {
    const cambios = diffMatch(snap({ status: 'scheduled' }), snap({ status: 'played' }));
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.action).toBe('estado');
    expect(cambios[0]!.field).toBe('status');
    expect(cambios[0]!.oldValue).toBe('scheduled');
    expect(cambios[0]!.newValue).toBe('played');
  });

  it('detecta el marcador como un solo campo "resultado"', () => {
    const cambios = diffMatch(snap({ home_goals: 0, away_goals: 0 }), snap({ home_goals: 2, away_goals: 1 }));
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.action).toBe('resultado');
    expect(cambios[0]!.newValue).toBe('2-1');
  });

  it('los puntos sin override se muestran como "auto"', () => {
    const cambios = diffMatch(snap(), snap({ home_points: 3 }));
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.action).toBe('puntos');
    expect(cambios[0]!.oldValue).toBe('auto - auto');
    expect(cambios[0]!.newValue).toBe('3 - auto');
  });

  it('día, hora y cancha se siguen por separado (reprogramación)', () => {
    const cambios = diffMatch(
      snap({ played_on: '2026-05-10', kickoff_time: '18:00', venue: 'Cancha 1' }),
      snap({ played_on: '2026-05-17', kickoff_time: '20:30', venue: 'Cancha 2' })
    );
    expect(cambios.map((c) => c.action).sort()).toEqual(['cancha', 'dia', 'hora']);
  });

  it('los equipos se muestran por nombre, nunca por id', () => {
    const cambios = diffMatch(snap(), snap({ away_team_id: 9 }), { teamNames: NOMBRES });
    expect(cambios).toHaveLength(1);
    expect(cambios[0]!.action).toBe('equipos');
    expect(cambios[0]!.oldValue).toBe('Racing');
    expect(cambios[0]!.newValue).toBe('equipo 9');
  });

  it('un equipo sin definir se lee "Por definir"', () => {
    const cambios = diffMatch(snap(), snap({ home_team_id: null }));
    expect(cambios[0]!.newValue).toBe('Por definir');
  });

  it('la fecha del torneo y la zona se anotan como "partido"', () => {
    const cambios = diffMatch(snap(), snap({ round: 4, zone: 'B' }));
    expect(cambios.map((c) => c.action)).toEqual(['partido', 'partido']);
    expect(cambios[0]!.newValue).toBe('4');
    expect(cambios[1]!.newValue).toBe('B');
  });

  it('sin fecha se lee "sin fecha"', () => {
    const cambios = diffMatch(snap(), snap({ round: null }));
    expect(cambios[0]!.newValue).toBe('sin fecha');
  });

  it('las notas se guardan (incluido cuando se borran)', () => {
    expect(diffMatch(snap({ notes: 'llovió' }), snap({ notes: '' }))[0]!.newValue).toBe('');
  });

  it('el motivo se repite en todas las filas del guardado', () => {
    const cambios = diffMatch(snap(), snap({ status: 'played', home_goals: 1 }), { reason: '  corregido  ' });
    expect(cambios).toHaveLength(2);
    for (const c of cambios) expect(c.reason).toBe('corregido');
  });

  it('varias filas: una por campo que cambió', () => {
    const cambios = diffMatch(snap(), snap({ status: 'played', home_goals: 3, away_goals: 0, venue: 'Cancha 5' }));
    expect(cambios.map((c) => c.field)).toEqual(['status', 'resultado', 'venue']);
  });
});

describe('matchChanges: eventos', () => {
  it('describe un evento con nombre de jugador y minuto', () => {
    expect(describeEvent({ type: 'goal', minute: 23, player_id: 5 }, 'Soto')).toBe('goal · Soto 23\'');
    expect(describeEvent({ type: 'yellow', minute: null, player_id: 5 }, 'Soto')).toBe('yellow · Soto');
  });

  it('si el jugador ya no existe, cae al id antes de perder el registro', () => {
    expect(describeEvent({ type: 'goal', minute: 5, player_id: 99 })).toBe('goal · #99 5\'');
  });

  it('un evento sin jugador se dice así', () => {
    expect(describeEvent({ type: 'own_goal', minute: null, player_id: null })).toBe('own_goal · sin jugador');
  });

  it('el evento agregado llena el "después" y el eliminado el "antes"', () => {
    const ev = { type: 'goal' as const, minute: 10, player_id: 1 };
    const alta = eventChange(ev, 'Soto', EVENT_TYPE_LABELS.goal, 'agregado');
    expect(alta).toMatchObject({ action: 'evento', field: 'agregado', oldValue: '', newValue: 'Gol · Soto 10\'' });
    const baja = eventChange(ev, 'Soto', EVENT_TYPE_LABELS.goal, 'eliminado');
    expect(baja).toMatchObject({ action: 'evento', field: 'eliminado', oldValue: 'Gol · Soto 10\'', newValue: '' });
  });

  it('diffEvents: lo que se agrega y lo que se quita, uno por uno', () => {
    const antes: EventRow[] = [{ type: 'goal', team_id: 1, player_id: 1, minute: 10 }];
    const despues: EventRow[] = [{ type: 'yellow', team_id: 1, player_id: 2, minute: 20 }];
    const cambios = diffEvents(antes, despues, { 1: 'Soto', 2: 'Díaz' }, EVENT_TYPE_LABELS, 'entrega');
    expect(cambios.map((c) => c.field)).toEqual(['agregado', 'eliminado']);
    expect(cambios[0]!.newValue).toBe('Amarilla · Díaz 20\'');
    expect(cambios[1]!.oldValue).toBe('Gol · Soto 10\'');
    expect(cambios.every((c) => c.reason === 'entrega')).toBe(true);
  });

  it('diffEvents: si la lista es la misma, no hay cambios (no marca ruido)', () => {
    const evs: EventRow[] = [{ type: 'goal', team_id: 1, player_id: 1, minute: 10 }];
    expect(diffEvents(evs, [...evs], {}, EVENT_TYPE_LABELS)).toEqual([]);
  });

  it('diffEvents: reordenar la misma lista tampoco genera cambios', () => {
    const a = { type: 'goal' as const, team_id: 1, player_id: 1, minute: 10 };
    const b = { type: 'yellow' as const, team_id: 2, player_id: 2, minute: 30 };
    expect(diffEvents([a, b], [b, a], {}, EVENT_TYPE_LABELS)).toEqual([]);
  });

  it('los goles en contra no se atribuyen a nadie', () => {
    const label = goalAuthorsLabel(
      [
        { type: 'goal', team_id: 1, player_id: 1 },
        { type: 'own_goal', team_id: 1, player_id: null },
      ],
      { home: 1, away: 2 },
      { 1: 'Soto' }
    );
    expect(label).toBe('Local: Soto, en contra · Visitante: —');
  });

  it('sin goles cargados se leen "—" a los dos lados', () => {
    expect(goalAuthorsLabel([], { home: 1, away: 2 }, {})).toBe('Local: — · Visitante: —');
  });

  it('el cambio de autores asienta el antes y el después', () => {
    const cambio = goalAuthorsChange('Local: — · Visitante: —', 'Local: Soto · Visitante: —', 'corregido');
    expect(cambio).toEqual({
      action: 'evento',
      field: 'autores',
      oldValue: 'Local: — · Visitante: —',
      newValue: 'Local: Soto · Visitante: —',
      reason: 'corregido',
    });
  });
});

describe('matchChanges: motivo obligatorio para cancelar (Libre)', () => {
  it('pide motivo al entrar a Libre y no al seguir en Libre', () => {
    expect(needsCancelReason('scheduled', 'bye')).toBe(true);
    expect(needsCancelReason('postponed', 'bye')).toBe(true);
    expect(needsCancelReason('bye', 'bye')).toBe(false);
  });

  it('no pide motivo para los demás cambios de estado', () => {
    for (const s of ['scheduled', 'played', 'postponed', 'suspended', 'walkover'] as const) {
      expect(needsCancelReason('bye', s)).toBe(false);
    }
  });

  it('el mensaje de error dice qué falta y por qué importa', () => {
    const msg = cancelReasonError('bye');
    expect(msg).toContain(MATCH_STATUS_LABELS.bye);
    expect(msg).toContain('bitácora');
  });

  it('cleanReason: recorta espacios, tolerate vacíos y tops los 500 caracteres', () => {
    expect(cleanReason('  se cancela  ')).toBe('se cancela');
    expect(cleanReason(undefined)).toBe('');
    expect(cleanReason(null)).toBe('');
    expect(cleanReason('x'.repeat(900))).toHaveLength(500);
  });
});
