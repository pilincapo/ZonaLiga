// Planificador de fixture completo: junta en una sola bolsa los partidos de
// zona (round-robin por zona) o del círculo global, más los de cruce entre
// zonas si la config los declara, y los distribuye en FECHAS del calendario
// con capacidad limitada (canchas × horarios por día).
//
// Reglas duras (todas verificadas al final del plan):
// 1. Cada fecha del fixture cae en un único día del calendario.
// 2. Un equipo nunca juega dos veces el mismo día.
// 3. Horarios no forzados: si un día no alcanzan los slots, el resto de la
//    bolsa sigue en el día siguiente (nada queda postergado ni sin día).
// 4. Los partidos de cruce van en la misma bolsa: pueden caer mezclados con
//    los de zona en cualquier día.
//
// Dominio puro: no toca la base. La vista previa guarda este plan en la
// tabla fixture_drafts y "Confirmar" lo aplica tal cual.

import type { StandingRow } from './types.ts';
import { buildCrossoverPairs, parseCrossoverConfig, type CrossoverDate, type CrossoverRule } from './crossover.ts';
import { generateRoundRobin, generateDoubleRoundRobin } from './fixture.ts';
import { plannedRoundDate, type TournamentSchedule } from './schedule.ts';
import { zonesOf } from './zones.ts';

/** Un partido del plan, ya con su fecha (día único) y slot asignados. */
export interface PlannedMatch {
  home: number;
  away: number;
  zone: string;
  /** 'zona' | 'cruce' | 'global' (círculo sin zonas). */
  kind: 'zona' | 'cruce' | 'global';
  /** Solo cruces: si suman puntos a la tabla (flag de la config). */
  counts?: boolean;
  /** Día calendario: único por fecha del fixture. */
  day: string;
  venue: string;
  kickoff: string;
  /** Fecha del fixture (1..N). */
  fixtureRound: number;
}

export interface PlannedFixture {
  matches: PlannedMatch[];
  /** Cantidad de fechas (días con partidos). */
  rounds: number;
  /** Máximo de partidos en un día. */
  maxPerDay: number;
  /**
   * Declaración del cruce usada por este plan (regla, fecha resuelta y si
   * suma): null si el plan no incluye cruces. El confirmar la escribe en la
   * config del torneo, para que quede registrada una fecha = un cruce.
   */
  crossover: CrossoverDate | null;
  /**
   * Fechas donde quedaron cruces que no entraron en la fecha anclada
   * (desborde por falta de slots o por equipos ya ocupados ese día).
   * Vacío = todos los cruces respetaron la fecha elegida.
   */
  crossoverOverflow: number[];
}

export interface PlanInput {
  teamIds: number[];
  configJson: string;
  mode: 'single' | 'double';
  schedule: TournamentSchedule;
  /**
   * Fase 11A: formato de competencia (Fase 10). Si viene y es uno de los
   * formatos de liga (TODOS_CONTRA_TODOS/UNA_RUEDA/DOS_RUEDAS), define las
   * ruedas y pisa `mode`. Formatos de grupos/playoffs aún no generan nada
   * distinto: caen al comportamiento por defecto hasta sus fases.
   */
  competitionFormat?: string;
  /**
   * Tabla por zona al momento de planear (opcional). Si viene, define el
   * orden de los cruces con la misma regla del generador manual; si no, el
   * orden de la zona hace de "tabla" (fixture nuevo = tabla vacía).
   */
  standings?: { zone: string; rows: StandingRow[] }[];
  /** rng inyectable para tests. */
  rng?: () => number;
  /** Regla de cruce elegida en el formulario (si la config declara cruces, la pisa). */
  crossoverRule?: CrossoverRule;
  /** Si los cruces suman puntos a la tabla (si viene, pisa el flag de la config). */
  crossoverCounts?: boolean;
  /** false = plan solo con partidos de zona, sin la bolsa de cruces. */
  includeCrossovers?: boolean;
  /**
   * Número de fecha donde vive el cruce. Vacío/undefined = automático: la
   * primera fecha libre después de las fechas de zona.
   */
  crossoverRound?: number;
}

