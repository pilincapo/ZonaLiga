// Tests de sanciones disciplinarias manuales: parseo/validación del form,
// predicates de vigencia y CRUD contra un stub mínimo de D1. El cálculo
// automático por tarjetas (computeSuspensions) NO interviene acá.

import { describe, expect, it } from 'vitest';
import {
  SANCTION_MEASURE_LABELS,
  addDays,
  annulSanction,
  coversDate,
  coversRound,
  effectiveStatus,
  getSanction,
  insertSanction,
  isValidIsoDate,
  parseAnnulment,
  parseSanction,
  sanctionEndDate,
  sanctionsForTournament,
  activeSanctionsForTournament,
  MAX_AMOUNT,
} from '../src/lib/sanctions.ts';

/** Stub mínimo de D1: captura SQL y devuelve lo encolado por clave exacta. */
function dbStub(results: Record<string, unknown[]> = {}) {
  const runs: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const one = {
        all: async <T>() => ({ results: (results[sql] ?? []) as T[] }),
        first: async <T>() => (results[sql] ?? [])[0] as T | undefined,
        run: async () => ({ meta: {} }),
      };
      return {
        ...one,
        bind: (...params: unknown[]) => {
          runs.push({ sql, params });
          return one;
        },
      };
    },
    async batch() {
      return [];
    },
  };
  return { db: db as unknown as D1Database, runs };
}

const validForm = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tournament_id: '1',
  team_id: '10',
  player_id: '77',
  scope: 'player',
  duration_kind: 'fechas',
  amount: '2',
  incident_date: '2026-09-20',
  category: 'Inconducta',
  description: 'Incidente con el árbitro',
  notes: '',
  ...overrides,
});

describe('isValidIsoDate / addDays', () => {
  it('acepta fechas reales y rechaza las imposibles', () => {
    expect(isValidIsoDate('2026-09-29')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('29-09-2026')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });

  it('suma días en UTC sin sorpresas de zona', () => {
    expect(addDays('2026-09-28', 4)).toBe('2026-10-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('no-fecha', 3)).toBe('no-fecha');
  });
});

describe('parseSanction', () => {
  it('alta válida de jugador por fechas', () => {
    const r = parseSanction(validForm());
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ scope: 'player', playerId: 77, durationKind: 'fechas', amount: 2, untilDate: null });
  });

  it('sanción de equipo: sin player_id', () => {
    const r = parseSanction(validForm({ scope: 'team', player_id: '' }));
    expect(r.ok).toBe(true);
    expect(r.value!.scope).toBe('team');
    expect(r.value!.playerId).toBeNull();
  });

  it('scope player sin jugador: rechaza', () => {
    expect(parseSanction(validForm({ player_id: '' })).ok).toBe(false);
  });

  it('scope team con player_id: rechaza (no se cuela el jugador)', () => {
    expect(parseSanction(validForm({ scope: 'team' })).ok).toBe(false);
  });

  it('fechas/días exigen amount 1..MAX_AMOUNT', () => {
    expect(parseSanction(validForm({ amount: '0' })).ok).toBe(false);
    expect(parseSanction(validForm({ amount: '-1' })).ok).toBe(false);
    expect(parseSanction(validForm({ amount: String(MAX_AMOUNT + 1) })).ok).toBe(false);
    expect(parseSanction(validForm({ amount: '' })).ok).toBe(false);
    expect(parseSanction(validForm({ amount: '2.5' })).ok).toBe(false);
    expect(parseSanction(validForm({ amount: '3', duration_kind: 'dias' })).ok).toBe(true);
  });

  it('hasta_fecha exige until_date válida y no anterior al incidente', () => {
    const sinFecha = validForm({ duration_kind: 'hasta_fecha', amount: '', until_date: '' });
    expect(parseSanction(sinFecha).ok).toBe(false);
    const antes = validForm({ duration_kind: 'hasta_fecha', amount: '', until_date: '2026-09-10' });
    expect(parseSanction(antes).ok).toBe(false);
    const bien = validForm({ duration_kind: 'hasta_fecha', amount: '', until_date: '2026-10-05' });
    expect(parseSanction(bien).ok).toBe(true);
    // mismo día del incidente: límite inclusive, es válido
    expect(parseSanction(validForm({ duration_kind: 'hasta_fecha', amount: '', until_date: '2026-09-20' })).ok).toBe(true);
  });

  it('incident_date inválido y category vacía rechazan', () => {
    expect(parseSanction(validForm({ incident_date: '31-09-2026' })).ok).toBe(false);
    expect(parseSanction(validForm({ category: '   ' })).ok).toBe(false);
  });

  it('tournament_id ausente rechaza', () => {
    expect(parseSanction(validForm({ tournament_id: '' })).ok).toBe(false);
  });
});

