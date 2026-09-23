import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCHEDULE,
  normalizeKickoff,
  normalizeDate,
  plannedRoundDate,
  regenerateRound,
  roundSlots,
  scheduleCapacity,
  scheduleFromForm,
  scheduleGaps,
  formatScheduleGaps,
  scheduleOf,
} from '../src/lib/schedule.ts';

describe('normalizeKickoff', () => {
  it('acepta variantes comunes y normaliza a HH:MM', () => {
    expect(normalizeKickoff('9')).toBe('09:00');
    expect(normalizeKickoff('9:30')).toBe('09:30');
    expect(normalizeKickoff('09:05')).toBe('09:05');
  });

  it('rechaza inválidos', () => {
    expect(normalizeKickoff('25:00')).toBeNull();
    expect(normalizeKickoff('9:75')).toBeNull();
    expect(normalizeKickoff('abc')).toBeNull();
    expect(normalizeKickoff('')).toBeNull();
  });
});

describe('scheduleFromForm', () => {
  it('limpia, quita repetidos y normaliza horarios', () => {
    const s = scheduleFromForm({
      venues: ' Cancha 1 , cancha 1\nCancha 2',
      kickoffs: '9, 10:30,abc,11',
    });
    expect(s.venues).toEqual(['Cancha 1', 'Cancha 2']);
    expect(s.kickoffs).toEqual(['09:00', '10:30', '11:00']);
  });

  it('lee fecha de inicio y días entre jornadas con defaults sanos', () => {
    expect(scheduleFromForm({ start_date: '2026-10-05', round_gap: '10' })).toEqual({
      ...EMPTY_SCHEDULE,
      startDate: '2026-10-05',
      roundGapDays: 10,
    });
    // Fecha imposible o gap fuera de rango → defaults (sin fecha / 7 días).
    expect(scheduleFromForm({ start_date: '2026-02-30', round_gap: '99' })).toEqual(EMPTY_SCHEDULE);
    expect(scheduleFromForm({}).roundGapDays).toBe(7);
  });

  it('día de juego desde el form: 0–6, vacío o basura = sin preferencia', () => {
    expect(scheduleFromForm({ play_weekday: '6' }).playWeekday).toBe(6);
    expect(scheduleFromForm({ play_weekday: '0' }).playWeekday).toBe(0); // domingo, distinto de vacío
    expect(scheduleFromForm({ play_weekday: '' }).playWeekday).toBeNull();
    expect(scheduleFromForm({ play_weekday: 'sab' }).playWeekday).toBeNull();
    expect(scheduleFromForm({}).playWeekday).toBeNull();
  });

  it('sin datos: listas vacías', () => {
    expect(scheduleFromForm({})).toEqual(EMPTY_SCHEDULE);
  });
});

