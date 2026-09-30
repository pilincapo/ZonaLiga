// Tests Fase 10: configuración de competencia.
// Cubre parseo tolerante del config, mapeo de formatos legados, defaults por
// formato y todas las reglas de validación (en servidor).
import { describe, expect, it } from 'vitest';
import {
  ALL_FORMATS,
  DEFAULT_TIEBREAKERS,
  type CompetitionConfig,
  competitionConfigJson,
  defaultCompetitionConfig,
  formatHasGroups,
  formatHasPlayoffs,
  formatHasTable,
  isLegacyFormat,
  legacyToCompetitionFormat,
  parseCompetitionConfig,
} from '../src/lib/competition.ts';
import { dedupeTiebreakers, validateCompetitionConfig } from '../src/lib/competitionRules.ts';

describe('formatos: helpers por formato', () => {
  it('los formatos con grupos son solo los 4 declarados', () => {
    expect(ALL_FORMATS.filter(formatHasGroups)).toEqual([
      'FASE_DE_GRUPOS',
      'GRUPOS_PLAYOFFS',
      'LIGA_FASE_FINAL',
      'FASE_REGULAR_PLAYOFFS',
    ]);
  });

  it('los formatos con playoffs son solo los 4 declarados', () => {
    expect(ALL_FORMATS.filter(formatHasPlayoffs)).toEqual([
      'GRUPOS_PLAYOFFS',
      'ELIMINACION_DIRECTA',
      'LIGA_FASE_FINAL',
      'FASE_REGULAR_PLAYOFFS',
    ]);
  });

  it('solo la eliminación directa no tiene tabla', () => {
    expect(ALL_FORMATS.filter((f) => !formatHasTable(f))).toEqual(['ELIMINACION_DIRECTA']);
  });
});

describe('formatos legados', () => {
  it('mapea cada formato viejo a su equivalente nuevo', () => {
    expect(legacyToCompetitionFormat('round_robin')).toBe('TODOS_CONTRA_TODOS');
    expect(legacyToCompetitionFormat('zonas_playoffs')).toBe('GRUPOS_PLAYOFFS');
    expect(legacyToCompetitionFormat('copa')).toBe('ELIMINACION_DIRECTA');
  });

  it('reconoce los tres legados y nada más', () => {
    expect(isLegacyFormat('round_robin')).toBe(true);
    expect(isLegacyFormat('copa')).toBe(true);
    expect(isLegacyFormat('TODOS_CONTRA_TODOS')).toBe(false);
  });
});