/** Mezcla Fisher-Yates con rng inyectable. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // Intercambio real: la versión anterior leía out[i] y out[j] y se las
    // devolvía a sus mismos lugares (un no-op): nada se mezclaba nunca.
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Día calendario de la fecha i (1-based) del calendario. */
function dayFor(schedule: TournamentSchedule, i: number): string {
  return plannedRoundDate(schedule, i) || '';
}

/** Filas "de tabla" para armar los cruces. */
function rowsForZone(
  zone: { name: string; teamIds: number[] },
  standings: PlanInput['standings'],
  activeIds: Set<number>
): StandingRow[] {
  const provided = standings?.find((s) => s.zone === zone.name)?.rows;
  const ids = provided ? provided.map((r) => r.teamId) : zone.teamIds;
  return ids
    .filter((id) => activeIds.has(id))
    .map((id) => ({ teamId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, diff: 0, points: 0 }));
}

/**
 * Cruces según la config: pares entre las dos primeras zonas con la regla
 * declarada. Vacío si la config no declara cruces o no hay 2 zonas.
 */
export function crossoverPoolFor(input: {
  configJson: string;
  standings?: { zone: string; rows: StandingRow[] }[];
  teamIds: number[];
  mode: 'single' | 'double';
  /** Baraja el orden interno de cada zona antes de emparejar (fixture desde cero: la "tabla" es al azar). */
  shuffleZones?: boolean;
  rng?: () => number;
  /** Regla y flag de suma de puntos elegidos en el formulario (pisan la config). */
  rule?: CrossoverRule;
  counts?: boolean;
  /** Declaración única del formulario: si viene, reemplaza la config. */
  date?: CrossoverDate;
}): { home: number; away: number; counts: boolean }[] {
  void input.mode;
  const dates = input.date ? [input.date] : parseCrossoverConfig(input.configJson);
  if (dates.length === 0) return [];
  const zc = zonesOf(input.configJson);
  if (!zc.enabled || zc.zones.length < 2) return [];
  const zoneA = zc.zones[0]!;
  const zoneB = zc.zones[1]!;
  const activeIds = new Set(input.teamIds);
  const rng = input.rng ?? Math.random;
  const maybeShuffle = (rows: StandingRow[]): StandingRow[] =>
    input.shuffleZones === false ? rows : shuffle(rows, rng);
  // Fixture desde cero: nadie tiene puntos, así que la "posición" es el
  // orden de la zona barajado al azar (siempre que no venga una tabla real).
  // B se baraja desde el orden INVERSO: desacopla las dos barajas (con un
  // rng constante, la misma permutación en ambas preservaría los pares).
  const rowsA = maybeShuffle(rowsForZone(zoneA, input.standings, activeIds));
  const rowsB = maybeShuffle(rowsForZone(zoneB, input.standings, activeIds).slice().reverse());
  const pool: { home: number; away: number; counts: boolean }[] = [];
  for (const date of dates) {
    const rule: CrossoverRule = input.rule ?? date.rule;
    const counts = input.counts ?? date.counts;
    const { pairs } = buildCrossoverPairs(rowsA, rowsB, rule);
    for (const p of pairs) pool.push({ home: p.home, away: p.away, counts });
  }
  return pool;
}

/**
 * Arma el plan completo. Bolsa única (zona + cruces), mezclada, distribuida
 * día por día respetando capacidad y un partido por equipo por día.
 */