describe('normalizeDate', () => {
  it('acepta fechas reales y rechaza imposibles', () => {
    expect(normalizeDate('2026-10-05')).toBe('2026-10-05');
    expect(normalizeDate(' 2026-1-5 ')).toBeNull(); // formato estricto
    expect(normalizeDate('2026-02-30')).toBeNull(); // no existe
    expect(normalizeDate('mañana')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });
});

describe('scheduleOf', () => {
  it('tolera config ausente, corrupto o sin la clave', () => {
    expect(scheduleOf('')).toEqual(EMPTY_SCHEDULE);
    expect(scheduleOf('no-json')).toEqual(EMPTY_SCHEDULE);
    expect(scheduleOf(JSON.stringify({ win: 3 }))).toEqual(EMPTY_SCHEDULE);
  });

  it('lee desde el mismo JSON donde viven las reglas', () => {
    const config = JSON.stringify({ win: 3, venues: ['Cancha 1', 'Cancha 2'], kickoffs: ['09:00', '11:00'] });
    expect(scheduleOf(config)).toEqual({
      ...EMPTY_SCHEDULE,
      venues: ['Cancha 1', 'Cancha 2'],
      kickoffs: ['09:00', '11:00'],
    });
  });

  it('lee la fecha de inicio y valida fechas imposibles', () => {
    const config = JSON.stringify({ startDate: '2026-10-05', roundGapDays: 10 });
    expect(scheduleOf(config)).toEqual({ ...EMPTY_SCHEDULE, startDate: '2026-10-05', roundGapDays: 10 });
    expect(scheduleOf(JSON.stringify({ startDate: '2026-13-40' })).startDate).toBe('');
    expect(scheduleOf(JSON.stringify({ roundGapDays: 0 })).roundGapDays).toBe(7);
  });

  it('lee el día de juego y tolera valores viejos o basura', () => {
    expect(scheduleOf(JSON.stringify({ playWeekday: 6 })).playWeekday).toBe(6);
    expect(scheduleOf('{}').playWeekday).toBeNull();
    expect(scheduleOf(JSON.stringify({ playWeekday: 'sábado' })).playWeekday).toBeNull();
    expect(scheduleOf(JSON.stringify({ playWeekday: 9 })).playWeekday).toBeNull();
  });
});

describe('roundSlots', () => {
  it('recorre canchas y luego horarios (hora completa en todas las canchas)', () => {
    const s = { ...EMPTY_SCHEDULE, venues: ['A', 'B'], kickoffs: ['09:00', '11:00'] };
    const slots = roundSlots(5, s);
    expect(slots.slice(0, 4)).toEqual([
      { venue: 'A', kickoff: '09:00' },
      { venue: 'B', kickoff: '09:00' },
      { venue: 'A', kickoff: '11:00' },
      { venue: 'B', kickoff: '11:00' },
    ]);
    expect(slots[4]).toEqual({ venue: 'A', kickoff: '09:00' });
  });

  it('sin canchas: asigna solo horarios', () => {
    expect(roundSlots(2, { ...EMPTY_SCHEDULE, kickoffs: ['10:00'] })).toEqual([
      { venue: '', kickoff: '10:00' },
      { venue: '', kickoff: '10:00' },
    ]);
  });

  it('sin horarios: asigna solo canchas', () => {
    expect(roundSlots(2, { ...EMPTY_SCHEDULE, venues: ['La cancha'] })).toEqual([
      { venue: 'La cancha', kickoff: '' },
      { venue: 'La cancha', kickoff: '' },
    ]);
  });

  it('sin nada configurado: vacío', () => {
    expect(roundSlots(3, EMPTY_SCHEDULE)).toEqual([]);
  });
});

describe('scheduleGaps / formatScheduleGaps', () => {
  it('sin canchas ni horarios no avisa (opción válida)', () => {
    expect(scheduleGaps(EMPTY_SCHEDULE, [{ round: 1, count: 4 }])).toEqual([]);
    expect(formatScheduleGaps([])).toBe('');
  });

  it('todo entra (incluso exactamente lleno): sin avisos', () => {
    const s = { ...EMPTY_SCHEDULE, venues: ['A', 'B'], kickoffs: ['10:00'] }; // 2 slots
    expect(scheduleGaps(s, [{ round: 1, count: 2 }, { round: 2, count: 1 }])).toEqual([]);
  });

  it('las fechas que se pasan dicen cuántos slots faltan', () => {
    const s = { ...EMPTY_SCHEDULE, venues: ['A'], kickoffs: ['10:00'] }; // 1 slot
    const gaps = scheduleGaps(s, [
      { round: 1, count: 1 },
      { round: 2, count: 3 },
      { round: 3, count: 2 },
    ]);
    expect(gaps).toEqual([
      { round: 2, needed: 3, capacity: 1, missing: 2 },
      { round: 3, needed: 2, capacity: 1, missing: 1 },
    ]);
  });

  it('solo horarios sin canchas cuenta como 1 cancha fantasma', () => {
    const s = { ...EMPTY_SCHEDULE, kickoffs: ['10:00', '12:00'] };
    expect(scheduleCapacity(s)).toBe(2);
    expect(scheduleGaps(s, [{ round: 1, count: 3 }])[0]!.missing).toBe(1);
  });

  it('el aviso nombra la fecha, los partidos y los slots que faltan', () => {
    const text = formatScheduleGaps([{ round: 4, needed: 3, capacity: 2, missing: 1 }]);
    expect(text).toContain('no alcanzan');
    expect(text).toContain('fecha 4');
    expect(text).toContain('3 partidos');
    expect(text).toContain('slot falta');
    expect(text).toContain('2 slot(s) por fecha');
  });
});

describe('plannedRoundDate', () => {
  const s = { ...EMPTY_SCHEDULE, startDate: '2026-10-05', roundGapDays: 7 };

  it('la fecha 1 es el inicio y cada jornada avanza el gap', () => {
    expect(plannedRoundDate(s, 1)).toBe('2026-10-05');
    expect(plannedRoundDate(s, 2)).toBe('2026-10-12');
    expect(plannedRoundDate(s, 5)).toBe('2026-11-02');
  });

  it('respeta gaps que no son 7 (mitad de semana)', () => {
    expect(plannedRoundDate({ ...s, roundGapDays: 3 }, 3)).toBe('2026-10-11');
  });

  it('cruza meses y años', () => {
    expect(plannedRoundDate({ ...s, startDate: '2026-12-28' }, 2)).toBe('2027-01-04');
  });

  it('sin fecha de inicio o ronda inválida: vacío', () => {
    expect(plannedRoundDate(EMPTY_SCHEDULE, 1)).toBe('');
    expect(plannedRoundDate(s, 0)).toBe('');
    expect(plannedRoundDate(s, NaN)).toBe('');
  });

  it('con día de juego, todas las jornadas caen en ese día (liga de sábados)', () => {
    // 2026-10-05 es lunes; con playWeekday 6 (sábado) la 1ª es 2026-10-10.
    const sab = { ...s, playWeekday: 6 };
    expect(plannedRoundDate(sab, 1)).toBe('2026-10-10');
    expect(plannedRoundDate(sab, 2)).toBe('2026-10-17');
    expect(plannedRoundDate(sab, 5)).toBe('2026-11-07');
    for (const n of [1, 2, 5]) {
      expect(new Date(`${plannedRoundDate(sab, n)}T00:00:00Z`).getUTCDay()).toBe(6);
    }
  });

  it('si la fecha de inicio ya es el día elegido, no se corre', () => {
    expect(plannedRoundDate({ ...s, startDate: '2026-10-03', playWeekday: 6 }, 1)).toBe('2026-10-03');
    expect(plannedRoundDate({ ...s, startDate: '2026-10-03', playWeekday: 6 }, 2)).toBe('2026-10-10');
  });

  it('día de juego null mantiene el comportamiento anterior', () => {
    expect(plannedRoundDate({ ...s, playWeekday: null }, 1)).toBe('2026-10-05');
    expect(plannedRoundDate(s, 2)).toBe('2026-10-12');
  });
});

describe('regenerateRound', () => {
  const sched = { ...EMPTY_SCHEDULE, venues: ['Cancha Norte', 'Cancha Sur'], kickoffs: ['10:00', '12:00'] };
  const mk = (id: number, over: Partial<import('../src/lib/schedule.ts').RoundMatchInput> = {}) => ({
    id,
    played_on: '2026-10-05',
    kickoff_time: '09:00',
    venue: 'Vieja',
    status: 'scheduled',
    ...over,
  });

  it('re-slotea hora y cancha de toda la jornada', () => {
    const out = regenerateRound([mk(1), mk(2), mk(3)], sched);
    expect(out.map((u) => [u.kickoff, u.venue])).toEqual([
      ['10:00', 'Cancha Norte'],
      ['10:00', 'Cancha Sur'],
      ['12:00', 'Cancha Norte'],
    ]);
  });

  it('corre todos los partidos un día (inicio atrasado)', () => {
    const out = regenerateRound([mk(1), mk(2)], sched, 1);
    expect(out.every((u) => u.played_on === '2026-10-06')).toBe(true);
    expect(out[0]!.kickoff).toBe('10:00');
  });

  it('adelanta con días negativos', () => {
    const out = regenerateRound([mk(1, { played_on: '2026-10-05' })], sched, -2);
    expect(out[0]!.played_on).toBe('2026-10-03');
  });

  it('no toca partidos jugados ni bye', () => {
    const out = regenerateRound(
      [mk(1, { status: 'played' }), mk(2, { status: 'bye' }), mk(3)],
      sched,
      1
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(3);
  });

  it('sin canchas/horarios conserva los actuales (solo corre el día)', () => {
    const out = regenerateRound([mk(1)], EMPTY_SCHEDULE, 1);
    expect(out[0]).toEqual({ id: 1, played_on: '2026-10-06', kickoff: '09:00', venue: 'Vieja' });
  });

  it('corre el día de fechas vacías sin romper', () => {
    const out = regenerateRound([mk(1, { played_on: '' })], sched, 1);
    expect(out[0]!.played_on).toBe('');
  });
});
