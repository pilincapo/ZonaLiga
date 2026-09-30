// Fase 10B: validaciones de la configuración de competencia.
//
// Una sola función `validateCompetitionConfig` con reglas en español para la
// UI. La usan las rutas de alta/edición de torneo: si devuelve errores, el
// guardado no procede. La validación es de CONFIGURACIÓN: no mira partidos
// ni estados (los bloqueos por estado viven en las rutas).
//
// Nota: la compatibilidad playoffs ↔ clasificados se valida contra la
// cantidad declarada de grupos × clasificados + relevos. Como los grupos y
// la participación todavía no generan nada (eso llega en otras fases), el
// chequeo de "mínimo 2 equipos" se hace contra la participación real del
// torneo cuando existe, y el de playoffs contra el cuadro que declararía la
// propia configuración.

import {
  type CompetitionConfig,
  PLAYOFF_START_SIZE,
  type TiebreakCriterion,
  TIEBREAKER_KEYS,
  formatHasGroups,
  formatHasPlayoffs,
  formatHasTable,
} from './competition.ts';

export interface CompetitionValidationInput {
  /** Config normalizado a validar. */
  comp: CompetitionConfig;
  /**
   * Cantidad de equipos inscriptos en el torneo. undefined = todavía no se
   * puede saber (torneo nuevo sin participantes guardados): el chequeo de
   * equipos queda solo en el mínimo estructural del formato.
   */
  teamCount?: number;
}

/**
 * Valida la configuración. Devuelve la lista de errores en español (vacía
 * si todo está bien). Un mismo error se reporta una sola vez.
 */
export function validateCompetitionConfig(input: CompetitionValidationInput): string[] {
  const { comp } = input;
  const errors: string[] = [];
  const withGroups = formatHasGroups(comp.format);
  const withPlayoffs = formatHasPlayoffs(comp.format);
  const withTable = formatHasTable(comp.format);

  // --- Puntos (solo formatos con tabla) ---
  if (withTable) {
    const { win, draw, loss } = comp.points;
    if (![win, draw, loss].every((p) => Number.isInteger(p) && p >= 0 && p <= 100)) {
      errors.push('Los puntos por victoria, empate y derrota deben ser enteros entre 0 y 100.');
    } else if (win <= draw) {
      errors.push('Los puntos por victoria tienen que ser mayores que los del empate.');
    } else if (draw < loss) {
      errors.push('Los puntos por empate no pueden ser menores que los de la derrota.');
    }
  }

  // --- Desempates (solo formatos con tabla): orden válido, sin repetidos ---
  if (withTable) {
    const valid = comp.tiebreakers.length > 0;
    const allKnown = comp.tiebreakers.every((t) => (TIEBREAKER_KEYS as readonly string[]).includes(t));
    const noDupes = new Set(comp.tiebreakers).size === comp.tiebreakers.length;
    if (!valid || !allKnown || !noDupes) {
      errors.push('Los criterios de desempate tienen que ser válidos y no repetirse.');
    }
  }

  // --- Grupos ---
  if (withGroups) {
    const { count, qualifiersPerGroup } = comp.groupStage;
    if (!Number.isInteger(count) || count < 2) {
      errors.push('Si el formato tiene grupos, tiene que haber al menos 2.');
    } else if (count > 8) {
      errors.push('Como máximo 8 grupos.');
    }
    if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
      errors.push('Tiene que clasificar al menos 1 equipo por grupo.');
    } else if (qualifiersPerGroup > 16) {
      errors.push('Como máximo 16 clasificados por grupo.');
    } else if (count >= 2 && qualifiersPerGroup * count < 2) {
      errors.push('Los clasificados de los grupos tienen que sumar al menos 2 equipos.');
    }
  }

  // --- Playoffs ---
  if (withPlayoffs) {
    const { start, singleMatch, thirdPlace, tiebreak } = comp.playoffs;
    const startSize = PLAYOFF_START_SIZE[start];
    if (!startSize) {
      errors.push('La instancia inicial de playoffs no es válida.');
    } else {
      // Con grupos: grupos × clasificados. Sin grupos (eliminación directa
      // o fase regular): la cantidad de inscriptos; si todavía no se puede
      // saber (torneo nuevo sin participantes guardados), no se rechaza por
      // cantidad — cuando la haya, el chequeo de inscriptos lo cubre.
      const entrants = withGroups
        ? comp.groupStage.count * comp.groupStage.qualifiersPerGroup
        : input.teamCount;
      if (entrants != null && entrants < startSize) {
        const minFmt = withGroups
          ? `Con ${comp.groupStage.count} grupo(s) y ${comp.groupStage.qualifiersPerGroup} clasificado(s) por grupo llegan ${entrants} a la llave`
          : `Con los equipos inscriptos llegan ${entrants} a la llave`;
        errors.push(
          `${minFmt}, menos de los ${startSize} que necesita empezar en ${start}. Bajá la instancia (ej.: cuartos) o aumentá los clasificados.`
        );
      }
      // En ida y vuelta, la final también se juega a dos partidos: el cuadro
      // necesita pares desde el inicio. Con partido único no aplica.
      if (!singleMatch && entrants != null && entrants > startSize && entrants % 2 !== 0) {
        errors.push('Con ida y vuelta, la cantidad de equipos en la llave debe ser par.');
      }
    }
    if (!['PENALES', 'DEFINICION_POR_GOLATES', 'EMPATE_SE_OBRA', 'REPLAY'].includes(tiebreak)) {
      errors.push('La resolución de empate en playoffs no es válida.');
    }
    if (thirdPlace && start === 'F') {
      errors.push('El partido por el tercer puesto requiere al menos semifinales.');
    }
    void singleMatch;
  }

  // --- Mínimo 2 equipos (cuando hay inscriptos declarados) ---
  // Un torneo recién creado (0 inscriptos todavía) no queda bloqueado: se
  // le cargan los equipos después. Con 1 solo inscripto sí es incompatible
  // con cualquier formato.
  if (input.teamCount != null && input.teamCount > 0 && input.teamCount < 2) {
    errors.push('El torneo necesita al menos 2 equipos inscriptos.');
  }

  return errors;
}

/** Quita duplicados de la lista de desempates conservando el orden. */
export function dedupeTiebreakers(list: TiebreakCriterion[]): TiebreakCriterion[] {
  return [...new Set(list)].filter((t) => (TIEBREAKER_KEYS as readonly string[]).includes(t));
}