export function planFixture(input: PlanInput): PlannedFixture {
  const rng = input.rng ?? Math.random;

  // 1) Bolsa de partidos de zona (o círculo global si no hay zonas activas).
  const zc = zonesOf(input.configJson);
  const zoned = zc.enabled && zc.zones.length >= 2;
  const pool: PlannedMatch[] = [];

  if (zoned) {
    const active = new Set(input.teamIds);
    const calendars = zc.zones
      .map((z) => ({ zone: z.name, ids: z.teamIds.filter((id) => active.has(id)) }))
      .filter((z) => z.ids.length >= 2)
      .map((z) => ({ zone: z.zone, fixture: generateRoundRobin(z.ids) }));
    const maxRounds = calendars.reduce((mx, c) => Math.max(mx, c.fixture.rounds.length), 0);
    for (let i = 0; i < maxRounds; i++) {
      for (const cal of calendars) {
        for (const p of cal.fixture.rounds[i] ?? []) {
          pool.push({
            home: p.home,
            away: p.away,
            zone: cal.zone,
            kind: 'zona',
            day: '',
            venue: '',
            kickoff: '',
            fixtureRound: 0,
          });
        }
      }
    }
  } else {
    // Fase 11A: el formato de competencia manda sobre el mode del form.
    // UNA_RUEDA = 1 vuelta; DOS_RUEDAS y TODOS_CONTRA_TODOS = ida y vuelta.
    const singleWheel = input.competitionFormat === 'UNA_RUEDA';
    const double = singleWheel
      ? false
      : input.competitionFormat === 'DOS_RUEDAS' || input.competitionFormat === 'TODOS_CONTRA_TODOS'
        ? true
        : input.mode === 'double';
    const fixture = double ? generateDoubleRoundRobin(input.teamIds) : generateRoundRobin(input.teamIds);
    for (const pairs of fixture.rounds) {
      for (const p of pairs) {
        pool.push({ home: p.home, away: p.away, zone: '', kind: 'global', day: '', venue: '', kickoff: '', fixtureRound: 0 });
      }
    }
  }

  // 2) Cruces a la misma bolsa (caen mezclados en cualquier día), salvo que
  // el formulario pida un fixture sin cruces entre zonas. La declaración del
  // cruce (regla, fecha, si suma) viene del formulario: si el formulario no
  // declara una fecha de cruce explícita, se usa la config como antes.
  // Fechas que ocupa la fase de zona (o el círculo global): n equipos →
  // n-1 fechas, o n si hay impar (la del libre). La fecha automática del
  // cruce es la primera libre después de eso.
  const roundsList = zoned
    ? zc.zones.map((z) => {
        const n = z.teamIds.filter((id) => input.teamIds.includes(id)).length;
        return n >= 2 ? (n % 2 === 1 ? n : n - 1) : 0;
      })
    : [input.teamIds.length % 2 === 1 ? input.teamIds.length : input.teamIds.length - 1];
  const zoneRounds = Math.max(0, ...roundsList);
  const autoRound = zoneRounds + 1; // primera fecha libre tras las de zona
  const crossoverDate: CrossoverDate | null =
    input.includeCrossovers === false
      ? null
      : input.crossoverRule || input.crossoverCounts !== undefined || input.crossoverRound
        ? {
            // Fecha elegida (>= 1) o automática: la primera libre tras las
            // fechas de zona. Cuidado con el cortocircuito: Math.max(1, 0)
            // da 1 (truthy) y escondería la automática.
            round:
              input.crossoverRound != null && Number.isFinite(input.crossoverRound) && input.crossoverRound >= 1
                ? Math.round(input.crossoverRound)
                : autoRound,
            rule: input.crossoverRule ?? 'espejo',
            counts: input.crossoverCounts ?? false,
          }
        : null;
  const crossovers =
    input.includeCrossovers === false
      ? []
      : crossoverPoolFor({
          configJson: input.configJson,
          standings: input.standings,
          teamIds: input.teamIds,
          mode: input.mode,
          shuffleZones: input.standings ? false : true,
          rule: input.crossoverRule,
          counts: input.crossoverCounts,
          date: crossoverDate ?? undefined,
          rng,
        });
  for (const p of crossovers) {
    pool.push({ home: p.home, away: p.away, zone: '', kind: 'cruce', counts: p.counts, day: '', venue: '', kickoff: '', fixtureRound: 0 });
  }
  // Los cruces NO entran a la bolsa mezclada: van anclados a la fecha
  // declarada (elegida en el formulario, la declarada en la config o la
  // automática: la primera libre después de las fechas de zona). Esa fecha
  // reserva sus slots; los partidos de zona llenan el resto del calendario.
  const crossoverRound =
    crossoverDate?.round ?? parseCrossoverConfig(input.configJson)[0]?.round ?? autoRound;
  const crossoverMatches: PlannedMatch[] = [];
  const zonePool: PlannedMatch[] = [];
  for (const m of pool) {
    if (m.kind === 'cruce') crossoverMatches.push(m);
    else zonePool.push(m);
  }

  // 3) Mezcla: los de zona entre sí (el orden dentro de la fecha no importa).
  const bag = shuffle(zonePool, rng);

  // 4) Distribución en DOS FASES:
  //   a) Empaquetar por DÍA (un partido por equipo por día, capacidad por
  //      día), sin tocar canchas ni horarios.
  //   b) Por cada día, MEZCLAR sus partidos y repartir slots (cancha × hora)
  //      al azar. Así el cronograma no hereda el orden de generación: un
  //      partido de cualquier zona puede tocarle la hora temprana o la
  //      tardía, la cancha 1 o la última.
  const allSlots = slotCatalog(input.schedule);
  const capacity = Math.max(1, allSlots.length);

  const days: string[] = [];
  const perDay: PlannedMatch[][] = [];
  const teamsOfDay = new Map<number, Set<number>>();
  const usedSlots = new Map<number, Set<string>>();

  const openDay = (i: number): void => {
    if (days[i] !== undefined) return;
    days[i] = dayFor(input.schedule, i + 1);
    perDay[i] = [];
    teamsOfDay.set(i, new Set());
    usedSlots.set(i, new Set());
  };

  // 4a) Los cruces primero: fijan la fecha anclada (sin slots todavía).
  // Si la fecha elegida no alcanza (más cruces que slots, o equipos que ya
  // quedaron ocupados), los que no entran caen a la PRIMERA FECHA SIGUIENTE
  // con lugar: nada se pierde, y la vista previa muestra el aviso del
  // desborde para que el admin decida antes de confirmar.
  let overflowRounds: number[] = [];
  {
    let i = Math.max(0, crossoverRound - 1); // índice 0-based del día ancla
    for (const m of crossoverMatches) {
      for (;;) {
        openDay(i);
        const busy = teamsOfDay.get(i)!.has(m.home) || teamsOfDay.get(i)!.has(m.away);
        const full = perDay[i]!.length >= capacity;
        if (busy || full) {
          i += 1; // sin lugar en esta fecha: probar con la siguiente
          continue;
        }
        m.day = days[i]!;
        perDay[i]!.push(m);
        teamsOfDay.get(i)!.add(m.home);
        teamsOfDay.get(i)!.add(m.away);
        if (i + 1 > crossoverRound) overflowRounds.push(i + 1);
        break;
      }
    }
  }

  // 4b) Los de zona: empaquetan por día, sin tocar slots.
  for (const m of bag) {
    let i = 0;
    for (;;) {
      openDay(i);
      const busy = teamsOfDay.get(i)!.has(m.home) || teamsOfDay.get(i)!.has(m.away);
      const full = perDay[i]!.length >= capacity;
      if (busy || full) {
        i += 1;
        continue;
      }
      m.day = days[i]!;
      perDay[i]!.push(m);
      teamsOfDay.get(i)!.add(m.home);
      teamsOfDay.get(i)!.add(m.away);
      break;
    }
  }

  // 4c) Fase de slots: por cada día, mezclar sus partidos y repartir
  // cancha × hora al azar. Es la sugerencia del admin: "primero genera los
  // partidos por día, después mezclá cada día y asigná cancha y hora".
  days.forEach((day, i) => {
    const list = perDay[i] ?? [];
    if (!day || list.length === 0) return;
    const slots = shuffle(allSlots, rng);
    for (const [j, m] of list.entries()) {
      const slot = slots[j] ?? allSlots[j % allSlots.length]!;
      m.venue = slot.venue;
      m.kickoff = slot.kickoff;
    }
    usedSlots.set(i, new Set(slots.slice(0, list.length).map((s) => `${s.venue}|${s.kickoff}`)));
  });

  // 5) Renumerar fechas por posición en el calendario (no se compactan):
  // el cruce anclado conserva el número elegido aunque deje fechas vacías
  // en el medio. Los partidos de zona llenan desde la fecha 1 contigua.
  let lastUsed = 0;
  days.forEach((day, i) => {
    const list = perDay[i] ?? [];
    if (!day || list.length === 0) return;
    for (const m of list) m.fixtureRound = i + 1;
    lastUsed = Math.max(lastUsed, i + 1);
  });
  const dayKeys = days.filter((d, i): d is string => Boolean(d) && (perDay[i] ?? []).length > 0);

  const matches = [...crossoverMatches, ...bag].filter((m) => m.day);
  const crossoverOverflow = [...new Set(overflowRounds)].sort((a, b) => a - b);
  // 6) Verificación dura antes de devolver el plan.
  verifyPlan(matches, input.schedule);
  return {
    matches,
    rounds: lastUsed,
    maxPerDay: Math.max(0, ...dayKeys.map((k) => (matches.filter((m) => m.day === k)).length)),
    crossover: matches.some((m) => m.kind === 'cruce') ? crossoverDate : null,
    crossoverOverflow,
  };
}

