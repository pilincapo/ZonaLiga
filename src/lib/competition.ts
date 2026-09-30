// Fase 10: configuración de competencia de un torneo.
//
// Vive dentro del config JSON del torneo (clave 'competition'), igual que las
// reglas, zonas y canchas. Este módulo es el dueño del modelo: tipos, valores
// por defecto, parseo tolerante de configs viejos/parciales y mapeo de los
// formatos viejos (round_robin, zonas_playoffs, copa) a su equivalente nuevo.
//
// En esta fase solo se define y edita la configuración: la generación de
// fixture, grupos, llaves y el motor de playoffs llegan en fases posteriores.

export type CompetitionFormat =
  | 'TODOS_CONTRA_TODOS'
  | 'UNA_RUEDA'
  | 'DOS_RUEDAS'
  | 'FASE_DE_GRUPOS'
  | 'GRUPOS_PLAYOFFS'
  | 'ELIMINACION_DIRECTA'
  | 'LIGA_FASE_FINAL'
  | 'FASE_REGULAR_PLAYOFFS';

/** Formatos legados de la base (pre-Fase 10); la UI muestra su equivalente. */
export type LegacyFormat = 'round_robin' | 'zonas_playoffs' | 'copa';

export type LocaliaMode = 'ALTERNADA' | 'SORTEADA' | 'SIN_LOCALIA_FIJA';

/** Instancia inicial de playoffs (mínima que puede tener un cuadro). */
export type PlayoffStartRound = 'R16' | 'QF' | 'SF' | 'F';

export type TiebreakMode = 'PENALES' | 'DEFINICION_POR_GOLATES' | 'EMPATE_SE_OBRA' | 'REPLAY';

export type TiebreakCriterion =
  | 'PUNTOS'
  | 'DIFERENCIA_GOLES'
  | 'GOLES_FAVOR'
  | 'GOLES_CONTRA'
  | 'FAIR_PLAY'
  | 'HEAD_TO_HEAD';

/**
 * Configuración de competencia. Las claves son opcionales salvo `format`:
 * el parseo completa los defaults según el formato (un formato sin playoffs
 * ignora esos campos aunque vengan del form).
 */
export interface CompetitionConfig {
  format: CompetitionFormat;
  /** Playoffs incluidos en el formato (fase de liga antes de la llave). */
  hasPlayoffs: boolean;
  /** Fase de grupos/liga previa a los playoffs (si aplica). */
  groupStage: {
    /** Cantidad de grupos (0 = sin grupos). */
    count: number;
    /** Clasificados por grupo a la fase siguiente. */
    qualifiersPerGroup: number;
  };
  playoffs: {
    /** Instancia inicial de la llave. */
    start: PlayoffStartRound;
    /** true = partido único; false = ida y vuelta. */
    singleMatch: boolean;
    /** Partido por el tercer puesto. */
    thirdPlace: boolean;
    /** Cómo se resuelve el empate en playoffs. */
    tiebreak: TiebreakMode;
  };
  /** Puntos por victoria/empate/derrota (solo formatos de liga). */
  points: {
    win: number;
    draw: number;
    loss: number;
  };
  /** Criterios de desempate de tabla, en orden de prioridad. */
  tiebreakers: TiebreakCriterion[];
  /** Localía: alternada, sorteada o sin fija (cancha neutral). */
  localia: LocaliaMode;
}

export const PLAYOFF_START_ROUNDS: readonly PlayoffStartRound[] = ['R16', 'QF', 'SF', 'F'];

/** Tamaño mínimo de cuadro por instancia inicial (equipos que arrancan). */
export const PLAYOFF_START_SIZE: Record<PlayoffStartRound, number> = {
  R16: 16,
  QF: 8,
  SF: 4,
  F: 2,
};

export const PLAYOFF_START_LABELS: Record<PlayoffStartRound, string> = {
  R16: 'Octavos de final',
  QF: 'Cuartos de final',
  SF: 'Semifinales',
  F: 'Final',
};

export const TIEBREAK_MODE_LABELS: Record<TiebreakMode, string> = {
  PENALES: 'Penales',
  DEFINICION_POR_GOLATES: 'Definición por penales tras gol de visitante',
  EMPATE_SE_OBRA: 'Empate se obra (siguen ambos)',
  REPLAY: 'Partido desempate',
};

export const LOCALIA_LABELS: Record<LocaliaMode, string> = {
  ALTERNADA: 'Alternada',
  SORTEADA: 'Sorteada',
  SIN_LOCALIA_FIJA: 'Sin localía fija (cancha neutral)',
};