describe('parseAnnulment', () => {
  it('motivo obligatorio', () => {
    expect(parseAnnulment({ annul_reason: '   ' }).ok).toBe(false);
    expect(parseAnnulment({}).ok).toBe(false);
  });

  it('con motivo devuelve la razón recortada', () => {
    const r = parseAnnulment({ annul_reason: '  Falta de pruebas  ' });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('Falta de pruebas');
  });
});

describe('vigencia: sanctionEndDate / coversDate / coversRound / effectiveStatus', () => {
  const base = { incident_date: '2026-09-20', amount: null as number | null, until_date: null as string | null };

  it('hasta_fecha: cubre el día límite inclusive y después cumple sola', () => {
    const s = { ...base, status: 'activa' as const, duration_kind: 'hasta_fecha' as const, until_date: '2026-09-25' };
    expect(sanctionEndDate(s)).toBe('2026-09-25');
    expect(coversDate(s, '2026-09-25')).toBe(true);
    expect(coversDate(s, '2026-09-26')).toBe(false);
    expect(coversDate(s, '2026-09-19')).toBe(false);
    expect(effectiveStatus(s, '2026-09-25')).toBe('activa');
    expect(effectiveStatus(s, '2026-09-26')).toBe('cumplida');
  });

  it('dias: el fin es incidente + amount días', () => {
    const s = { ...base, status: 'activa' as const, duration_kind: 'dias' as const, amount: 5 };
    expect(sanctionEndDate(s)).toBe('2026-09-25');
    expect(coversDate(s, '2026-09-25')).toBe(true);
    expect(coversDate(s, '2026-09-26')).toBe(false);
  });

  it('fechas: no se decide por calendario, sí por round', () => {
    const s = { ...base, duration_kind: 'fechas' as const, amount: 3 };
    expect(sanctionEndDate(s)).toBeNull();
    expect(coversDate(s, '2026-09-21')).toBe(false); // calendario no aplica
    expect(coversRound(s, 4, 4)).toBe(true);
    expect(coversRound(s, 4, 6)).toBe(true); // fechas 4,5,6
    expect(coversRound(s, 4, 7)).toBe(false);
    expect(coversRound(s, 4, 3)).toBe(false);
    // anulada/cumplida no se recalculan para 'fechas'
    expect(effectiveStatus({ ...s, status: 'activa' as const }, '2027-01-01')).toBe('activa');
  });

  it('anulada manda sobre cualquier cálculo', () => {
    const s = { ...base, duration_kind: 'hasta_fecha' as const, until_date: '2026-09-25', status: 'anulada' as const };
    expect(effectiveStatus(s, '2026-09-21')).toBe('anulada');
    expect(effectiveStatus(s, '2027-01-01')).toBe('anulada');
  });

  it('cumplida declarada se respeta tal cual', () => {
    const s = { ...base, duration_kind: 'fechas' as const, amount: 2, status: 'cumplida' as const };
    expect(effectiveStatus(s, '2026-09-21')).toBe('cumplida');
  });
});

describe('CRUD D1', () => {
  const SQL_LIST = `SELECT s.*, tm.name AS team_name, p.name AS player_name
       FROM sanctions s
       LEFT JOIN teams tm ON tm.id = s.team_id
       LEFT JOIN players p ON p.id = s.player_id
       WHERE s.tournament_id = ?1
       ORDER BY CASE s.status WHEN 'activa' THEN 0 WHEN 'cumplida' THEN 1 ELSE 2 END,
                s.incident_date DESC, s.id DESC`;

  it('insertSanction persiste todos los campos y devuelve el id', async () => {
    const { db, runs } = dbStub();
    const parsed = parseSanction(validForm());
    const id = await insertSanction(db, parsed.value!);
    expect(id).toBe(0); // stub sin meta.last_row_id
    expect(runs[0]!.sql).toContain('INSERT INTO sanctions');
    expect(runs[0]!.params).toEqual([1, 10, 77, 'player', 'fechas', 2, null, '2026-09-20', 'Inconducta', 'Incidente con el árbitro', '', null]);
  });

  it('sanctionsForTournament trae nombres por LEFT JOIN', async () => {
    const { db } = dbStub({
      [SQL_LIST]: [{ id: 1, player_name: 'Juan Pérez', team_name: 'Los Andes', status: 'activa' }],
    });
    const rows = await sanctionsForTournament(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.player_name).toBe('Juan Pérez');
    expect(rows[0]!.team_name).toBe('Los Andes');
  });

  it('activeSanctionsForTournament solo activas; getSanction y annulSanction ok', async () => {
    const { db, runs } = dbStub({
      "SELECT * FROM sanctions WHERE tournament_id = ?1 AND status = 'activa' ORDER BY id": [{ id: 2, status: 'activa' }],
    });
    expect(await activeSanctionsForTournament(db, 1)).toHaveLength(1);
    const s = await getSanction(db, 9);
    expect(s).toBeNull();
    await annulSanction(db, 2, 'Falta de pruebas');
    expect(runs.at(-1)!.sql).toContain("status = 'anulada'");
    expect(runs.at(-1)!.params).toEqual([2, 'Falta de pruebas']);
  });
});

