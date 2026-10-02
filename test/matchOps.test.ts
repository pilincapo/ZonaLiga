import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  MATCH_STATUSES,
  eventBelongsToMatch,
  goalOverwriteError,
  goalOverwriteNotice,
  isEventType,
  isMatchStatus,
  isSideTeam,
  MAX_POINTS_OVERRIDE,
  needsGoalOverwriteConfirm,
  parseGoals,
  parseKickoff,
  parseMinute,
  parseNotes,
  parsePlayedOn,
  parsePointsOverride,
  parseVenue,
  validateEventForm,
  validateSheetForm,
} from '../src/lib/matchOps.ts';
import { MAX_GOALS } from '../src/lib/sheet.ts';

describe('matchOps: estados y tipos', () => {
  it('acepta exactamente los estados del CHECK de la base', () => {
    for (const s of MATCH_STATUSES) expect(isMatchStatus(s)).toBe(true);
    expect([...MATCH_STATUSES]).toContain('bye');
    expect(isMatchStatus('inventado')).toBe(false);
    expect(isMatchStatus('')).toBe(false);
    expect(isMatchStatus(null)).toBe(false);
    expect(isMatchStatus(3)).toBe(false);
  });

  it('acepta exactamente los tipos de evento del CHECK de la base', () => {
    expect([...EVENT_TYPES]).toEqual(['goal', 'own_goal', 'yellow', 'red']);
    for (const t of EVENT_TYPES) expect(isEventType(t)).toBe(true);
    expect(isEventType('amarillo')).toBe(false);
    expect(isEventType('')).toBe(false);
  });
});

describe('matchOps: campos sueltos', () => {
  it('fecha: acepta vacía y AAAA-MM-DD real; rechaza formato y fecha inexistente', () => {
    expect(parsePlayedOn('')).toEqual({ ok: true, value: '' });
    expect(parsePlayedOn(' 2026-11-09 ')).toEqual({ ok: true, value: '2026-11-09' });
    expect(parsePlayedOn('9/11/2026').ok).toBe(false);
    expect(parsePlayedOn('2026-02-31').ok).toBe(false);
    expect(parsePlayedOn('2026-13-01').ok).toBe(false);
  });

  it('hora: acepta vacía y HH:MM; rechaza basura y horas imposibles', () => {
    expect(parseKickoff('10:00')).toEqual({ ok: true, value: '10:00' });
    expect(parseKickoff('')).toEqual({ ok: true, value: '' });
    expect(parseKickoff('24:00').ok).toBe(false);
    expect(parseKickoff('10:60').ok).toBe(false);
    expect(parseKickoff('mediodia').ok).toBe(false);
  });

  it('cancha y notas tienen tope de largo', () => {
    expect(parseVenue('Cancha Norte')).toEqual({ ok: true, value: 'Cancha Norte' });
    expect(parseVenue('x'.repeat(201)).ok).toBe(false);
    expect(parseNotes('ok').ok).toBe(true);
    expect(parseNotes('x'.repeat(1001)).ok).toBe(false);
  });

  it('goles: entero de 0 a MAX_GOALS, vacío = 0', () => {
    expect(parseGoals('', 'Local')).toEqual({ ok: true, value: 0 });
    expect(parseGoals('3', 'Local')).toEqual({ ok: true, value: 3 });
    expect(parseGoals('-1', 'Local').ok).toBe(false);
    expect(parseGoals('1.5', 'Local').ok).toBe(false);
    expect(parseGoals(String(MAX_GOALS + 1), 'Local').ok).toBe(false);
    expect(parseGoals('abc', 'Local').ok).toBe(false);
  });

  it('minuto: vacío o entero de 0 a 130 (antes pasaban -5 y 500)', () => {
    expect(parseMinute('')).toEqual({ ok: true, value: null });
    expect(parseMinute('45')).toEqual({ ok: true, value: 45 });
    expect(parseMinute('-5').ok).toBe(false);
    expect(parseMinute('500').ok).toBe(false);
    expect(parseMinute('12.5').ok).toBe(false);
  });

  it('puntos a mano: vacío = automático, o entero en rango (antes guardaba 99)', () => {
    expect(parsePointsOverride('', 'Puntos del local')).toEqual({ ok: true, value: null });
    expect(parsePointsOverride('0', 'Puntos del local')).toEqual({ ok: true, value: 0 });
    expect(parsePointsOverride('3', 'Puntos del local')).toEqual({ ok: true, value: 3 });
    // El mismo campo carga los penales de las llaves: tiene que dar más de 3.
    expect(parsePointsOverride('5', 'Puntos del local')).toEqual({ ok: true, value: 5 });
    expect(parsePointsOverride('99', 'Puntos del local').ok).toBe(false);
    expect(parsePointsOverride('-1', 'Puntos del local').ok).toBe(false);
    expect(parsePointsOverride('1.5', 'Puntos del local').ok).toBe(false);
  });
});

describe('matchOps: isSideTeam', () => {
  it('solo acepta los dos equipos del partido', () => {
    expect(isSideTeam(10, 10, 20)).toBe(true);
    expect(isSideTeam(20, 10, 20)).toBe(true);
    expect(isSideTeam(30, 10, 20)).toBe(false);
    expect(isSideTeam('', 10, 20)).toBe(false);
    expect(isSideTeam(10, null, null)).toBe(false);
  });
});