export const TIEBREAKER_LABELS: Record<TiebreakCriterion, string> = {
  PUNTOS: 'Puntos',
  DIFERENCIA_GOLES: 'Diferencia de goles',
  GOLES_FAVOR: 'Goles a favor',
  GOLES_CONTRA: 'Goles en contra',
  FAIR_PLAY: 'Fair play',
  HEAD_TO_HEAD: 'Entre enfrentados',
};

export const DEFAULT_TIEBREAKERS: readonly TiebreakCriterion[] = [
  'PUNTOS',
  'DIFERENCIA_GOLES',
  'GOLES_FAVOR',
];

export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 } as const;

/** Formatos que tienen fase de grupos/liga con tabla. */
export function formatHasGroups(format: CompetitionFormat): boolean {
  return (
    format === 'FASE_DE_GRUPOS' ||
    format === 'GRUPOS_PLAYOFFS' ||
    format === 'LIGA_FASE_FINAL' ||
    format === 'FASE_REGULAR_PLAYOFFS'
  );
}

/** Formatos que terminan en llave de eliminación directa. */
export function formatHasPlayoffs(format: CompetitionFormat): boolean {
  return (
    format === 'GRUPOS_PLAYOFFS' ||
    format === 'ELIMINACION_DIRECTA' ||
    format === 'LIGA_FASE_FINAL' ||
    format === 'FASE_REGULAR_PLAYOFFS'
  );
}

/** Formatos que usan tabla de puntos (liga, con o sin playoffs después). */
export function formatHasTable(format: CompetitionFormat): boolean {
  return format !== 'ELIMINACION_DIRECTA';
}

/** Mapea un formato legado a su equivalente nuevo (para mostrar y editar). */
export function legacyToCompetitionFormat(format: string): CompetitionFormat {
  if (format === 'zonas_playoffs') return 'GRUPOS_PLAYOFFS';
  if (format === 'copa') return 'ELIMINACION_DIRECTA';
  return 'TODOS_CONTRA_TODOS';
}

/** true si el formato es uno de los legados de la base. */
export function isLegacyFormat(format: string): format is LegacyFormat {
  return format === 'round_robin' || format === 'zonas_playoffs' || format === 'copa';
}

/** Config default para un formato dado. */
export function defaultCompetitionConfig(format: CompetitionFormat): CompetitionConfig {
  return {
    format,
    hasPlayoffs: formatHasPlayoffs(format),
    groupStage: {
      count: formatHasGroups(format) ? 2 : 0,
      qualifiersPerGroup: 2,
    },
    playoffs: {
      start: 'SF',
      singleMatch: false,
      thirdPlace: false,
      tiebreak: 'PENALES',
    },
    points: { ...DEFAULT_POINTS },
    tiebreakers: [...DEFAULT_TIEBREAKERS],
    localia: 'ALTERNADA',
  };
}

/**
 * Parsea la clave 'competition' del config JSON del torneo; tolera configs
 * viejos, parciales o corruptos (vuelve a defaults del formato). Ignora
 * campos que no corresponden al formato (ej.: playoffs en una liga simple).
 */
