// Fase 11C: generador de llaves de playoffs para los formatos con playoffs
// (ELIMINACION_DIRECTA, GRUPOS_PLAYOFFS, LIGA_FASE_FINAL y
// FASE_REGULAR_PLAYOFFS).
//
// Reutiliza el sistema de llaves existente: la columna bracket_round de la
// base (R16/QF/SF/F/3P), los orígenes home_source/away_source ("WSF1" =
// ganador de la semifinal 1, "LSF1" = perdedor) que la llave resuelve sola
// cuando los partidos se van jugando, y el render de Llaves / Playoffs que ya
// existe en admin y en el sitio público.
//
// Dominio puro: no toca la base. Las protecciones (no pisar llaves, no
// regenerar con resultados, estados finalizado/archivado) viven en la ruta y
// en la UI, igual que en el resto del fixture.

import type { BracketRound } from './types.ts';
import { PLAYOFF_START_SIZE, PLAYOFF_START_LABELS, type PlayoffStartRound } from './competition.ts';

/** Cadena de rondas de la llave, de la instancia inicial a la final. */
const CHAIN: readonly BracketRound[] = ['R16', 'QF', 'SF', 'F'];
const IDX: Record<Exclude<BracketRound, ''>, number> = { R16: 0, QF: 1, SF: 2, F: 3, '3P': 2 };

/** Un partido de la llave pendiente de crear. */
export interface BracketSlot {
  /** Fecha del fixture donde vive el partido (ida y revancha van en fechas distintas). */
  round: number;
  bracket_round: BracketRound;
  home: number | null;
  away: number | null;
  home_source: string;
  away_source: string;
  /** 1 = ida / partido único; 2 = revancha. */
  leg: 1 | 2;
  /** Número de llave dentro de su ronda (1..N), para los orígenes W/L. */
  tie: number;
}

export interface BuildBracketPlanInput {
  /** Instancia inicial de la llave (de la config de competencia). */
  start: PlayoffStartRound;
  /**
   * Equipos que arrancan la llave, mejor clasificado primero. El emparejamiento
   * inicial es espejo: 1.º vs último, 2.º vs penúltimo, etc.
   */
  entrants: number[];
  /** Fecha (round) donde vive la primera instancia. */
  startRound: number;
  /** true = partido único; false = ida y vuelta con localía invertida. */
  singleMatch: boolean;
  /** true = agrega el partido por el tercer puesto (necesita semifinales). */
  thirdPlace: boolean;
}

/**
 * Arma los partidos de la llave. Valida que la cantidad de entrantes sea
 * exactamente la de la instancia inicial (R16=16, QF=8, SF=4, F=2) y lanza
 * con un mensaje claro si no.
 */