describe('matchOps: planilla', () => {
  const ok = {
    status: 'played',
    home_goals: '2',
    away_goals: '1',
    home_points: '',
    away_points: '',
    played_on: '2026-11-09',
    kickoff_time: '18:00',
    venue: 'Cancha Norte',
    notes: '',
  };

  it('arma los datos de una planilla válida', () => {
    const r = validateSheetForm(ok, { authoredGoals: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      status: 'played',
      homeGoals: 2,
      awayGoals: 1,
      homePoints: null,
      awayPoints: null,
      playedOn: '2026-11-09',
      kickoffTime: '18:00',
      venue: 'Cancha Norte',
      notes: '',
    });
  });

  it('rechaza estado inválido o ausente con un mensaje legible (antes: error 500)', () => {
    const r = validateSheetForm({ ...ok, status: 'inventado' }, { authoredGoals: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Estado inválido');
    expect(r.error).toContain('Programado');
    const vacio = validateSheetForm({ ...ok, status: '' }, { authoredGoals: 0 });
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.error).toContain('Falta elegir el estado');
  });

  it('rechaza puntos a mano fuera de rango', () => {
    const r = validateSheetForm({ ...ok, home_points: '99' }, { authoredGoals: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`0 a ${MAX_POINTS_OVERRIDE}`);
  });

  it('pide confirmación al bajar el marcador con autores cargados', () => {
    const bajando = validateSheetForm({ ...ok, home_goals: '0', away_goals: '0' }, { authoredGoals: 3 });
    expect(bajando.ok).toBe(false);
    if (!bajando.ok) expect(bajando.error).toContain('autor');

    const confirmado = validateSheetForm(
      { ...ok, home_goals: '0', away_goals: '0', confirm_goles: '1' },
      { authoredGoals: 3 }
    );
    expect(confirmado.ok).toBe(true);
  });

  it('no pide confirmación si no se pierde ningún autor', () => {
    expect(validateSheetForm({ ...ok, home_goals: '2', away_goals: '1' }, { authoredGoals: 2 }).ok).toBe(true);
    expect(validateSheetForm({ ...ok, home_goals: '0' }, { authoredGoals: 0 }).ok).toBe(true);
  });
});

describe('matchOps: aviso de sobrescritura de autores', () => {
  it('solo avisa cuando se pierden autores', () => {
    expect(goalOverwriteNotice(0, 0)).toBeNull();
    expect(goalOverwriteNotice(3, 3)).toBeNull();
    expect(goalOverwriteNotice(3, 4)).toBeNull();
    expect(goalOverwriteNotice(3, 0)).toContain('3 autores');
    expect(goalOverwriteNotice(3, 2)).toContain('1 autor de gol');
    expect(goalOverwriteNotice(1, 0)).toContain('1 autor de gol que ya está cargado');
  });

  it('el error pide marcar la casilla', () => {
    expect(goalOverwriteError(3, 0)).toContain('casilla de confirmación');
  });

  it('needsGoalOverwriteConfirm sólo dispara sin confirmar', () => {
    expect(needsGoalOverwriteConfirm(3, 0, false)).toBe(true);
    expect(needsGoalOverwriteConfirm(3, 0, true)).toBe(false);
    expect(needsGoalOverwriteConfirm(3, 3, false)).toBe(false);
  });
});

describe('matchOps: alta de evento', () => {
  const ctx = { homeTeamId: 10, awayTeamId: 20, homeRoster: [1, 2], awayRoster: [3, 4] };

  it('acepta un evento válido', () => {
    const r = validateEventForm({ team_id: '10', player_id: '2', type: 'yellow', minute: '30' }, ctx);
    expect(r).toEqual({ ok: true, value: { teamId: 10, playerId: 2, type: 'yellow', minute: 30 } });
  });

  it('deja el minuto vacío cuando no se informa', () => {
    const r = validateEventForm({ team_id: '20', player_id: '3', type: 'goal', minute: '' }, ctx);
    expect(r.ok && r.value.minute).toBeNull();
  });

  it('rechaza tipo inválido con mensaje legible (antes: error 500)', () => {
    const r = validateEventForm({ team_id: '10', player_id: '2', type: 'amarillo' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Tipo de evento inválido');
  });

  it('rechaza el minuto fuera de rango (antes: -5 y 500 se guardaban)', () => {
    expect(validateEventForm({ team_id: '10', player_id: '2', type: 'yellow', minute: '-5' }, ctx).ok).toBe(false);
    expect(validateEventForm({ team_id: '10', player_id: '2', type: 'yellow', minute: '500' }, ctx).ok).toBe(false);
  });

  it('rechaza un equipo que no es del partido (antes contaminaba tarjetas públicas)', () => {
    const r = validateEventForm({ team_id: '30', player_id: '1', type: 'yellow' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('equipo del partido');
  });

  it('rechaza un jugador que no es de ese lado', () => {
    const r = validateEventForm({ team_id: '10', player_id: '3', type: 'yellow' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('plantilla del equipo');
  });
});

describe('matchOps: el evento tiene que ser del partido que se está editando', () => {
  it('reconoce el evento propio y rechaza el ajeno', () => {
    expect(eventBelongsToMatch({ match_id: 7 }, 7)).toBe(true);
    expect(eventBelongsToMatch({ match_id: 8 }, 7)).toBe(false);
    expect(eventBelongsToMatch(null, 7)).toBe(false);
    expect(eventBelongsToMatch(undefined, 7)).toBe(false);
  });
});