describe('parseCompetitionConfig', () => {
  it('devuelve defaults para config vacío (formato nuevo)', () => {
    const got = parseCompetitionConfig('{}', 'DOS_RUEDAS');
    expect(got.format).toBe('DOS_RUEDAS');
    expect(got.points).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(got.tiebreakers).toEqual([...DEFAULT_TIEBREAKERS]);
    expect(got.localia).toBe('ALTERNADA');
    expect(got.playoffs.start).toBe('SF');
    expect(got.hasPlayoffs).toBe(false);
  });

  it('mapea un torneo legado por su formato de base', () => {
    const got = parseCompetitionConfig('{}', 'zonas_playoffs');
    expect(got.format).toBe('GRUPOS_PLAYOFFS');
    expect(got.hasPlayoffs).toBe(true);
    expect(got.groupStage.count).toBe(2);
  });

  it('config corrupto vuelve a defaults sin lanzar error', () => {
    const got = parseCompetitionConfig('{no soy json', 'UNA_RUEDA');
    expect(got.format).toBe('UNA_RUEDA');
    expect(got.points).toEqual({ win: 3, draw: 1, loss: 0 });
  });

  it('lee la clave competition con todos los campos', () => {
    const comp: CompetitionConfig = {
      ...defaultCompetitionConfig('GRUPOS_PLAYOFFS'),
      groupStage: { count: 4, qualifiersPerGroup: 3 },
      playoffs: { start: 'QF', singleMatch: true, thirdPlace: true, tiebreak: 'REPLAY' },
      points: { win: 2, draw: 1, loss: 0 },
      tiebreakers: ['GOLES_FAVOR', 'PUNTOS'],
      localia: 'SORTEADA',
    };
    const json = JSON.stringify({ competition: competitionConfigJson(comp) });
    const got = parseCompetitionConfig(json, 'GRUPOS_PLAYOFFS');
    expect(got.groupStage).toEqual({ count: 4, qualifiersPerGroup: 3 });
    expect(got.playoffs).toEqual({ start: 'QF', singleMatch: true, thirdPlace: true, tiebreak: 'REPLAY' });
    expect(got.points).toEqual({ win: 2, draw: 1, loss: 0 });
    // Respeta el orden declarado de desempates.
    expect(got.tiebreakers).toEqual(['GOLES_FAVOR', 'PUNTOS']);
    expect(got.localia).toBe('SORTEADA');
  });

  it('un formato sin playoffs ignora los playoffs guardados', () => {
    const json = JSON.stringify({
      competition: {
        format: 'UNA_RUEDA',
        playoffs: { start: 'F', singleMatch: true, thirdPlace: true, tiebreak: 'REPLAY' },
      },
    });
    const got = parseCompetitionConfig(json, 'UNA_RUEDA');
    expect(got.hasPlayoffs).toBe(false);
    expect(got.playoffs.thirdPlace).toBe(false);
  });

  it('valores fuera de rango vuelven a defaults', () => {
    const json = JSON.stringify({
      competition: {
        format: 'DOS_RUEDAS',
        points: { win: 999, draw: -5, loss: 0 },
        groupStage: { count: 50, qualifiersPerGroup: 0 },
        localia: 'MAGIA',
      },
    });
    const got = parseCompetitionConfig(json, 'DOS_RUEDAS');
    expect(got.points.win).toBe(3);
    expect(got.points.draw).toBe(1);
    expect(got.localia).toBe('ALTERNADA');
  });
});

describe('validateCompetitionConfig: puntos y desempates', () => {
  it('acepta la config por defecto de todos los formatos', () => {
    for (const f of ALL_FORMATS) {
      expect(validateCompetitionConfig({ comp: defaultCompetitionConfig(f), teamCount: 10 })).toEqual([]);
    }
  });

  it('rechaza victoria <= empate', () => {
    const comp = { ...defaultCompetitionConfig('TODOS_CONTRA_TODOS'), points: { win: 2, draw: 3, loss: 0 } };
    expect(validateCompetitionConfig({ comp })).toContain(
      'Los puntos por victoria tienen que ser mayores que los del empate.'
    );
  });

  it('rechaza empate < derrota', () => {
    const comp = { ...defaultCompetitionConfig('TODOS_CONTRA_TODOS'), points: { win: 3, draw: 0, loss: 1 } };
    expect(validateCompetitionConfig({ comp })).toContain(
      'Los puntos por empate no pueden ser menores que los de la derrota.'
    );
  });

  it('desempates repetidos o vacíos no pasan', () => {
    const comp = {
      ...defaultCompetitionConfig('TODOS_CONTRA_TODOS'),
      tiebreakers: ['PUNTOS', 'PUNTOS'] as CompetitionConfig['tiebreakers'],
    };
    expect(validateCompetitionConfig({ comp })).not.toEqual([]);
    const vacio = { ...defaultCompetitionConfig('TODOS_CONTRA_TODOS'), tiebreakers: [] };
    expect(validateCompetitionConfig({ comp: vacio })).not.toEqual([]);
  });

  it('la eliminación directa no valida puntos ni desempates', () => {
    const comp = {
      ...defaultCompetitionConfig('ELIMINACION_DIRECTA'),
      points: { win: 0, draw: 0, loss: 0 },
      tiebreakers: [],
    };
    expect(validateCompetitionConfig({ comp })).toEqual([]);
  });
});