export function parseCompetitionConfig(configJson: string, format: string): CompetitionConfig {
  const comp: CompetitionFormat = isLegacyFormat(format)
    ? legacyToCompetitionFormat(format)
    : (ALL_FORMATS as readonly string[]).includes(format)
      ? (format as CompetitionFormat)
      : 'TODOS_CONTRA_TODOS';
  const base = defaultCompetitionConfig(comp);

  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') {
      raw = (parsed as Record<string, unknown>)['competition'] as Record<string, unknown> ?? {};
    }
  } catch {
    raw = {};
  }
  if (typeof raw !== 'object' || raw === null) raw = {};

  const int = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const groups = formatHasGroups(comp)
    ? {
        count: int((raw['groupStage'] as Record<string, unknown> | undefined)?.['count'], base.groupStage.count, 0, 8),
        qualifiersPerGroup: int(
          (raw['groupStage'] as Record<string, unknown> | undefined)?.['qualifiersPerGroup'],
          base.groupStage.qualifiersPerGroup,
          1,
          16
        ),
      }
    : { count: 0, qualifiersPerGroup: 0 };

  const playoffs = formatHasPlayoffs(comp)
    ? {
        start: PLAYOFF_START_ROUNDS.includes((raw['playoffs'] as Record<string, unknown> | undefined)?.['start'] as PlayoffStartRound)
          ? ((raw['playoffs'] as Record<string, unknown>)!['start'] as PlayoffStartRound)
          : base.playoffs.start,
        singleMatch: (raw['playoffs'] as Record<string, unknown> | undefined)?.['singleMatch'] === true,
        thirdPlace: (raw['playoffs'] as Record<string, unknown> | undefined)?.['thirdPlace'] === true,
        tiebreak: PLAYOFF_TIEBREAKS.includes((raw['playoffs'] as Record<string, unknown> | undefined)?.['tiebreak'] as TiebreakMode)
          ? ((raw['playoffs'] as Record<string, unknown>)!['tiebreak'] as TiebreakMode)
          : base.playoffs.tiebreak,
      }
    : base.playoffs;

  const rawPoints = (raw['points'] as Record<string, unknown> | undefined) ?? {};
  const points = formatHasTable(comp)
    ? {
        win: int(rawPoints['win'], DEFAULT_POINTS.win, 0, 100),
        draw: int(rawPoints['draw'], DEFAULT_POINTS.draw, 0, 100),
        loss: int(rawPoints['loss'], DEFAULT_POINTS.loss, 0, 100),
      }
    : { ...DEFAULT_POINTS };

  const rawTiebreakers = raw['tiebreakers'];
  const tiebreakers = Array.isArray(rawTiebreakers)
    ? (rawTiebreakers as unknown[]).filter((t): t is TiebreakCriterion =>
        (TIEBREAKER_KEYS as readonly string[]).includes(t as string)
      )
    : [];
  const finalTiebreakers =
    formatHasTable(comp) && tiebreakers.length > 0
      ? [...new Set(tiebreakers)].slice(0, TIEBREAKER_KEYS.length)
      : [...DEFAULT_TIEBREAKERS];

  const localia = LOCALIA_MODES.includes(raw['localia'] as LocaliaMode)
    ? (raw['localia'] as LocaliaMode)
    : base.localia;

  return {
    format: comp,
    hasPlayoffs: formatHasPlayoffs(comp),
    groupStage: groups,
    playoffs,
    points,
    tiebreakers: finalTiebreakers,
    localia,
  };
}

/** Serializa la config para guardar dentro del config JSON del torneo. */
export function competitionConfigJson(comp: CompetitionConfig): Record<string, unknown> {
  return {
    format: comp.format,
    hasPlayoffs: comp.hasPlayoffs,
    groupStage: comp.groupStage,
    playoffs: comp.playoffs,
    points: comp.points,
    tiebreakers: comp.tiebreakers,
    localia: comp.localia,
  };
}

// ---- Listas de valores válidos (una sola fuente, reusada por parseo y UI) ----

export const ALL_FORMATS: readonly CompetitionFormat[] = [
  'TODOS_CONTRA_TODOS',
  'UNA_RUEDA',
  'DOS_RUEDAS',
  'FASE_DE_GRUPOS',
  'GRUPOS_PLAYOFFS',
  'ELIMINACION_DIRECTA',
  'LIGA_FASE_FINAL',
  'FASE_REGULAR_PLAYOFFS',
];

export const FORMAT_LABELS: Record<CompetitionFormat, string> = {
  TODOS_CONTRA_TODOS: 'Todos contra todos (ida y vuelta)',
  UNA_RUEDA: 'Todos contra todos (solo ida)',
  DOS_RUEDAS: 'Todos contra todos (dos ruedas)',
  FASE_DE_GRUPOS: 'Fase de grupos (sin playoffs)',
  GRUPOS_PLAYOFFS: 'Grupos + playoffs',
  ELIMINACION_DIRECTA: 'Eliminación directa',
  LIGA_FASE_FINAL: 'Liga + fase final',
  FASE_REGULAR_PLAYOFFS: 'Fase regular + playoffs',
};

export const LOCALIA_MODES: readonly LocaliaMode[] = ['ALTERNADA', 'SORTEADA', 'SIN_LOCALIA_FIJA'];

export const PLAYOFF_TIEBREAKS: readonly TiebreakMode[] = [
  'PENALES',
  'DEFINICION_POR_GOLATES',
  'EMPATE_SE_OBRA',
  'REPLAY',
];

export const TIEBREAKER_KEYS: readonly TiebreakCriterion[] = [
  'PUNTOS',
  'DIFERENCIA_GOLES',
  'GOLES_FAVOR',
  'GOLES_CONTRA',
  'FAIR_PLAY',
  'HEAD_TO_HEAD',
];
