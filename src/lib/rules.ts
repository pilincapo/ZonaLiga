// Reglas de un torneo: interpretación pura de su configuración.
// Vive fuera de queries porque no toca la base; es dominio.

import { parseRules } from './types.ts';
import type { Rules, Tournament } from './types.ts';

/** Reglas vigentes de un torneo (config con defaults). */
export function rulesOf(t: Tournament): Rules {
  return parseRules(t.config);
}