describe('validateCompetitionConfig: grupos', () => {
  it('exige al menos 2 grupos', () => {
    const comp = {
      ...defaultCompetitionConfig('FASE_DE_GRUPOS'),
      groupStage: { count: 1, qualifiersPerGroup: 2 },
    };
    expect(validateCompetitionConfig({ comp })).toContain('Si el formato tiene grupos, tiene que haber al menos 2.');
  });

  it('exige al menos 1 clasificado por grupo', () => {
    const comp = {
      ...defaultCompetitionConfig('FASE_DE_GRUPOS'),
      groupStage: { count: 2, qualifiersPerGroup: 0 },
    };
    expect(validateCompetitionConfig({ comp })).toContain('Tiene que clasificar al menos 1 equipo por grupo.');
  });
});

describe('validateCompetitionConfig: playoffs', () => {
  it('rechaza cuadro más grande que los clasificados de los grupos', () => {
    const comp = {
      ...defaultCompetitionConfig('GRUPOS_PLAYOFFS'),
      groupStage: { count: 2, qualifiersPerGroup: 2 }, // 4 a la llave
      playoffs: { ...defaultCompetitionConfig('GRUPOS_PLAYOFFS').playoffs, start: 'QF' as const }, // QF pide 8
    };
    const errors = validateCompetitionConfig({ comp });
    expect(errors.some((e) => e.includes('menos de los 8'))).toBe(true);
  });

  it('acepta cuadro justo con los clasificados de los grupos', () => {
    const comp = {
      ...defaultCompetitionConfig('GRUPOS_PLAYOFFS'),
      groupStage: { count: 4, qualifiersPerGroup: 2 }, // 8 a la llave
      playoffs: { ...defaultCompetitionConfig('GRUPOS_PLAYOFFS').playoffs, start: 'QF' as const },
    };
    expect(validateCompetitionConfig({ comp })).toEqual([]);
  });

  it('sin grupos, usa los equipos inscriptos para la llave', () => {
    const comp = {
      ...defaultCompetitionConfig('ELIMINACION_DIRECTA'),
      playoffs: { ...defaultCompetitionConfig('ELIMINACION_DIRECTA').playoffs, start: 'SF' as const },
    };
    expect(validateCompetitionConfig({ comp, teamCount: 4 })).toEqual([]);
    expect(validateCompetitionConfig({ comp, teamCount: 3 }).length).toBeGreaterThan(0);
    // Sin teamCount (torneo nuevo) no puede rechazar por cantidad.
    expect(validateCompetitionConfig({ comp })).toEqual([]);
  });

  it('tercer puesto exige al menos semifinales', () => {
    const comp = {
      ...defaultCompetitionConfig('ELIMINACION_DIRECTA'),
      playoffs: { ...defaultCompetitionConfig('ELIMINACION_DIRECTA').playoffs, start: 'F' as const, thirdPlace: true },
    };
    expect(validateCompetitionConfig({ comp })).toContain(
      'El partido por el tercer puesto requiere al menos semifinales.'
    );
  });
});

describe('validateCompetitionConfig: mínimo de equipos', () => {
  it('rechaza menos de 2 inscriptos cuando se conoce la cantidad', () => {
    const comp = defaultCompetitionConfig('TODOS_CONTRA_TODOS');
    expect(validateCompetitionConfig({ comp, teamCount: 1 })).toContain(
      'El torneo necesita al menos 2 equipos inscriptos.'
    );
    expect(validateCompetitionConfig({ comp, teamCount: 2 })).toEqual([]);
  });
});

describe('dedupeTiebreakers', () => {
  it('saca duplicados y descarta valores desconocidos, conservando orden', () => {
    expect(dedupeTiebreakers(['PUNTOS', 'GOLES_FAVOR', 'PUNTOS'])).toEqual(['PUNTOS', 'GOLES_FAVOR']);
    expect(dedupeTiebreakers(['MAGIA' as never, 'PUNTOS'])).toEqual(['PUNTOS']);
  });
});