/** Grilla de slots del torneo (canchas × horarios). */
export function slotCatalog(schedule: TournamentSchedule): { venue: string; kickoff: string }[] {
  const venues = schedule.venues.length ? schedule.venues : [''];
  const kickoffs = schedule.kickoffs.length ? schedule.kickoffs : [''];
  const catalog: { venue: string; kickoff: string }[] = [];
  for (const ko of kickoffs) for (const v of venues) catalog.push({ venue: v, kickoff: ko });
  return catalog;
}

/** Verificación dura: 1 día = 1 fecha, un partido por equipo por día, slots válidos. */
export function verifyPlan(matches: PlannedMatch[], schedule: TournamentSchedule): void {
  const allSlots = new Set(slotCatalog(schedule).map((s) => `${s.venue}|${s.kickoff}`));
  const capacity = Math.max(1, allSlots.size);
  const byDay = new Map<string, PlannedMatch[]>();
  for (const m of matches) {
    const arr = byDay.get(m.day) ?? [];
    arr.push(m);
    byDay.set(m.day, arr);
  }
  for (const [day, list] of byDay) {
    const seen = new Set<number>();
    for (const m of list) {
      for (const id of [m.home, m.away]) {
        if (seen.has(id)) throw new Error(`verificación: un equipo juega 2 veces el día ${day}`);
        seen.add(id);
      }
      const s = `${m.venue}|${m.kickoff}`;
      if (!allSlots.has(s)) throw new Error(`verificación: slot ${s} inexistente el día ${day}`);
    }
  }
}

