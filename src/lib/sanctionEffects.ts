// Fase 7B: efectos REALES de las sanciones disciplinarias a equipos.
//
// Puente entre la capa de disciplina (discipline.ts) y las tablas de
// posiciones: toma las entradas activas de equipos, calcula los efectos
// (puntos a restar, expulsados) y devuelve los ajustes listos para
// computeStandings. Puro y testeable sin base de datos.

import { teamEffects, type DisciplineEntry, type TeamEffects } from './discipline.ts';
import type { PointAdjustment } from './standings.ts';

/** Efectos de equipo sobre UN torneo, listos para aplicar en vistas. */
export interface SanctionEffectsResult {
  /** Ajustes de puntos derivados de sanciones (delta NEGATIVO). */
  adjustments: PointAdjustment[];
  /** Ids de equipos expulsados (inhabilitados) en el torneo. */
  expelled: number[];
  /** Efectos completos, para avisos (suspensiones y advertencias). */
  effects: TeamEffects;
}

/**
 * Calcula los efectos de las medidas de equipo a partir de la disciplina
 * combinada del torneo. Cada sanción de pérdida de puntos se convierte en
 * un ajuste negativo individual (con su categoría como motivo), así el
 * detalle queda explicable uno por uno en la tabla y en el sitio.
 */
export function sanctionEffectsOf(entries: readonly DisciplineEntry[]): SanctionEffectsResult {
  const effects = teamEffects(entries);
  const adjustments: PointAdjustment[] = [];
  for (const e of entries) {
    if (e.scope !== 'team' || e.teamId == null || e.measure !== 'perdida_puntos') continue;
    if (e.status !== 'activa') continue;
    const amount = e.duration.amount ?? 0;
    if (amount <= 0) continue; // sin puntos que restar: no genera ajuste
    adjustments.push({ teamId: e.teamId, delta: -amount, reason: `${e.reason} (sanción disciplinaria)` });
  }
  return {
    adjustments,
    expelled: [...effects.expelled],
    effects,
  };
}