export function buildBracketPlan(input: BuildBracketPlanInput): BracketSlot[] {
  const { start, entrants, startRound, singleMatch, thirdPlace } = input;
  const need = PLAYOFF_START_SIZE[start];
  if (entrants.length !== need) {
    throw new Error(
      `La instancia inicial (${PLAYOFF_START_LABELS[start]}) necesita ${need} equipo(s) y hay ${entrants.length}`
    );
  }
  if (new Set(entrants).size !== entrants.length) {
    throw new Error('Hay equipos repetidos en la llave');
  }
  if (thirdPlace && start === 'F') {
    throw new Error('El tercer puesto necesita al menos semifinales');
  }

  const legs: (1 | 2)[] = singleMatch ? [1] : [1, 2];
  const slots: BracketSlot[] = [];

  // Ronda inicial: equipos conocidos al generar, con espejo (1 vs N, 2 vs N-1).
  // La revancha invierte la localía (la revancha se juega en la cancha del otro).
  const first = CHAIN[IDX[start]]!;
  for (const leg of legs) {
    for (let k = 0; k < need / 2; k++) {
      const h = entrants[k]!;
      const a = entrants[need - 1 - k]!;
      const [home, away] = leg === 1 ? [h, a] : [a, h];
      slots.push({
        round: startRound + leg - 1,
        bracket_round: first,
        home,
        away,
        home_source: '',
        away_source: '',
        leg,
        tie: k + 1,
      });
    }
  }

  // Rondas siguientes: orígenes "W<ronda><llave>" (ganador de la llave previa).
  // Con ida y vuelta, la revancha invierte los orígenes (localía invertida).
  let round = startRound + legs.length;
  let teamsInRound = need / 2;
  for (let idx = IDX[start] + 1; idx < CHAIN.length; idx++) {
    const target = CHAIN[idx]!;
    const prev = CHAIN[idx - 1]!;
    const ties = teamsInRound / 2;
    for (const leg of legs) {
      for (let k = 0; k < ties; k++) {
        const w1 = `W${prev}${2 * k + 1}`;
        const w2 = `W${prev}${2 * k + 2}`;
        slots.push({
          round: round + leg - 1,
          bracket_round: target,
          home: null,
          away: null,
          home_source: leg === 1 ? w1 : w2,
          away_source: leg === 1 ? w2 : w1,
          leg,
          tie: k + 1,
        });
      }
    }
    round += legs.length;
    teamsInRound = ties;
  }

  // Tercer puesto: perdedores de las semis, el mismo día de la final.
  if (thirdPlace) {
    const finalRound = startRound + (IDX.F - IDX[start]) * legs.length;
    slots.push({
      round: finalRound,
      bracket_round: '3P',
      home: null,
      away: null,
      home_source: 'LSF1',
      away_source: 'LSF2',
      leg: 1,
      tie: 1,
    });
  }

  return slots;
}

/* ==== Entrantes según el formato ==== */

export interface GroupTable {
  name: string;
  /** Filas ordenadas por posición (1.º primero). */
  rows: { teamId: number }[];
}

/**
 * Clasificados de grupos con cruce cruzado: 1.ºA, 1.ºB, 2.ºA, 2.ºB… Con el
 * emparejamiento espejo del generador esto produce 1.ºA vs 2.ºB y 1.ºB vs
 * 2.ºA (el ejemplo clásico). Lanza si a un grupo le faltan clasificados.
 */
export function entrantsFromGroupTables(tables: GroupTable[], qualifiers: number): number[] {
  if (tables.length < 2) throw new Error('Se necesitan al menos 2 grupos para armar la llave');
  const out: number[] = [];
  for (let p = 0; p < qualifiers; p++) {
    for (const t of tables) {
      const row = t.rows[p];
      if (!row) {
        throw new Error(`El grupo ${t.name} no tiene ${p + 1}.º clasificado todavía`);
      }
      out.push(row.teamId);
    }
  }
  return out;
}

/** Primeros N de una tabla general (liga + fase final / fase regular + playoffs). */
export function entrantsFromTable(rows: { teamId: number }[], n: number): number[] {
  if (rows.length < n) {
    throw new Error(`La instancia inicial necesita ${n} equipo(s) y la tabla tiene ${rows.length}`);
  }
  return rows.slice(0, n).map((r) => r.teamId);
}

/* ==== Registro de la llave en la config del torneo ==== */

export interface BracketConfig {
  /** Formato de competencia con el que se generó. */
  format: string;
  /** Fecha de la primera instancia. */
  startRound: number;
  singleMatch: boolean;
  thirdPlace: boolean;
}

export function parseBracketConfig(configJson: string): BracketConfig | null {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const o = raw['bracket'];
  if (!o || typeof o !== 'object') return null;
  const b = o as Record<string, unknown>;
  if (typeof b['startRound'] !== 'number' || !Number.isFinite(b['startRound'])) return null;
  return {
    format: typeof b['format'] === 'string' ? b['format'] : '',
    startRound: b['startRound'],
    singleMatch: b['singleMatch'] === true,
    thirdPlace: b['thirdPlace'] === true,
  };
}

export function bracketConfigJson(b: BracketConfig | null): { bracket?: BracketConfig } {
  return b ? { bracket: b } : {};
}

/** true si ya existe algún partido de llave con resultado cargado. */
export function bracketHasPlayed(matches: { bracket_round: string; status: string }[]): boolean {
  return matches.some((m) => m.bracket_round !== '' && (m.status === 'played' || m.status === 'walkover'));
}