/** Agrupa un plan por fecha del fixture para render. */
export function groupByFixtureRound(matches: PlannedMatch[]): Map<number, PlannedMatch[]> {
  const map = new Map<number, PlannedMatch[]>();
  for (const m of matches) {
    const arr = map.get(m.fixtureRound) ?? [];
    arr.push(m);
    map.set(m.fixtureRound, arr);
  }
  return map;
}

/** Resumen para la vista previa (cantidad, fechas, rango de libres, tope diario). */
export function planSummary(
  plan: PlannedFixture,
  teamIds: number[]
): { total: number; cruces: number; rounds: number; maxPerDay: number; libresMax: number; libresMin: number } {
  const daysOfTeam = new Map<number, Set<string>>();
  for (const m of plan.matches) {
    for (const id of [m.home, m.away]) {
      const set = daysOfTeam.get(id) ?? new Set<string>();
      set.add(m.day);
      daysOfTeam.set(id, set);
    }
  }
  const libres = teamIds.map((id) => plan.rounds - (daysOfTeam.get(id)?.size ?? 0));
  return {
    total: plan.matches.length,
    cruces: plan.matches.filter((m) => m.kind === 'cruce').length,
    rounds: plan.rounds,
    maxPerDay: plan.maxPerDay,
    libresMax: Math.max(0, ...libres),
    libresMin: libres.length ? Math.min(...libres) : 0,
  };
}
