// Tests Fase 15: calendario operativo del fixture (src/lib/calendar.ts).
// Cubre: estado operativo de cada partido (jugado, pendiente, reprogramado…),
// lectura tolerante de los filtros de la URL, filtrado, conteos, zonas y
// jornadas disponibles, y las líneas de fecha vigente / historial.
import { describe, expect, it } from 'vitest';
import {
  calendarSummaryLine,
  countByState,
  EMPTY_CALENDAR_FILTERS,
  filterMatches,
  hasActiveFilters,
  MATCH_STATE_LABELS,
  MATCH_STATE_TONES,
  matchState,
  needsScheduling,
  parseCalendarFilters,
  rescheduleChangeLine,
  rescheduleDetail,
  rescheduledIds,
  vigenteLine,
  wasRescheduled,
  type CalendarFilters,
} from '../src/lib/calendar.ts';
import type { RescheduleRecord } from '../src/lib/reschedule.ts';
import type { Match } from '../src/lib/types.ts';

function mk(partial: Partial<Match> = {}): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 1,
    zone: 'A',
    bracket_round: '',
    home_team_id: 10,
    away_team_id: 20,
    home_source: '',
    away_source: '',
    played_on: '2026-10-10',
    kickoff_time: '10:00',
    venue: 'Cancha Norte',
    status: 'scheduled',
    home_goals: 0,
    away_goals: 0,
    home_points: null,
    away_points: null,
    notes: '',
    ...partial,
  };
}

function rec(partial: Partial<RescheduleRecord> = {}): RescheduleRecord {
  return {
    id: 1,
    match_id: 1,
    old_played_on: '2026-10-10',
    old_kickoff_time: '10:00',
    old_venue: 'Cancha Norte',
    new_played_on: '2026-10-17',
    new_kickoff_time: '18:00',
    new_venue: 'Cancha Sur',
    reason: 'lluvia',
    created_at: '2026-10-09 18:30:00',
    ...partial,
  };
}

describe('calendar: estado operativo', () => {
  it('jugado y walkover cuentan como jugada', () => {
    expect(matchState(mk({ status: 'played' }))).toBe('jugado');
    expect(matchState(mk({ status: 'walkover' }))).toBe('jugado');
  });

  it('un partido reprogramado y luego jugado pasa a jugado', () => {
    const m = mk({ status: 'played' });
    expect(matchState(m, new Set([m.id]))).toBe('jugado');
  });

  it('bye es libre, suspendido es suspendido y scheduled sin historial es pendiente', () => {
    expect(matchState(mk({ status: 'bye' }))).toBe('libre');
    expect(matchState(mk({ status: 'suspended' }))).toBe('suspendido');
    expect(matchState(mk({ status: 'scheduled' }))).toBe('pendiente');
  });

  it('con historial de reprogramación, el partido pendiente es reprogramado', () => {
    expect(matchState(mk({ id: 7 }), new Set([7]))).toBe('reprogramado');
    expect(wasRescheduled(7, new Set([7]))).toBe(true);
    expect(wasRescheduled(8, new Set([7]))).toBe(false);
    expect(wasRescheduled(7, null)).toBe(false);
  });

  it('un postergado ya reprogramado cuenta como reprogramado (tiene fecha nueva)', () => {
    expect(matchState(mk({ status: 'postponed' }))).toBe('postergado');
    expect(matchState(mk({ status: 'postponed' }), new Set([1]))).toBe('reprogramado');
  });

  it('cada estado tiene etiqueta y tono para la interfaz', () => {
    for (const s of Object.keys(MATCH_STATE_LABELS) as (keyof typeof MATCH_STATE_LABELS)[]) {
      expect(MATCH_STATE_LABELS[s].length).toBeGreaterThan(0);
      expect(MATCH_STATE_TONES[s].length).toBeGreaterThan(0);
    }
  });
});

