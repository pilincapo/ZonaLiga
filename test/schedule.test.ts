import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCHEDULE,
  normalizeKickoff,
  roundSlots,
  scheduleCovers,
  scheduleFromForm,
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

  it('sin datos: listas vacías', () => {
    expect(scheduleFromForm({})).toEqual(EMPTY_SCHEDULE);
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
      venues: ['Cancha 1', 'Cancha 2'],
      kickoffs: ['09:00', '11:00'],
    });
  });
});

describe('roundSlots', () => {
  it('recorre canchas y luego horarios (hora completa en todas las canchas)', () => {
    const s = { venues: ['A', 'B'], kickoffs: ['09:00', '11:00'] };
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
    expect(roundSlots(2, { venues: [], kickoffs: ['10:00'] })).toEqual([
      { venue: '', kickoff: '10:00' },
      { venue: '', kickoff: '10:00' },
    ]);
  });

  it('sin horarios: asigna solo canchas', () => {
    expect(roundSlots(2, { venues: ['La cancha'], kickoffs: [] })).toEqual([
      { venue: 'La cancha', kickoff: '' },
      { venue: 'La cancha', kickoff: '' },
    ]);
  });

  it('sin nada configurado: vacío', () => {
    expect(roundSlots(3, EMPTY_SCHEDULE)).toEqual([]);
  });
});

describe('scheduleCovers', () => {
  it('canchas × horarios vs partidos por jornada', () => {
    expect(scheduleCovers({ venues: ['A', 'B'], kickoffs: ['09:00', '11:00'] }, 3)).toBe(true);
    expect(scheduleCovers({ venues: ['A'], kickoffs: ['09:00'] }, 3)).toBe(false);
    expect(scheduleCovers(EMPTY_SCHEDULE, 0)).toBe(true);
  });
});
