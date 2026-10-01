// Tests Fase 13: reprogramación de partidos (src/lib/reschedule.ts).
// Cubre: validación del plan (fecha/hora/cancha, motivo obligatorio, sin
// cambios), bloqueo de partidos ya jugados y de torneos finalizados/archivados.
import { describe, expect, it } from 'vitest';
import { planReschedule } from '../src/lib/reschedule.ts';
import type { Match } from '../src/lib/types.ts';

function mk(partial: Partial<Match> = {}): Match {
  return {
    id: 1,
    tournament_id: 1,
    round: 3,
    zone: '',
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

const base = { tournamentStatus: 'active', reason: 'La cancha está inundada' };

describe('Fase 13: planReschedule', () => {
  it('reprograma fecha y hora de un partido pendiente', () => {
    const plan = planReschedule({ ...base, match: mk(), playedOn: '2026-10-17', kickoffTime: '16:00', venue: '' });
    expect(plan).toMatchObject({ ok: true, playedOn: '2026-10-17', kickoffTime: '16:00', venue: 'Cancha Norte', venueOnly: false });
  });

  it('cambia solo la cancha (mismo día y hora)', () => {
    const plan = planReschedule({ ...base, match: mk(), playedOn: '', kickoffTime: '', venue: 'Cancha Sur' });
    expect(plan).toMatchObject({ ok: true, venue: 'Cancha Sur', venueOnly: true });
  });

  it('campos vacíos conservan el valor actual', () => {
    const plan = planReschedule({ ...base, match: mk(), playedOn: '2026-10-11', kickoffTime: '', venue: '' });
    expect(plan).toMatchObject({ ok: true, kickoffTime: '10:00', venue: 'Cancha Norte' });
  });

  it('motivo obligatorio (con y sin espacios)', () => {
    expect(planReschedule({ ...base, reason: '', match: mk(), playedOn: '2026-10-17', kickoffTime: '', venue: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('motivo'),
    });
    expect(planReschedule({ ...base, reason: '   ', match: mk(), playedOn: '2026-10-17', kickoffTime: '', venue: '' })).toMatchObject({ ok: false });
  });

  it('motivo demasiado largo se rechaza', () => {
    const plan = planReschedule({ ...base, reason: 'x'.repeat(501), match: mk(), playedOn: '2026-10-17', kickoffTime: '', venue: '' });
    expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('demasiado largo') });
  });

  it('rechaza fecha y hora con formato inválido', () => {
    expect(planReschedule({ ...base, match: mk(), playedOn: '10/17/2026', kickoffTime: '', venue: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('fecha'),
    });
    expect(planReschedule({ ...base, match: mk(), playedOn: '', kickoffTime: '25:99', venue: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('hora'),
    });
  });

  it('rechaza cuando nada cambia (valores iguales a los actuales o vacíos)', () => {
    expect(planReschedule({ ...base, match: mk(), playedOn: '', kickoffTime: '', venue: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('No hay cambios'),
    });
    expect(planReschedule({ ...base, match: mk(), playedOn: '2026-10-10', kickoffTime: '10:00', venue: 'Cancha Norte' })).toMatchObject({
      ok: false,
    });
  });

  it('no permite reprogramar un partido ya jugado', () => {
    const jugado = mk({ status: 'played', home_goals: 2, away_goals: 1 });
    const plan = planReschedule({ ...base, match: jugado, playedOn: '2026-10-17', kickoffTime: '', venue: '' });
    expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('ya se jugó') });
    const walkover = mk({ status: 'walkover', home_goals: 3, away_goals: 0 });
    expect(planReschedule({ ...base, match: walkover, playedOn: '2026-10-17', kickoffTime: '', venue: '' })).toMatchObject({ ok: false });
  });

  it('no permite reprogramar en torneo finalizado o archivado (Fase 12C)', () => {
    const fin = planReschedule({ tournamentStatus: 'finished', reason: 'lluvia', match: mk(), playedOn: '2026-10-17', kickoffTime: '', venue: '' });
    expect(fin).toMatchObject({ ok: false, error: expect.stringContaining('finalizado') });
    const arch = planReschedule({ tournamentStatus: 'archived', reason: 'lluvia', match: mk(), playedOn: '2026-10-17', kickoffTime: '', venue: '' });
    expect(arch).toMatchObject({ ok: false, error: expect.stringContaining('archivado') });
  });

  it('un partido de llave pendiente se puede reprogramar como cualquier otro', () => {
    const sf = mk({ bracket_round: 'SF', round: 9, home_team_id: null, away_team_id: null, home_source: 'WQF1', away_source: 'WQF2', played_on: '2026-11-01', venue: '' });
    const plan = planReschedule({ ...base, match: sf, playedOn: '2026-11-08', kickoffTime: '', venue: 'Cancha Sur' });
    expect(plan).toMatchObject({ ok: true, playedOn: '2026-11-08', venue: 'Cancha Sur' });
  });
});