describe('Fase 7B: medidas de equipo (parseo y espejo de duración)', () => {
  const teamForm = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    tournament_id: '1',
    team_id: '10',
    scope: 'team',
    incident_date: '2026-09-20',
    category: 'Incidente con árbitro',
    description: 'Agresión al juez',
    notes: '',
    ...overrides,
  });

  it('perdida_puntos: exige amount y viaja como fechas espejadas con measure', () => {
    const bad = parseSanction(teamForm({ measure: 'perdida_puntos' }));
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('puntos a restar');

    const ok = parseSanction(teamForm({ measure: 'perdida_puntos', amount: '3' }));
    expect(ok.ok).toBe(true);
    expect(ok.value!.measure).toBe('perdida_puntos');
    expect(ok.value!.amount).toBe(3);
    expect(ok.value!.durationKind).toBe('fechas'); // espejo
  });

  it('suspension_fechas: exige cantidad; suspension_dias exige fecha fin', () => {
    const fechas = parseSanction(teamForm({ measure: 'suspension_fechas', amount: '2' }));
    expect(fechas.ok).toBe(true);
    expect(fechas.value!.measure).toBe('suspension_fechas');
    expect(fechas.value!.amount).toBe(2);

    const diasMal = parseSanction(teamForm({ measure: 'suspension_dias' }));
    expect(diasMal.ok).toBe(false);
    expect(diasMal.error).toContain('fecha de finalización');

    const diasOk = parseSanction(teamForm({ measure: 'suspension_dias', until_date: '2026-10-15' }));
    expect(diasOk.ok).toBe(true);
    expect(diasOk.value!.untilDate).toBe('2026-10-15');
    // El espejo de duration_kind lo aplica insertSanction al persistir.
    expect(diasOk.value!.durationKind).toBe('fechas'); // form default intacto
  });

  it('advertencia y expulsión no llevan campos extra', () => {
    for (const measure of ['advertencia', 'expulsion'] as const) {
      const r = parseSanction(teamForm({ measure }));
      expect(r.ok).toBe(true);
      expect(r.value!.amount).toBeNull();
      expect(r.value!.untilDate).toBeNull();
    }
  });

  it('medida en jugador se rechaza; medida desconocida también', () => {
    const conJugador = parseSanction(validForm({ measure: 'expulsion' }));
    expect(conJugador.ok).toBe(false);
    expect(conJugador.error).toContain('solo a equipos');

    const rara = parseSanction(teamForm({ measure: 'suspension_siglo' }));
    expect(rara.ok).toBe(false);
    expect(rara.error).toContain('Medida');
  });

  it('sin measure (sanción clásica de equipo o jugador) sigue funcionando', () => {
    const clasico = parseSanction(teamForm({}));
    expect(clasico.ok).toBe(false); // equipo sin measure ni duración: exige amount
    const playerClassic = parseSanction(validForm());
    expect(playerClassic.ok).toBe(true);
    expect(playerClassic.value!.measure).toBeNull();
  });

  it('insertSanction persiste measure con espejo de duración en equipos', async () => {
    const { db, runs } = dbStub();
    const expulsada = parseSanction(teamForm({ measure: 'expulsion' }));
    await insertSanction(db, expulsada.value!);
    expect(runs[0]!.sql).toContain('measure');
    expect(runs[0]!.params.at(-1)).toBe('expulsion');
    // advertencia/expulsión: sin amount ni until_date espejados.
    expect(runs[0]!.params[5]).toBeNull();
    expect(runs[0]!.params[6]).toBeNull();
  });

  it('etiquetas de medidas completas para la UI', () => {
    expect(SANCTION_MEASURE_LABELS.advertencia).toBe('Advertencia');
    expect(SANCTION_MEASURE_LABELS.perdida_puntos).toBe('Pérdida de puntos');
    expect(SANCTION_MEASURE_LABELS.expulsion).toBe('Expulsión del torneo');
  });
});