describe('calendar: filtros', () => {
  const lista = [
    mk({ id: 1, round: 1, zone: 'A' }),
    mk({ id: 2, round: 1, zone: 'B', status: 'played' }),
    mk({ id: 3, round: 2, zone: 'A', status: 'postponed' }),
  ];

  it('lee una query válida', () => {
    const f = parseCalendarFilters({ zona: ' A ', jornada: '3', estado: 'jugado' });
    expect(f).toEqual({ zone: 'A', round: 3, state: 'jugado' });
    expect(hasActiveFilters(f)).toBe(true);
  });

  it('tolera valores raros: todo queda sin filtro', () => {
    expect(parseCalendarFilters({ zona: '', jornada: 'dos', estado: 'inventado' })).toEqual(
      EMPTY_CALENDAR_FILTERS
    );
    expect(parseCalendarFilters({ jornada: '0' }).round).toBeNull();
    expect(parseCalendarFilters({ jornada: '-2' }).round).toBeNull();
    expect(hasActiveFilters(EMPTY_CALENDAR_FILTERS)).toBe(false);
  });

  it('filtra por zona', () => {
    const out = filterMatches(lista, { ...EMPTY_CALENDAR_FILTERS, zone: 'A' });
    expect(out.map((m) => m.id)).toEqual([1, 3]);
  });

  it('filtra por jornada', () => {
    const out = filterMatches(lista, { ...EMPTY_CALENDAR_FILTERS, round: 1 });
    expect(out.map((m) => m.id)).toEqual([1, 2]);
  });

  it('filtra por estado, usando el historial para los reprogramados', () => {
    const reprogramados = new Set([3]);
    const out = filterMatches(lista, { ...EMPTY_CALENDAR_FILTERS, state: 'reprogramado' }, reprogramados);
    expect(out.map((m) => m.id)).toEqual([3]);
    // Sin historial, el postergado sigue siendo postergado.
    const sinHistorial = filterMatches(lista, { ...EMPTY_CALENDAR_FILTERS, state: 'postergado' });
    expect(sinHistorial.map((m) => m.id)).toEqual([3]);
  });

  it('combina filtros (zona + jornada + estado)', () => {
    const f: CalendarFilters = { zone: 'A', round: 1, state: 'pendiente' };
    expect(filterMatches(lista, f).map((m) => m.id)).toEqual([1]);
  });

  it('sin filtros deja la lista completa', () => {
    expect(filterMatches(lista, EMPTY_CALENDAR_FILTERS)).toHaveLength(3);
  });

  it('cuenta por estado', () => {
    const c = countByState([...lista, mk({ id: 4, status: 'bye', zone: '' })], new Set([3]));
    expect(c).toEqual({ jugado: 1, pendiente: 1, reprogramado: 1, postergado: 0, suspendido: 0, libre: 1 });
  });

  it('rescheduledIds saca los partidos del historial, sin repetir', () => {
    const ids = rescheduledIds([rec({ id: 1, match_id: 4 }), rec({ id: 2, match_id: 4 }), rec({ id: 3, match_id: 9 })]);
    expect([...ids].sort((a, b) => a - b)).toEqual([4, 9]);
    expect(rescheduledIds([]).size).toBe(0);
  });
});

describe('calendar: fecha vigente e historial', () => {
  it('la línea vigente muestra día, hora y cancha, y avisa lo que falta', () => {
    expect(vigenteLine({ played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Cancha Norte' })).toBe(
      'sáb 10 oct · 10:00 · Cancha Norte'
    );
    expect(vigenteLine({ played_on: '', kickoff_time: '', venue: '' })).toBe(
      'día a definir · hora a definir · sin cancha'
    );
  });

  it('el detalle de reprogramación muestra la línea vigente y el motivo del último cambio', () => {
    const html = rescheduleDetail({ played_on: '2026-10-17', kickoff_time: '18:00', venue: 'Cancha Sur' }, [rec()]);
    expect(html).toContain('sáb 17 oct · 18:00 · Cancha Sur');
    expect(html).toContain('Motivo: lluvia');
    expect(html).toContain('Antes:');
  });

  it('sin historial no hay detalle', () => {
    const m = { played_on: '2026-10-10', kickoff_time: '10:00', venue: 'Cancha Norte' };
    expect(rescheduleDetail(m, undefined)).toBe('');
    expect(rescheduleDetail(m, [])).toBe('');
  });

  it('la línea de cambio va de antes a después', () => {
    expect(rescheduleChangeLine(rec())).toBe('sáb 10 oct · 10:00 · Cancha Norte → sáb 17 oct · 18:00 · Cancha Sur');
  });

  it('el motivo del usuario va escapado en el detalle', () => {
    const html = rescheduleDetail(
      { played_on: '2026-10-17', kickoff_time: '18:00', venue: 'Cancha Sur' },
      [rec({ reason: '<script>alert(1)</script>' })]
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('avisa cuando al partido scheduled le falta día, hora o cancha', () => {
    expect(needsScheduling(mk({ played_on: '', kickoff_time: '10:00', venue: 'X' }))).toBe(true);
    expect(needsScheduling(mk({ played_on: '2026-10-10', kickoff_time: '', venue: 'X' }))).toBe(true);
    expect(needsScheduling(mk({ played_on: '2026-10-10', kickoff_time: '10:00', venue: '' }))).toBe(true);
    expect(needsScheduling(mk())).toBe(false);
    // Un partido ya jugado no necesita agenda.
    expect(needsScheduling(mk({ status: 'played', kickoff_time: '', venue: '' }))).toBe(false);
  });

  it('el resumen cuenta lo que se está viendo', () => {
    const c = countByState([mk({ id: 1 }), mk({ id: 2, status: 'played' })]);
    expect(calendarSummaryLine(c, 2, 2)).toBe('1 pendiente(s) · 1 jugado(s)');
    expect(calendarSummaryLine(c, 1, 2)).toBe('1 pendiente(s) · 1 jugado(s) · mostrando 1 de 2');
    expect(calendarSummaryLine(countByState([]), 0, 0)).toBe('sin partidos');
  });
});
