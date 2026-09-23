// Programación del torneo: canchas y horarios disponibles para el fixture.
// Se guarda en el mismo JSON de configuración del torneo (columna config),
// junto a las reglas de puntuación. Dominio puro: no toca la base.

export interface TournamentSchedule {
  /** Nombres de canchas, en el orden en que se usan. Vacío = sin cancha. */
  venues: string[];
  /** Horarios de inicio (HH:MM 24h), en orden. Vacío = sin horario. */
  kickoffs: string[];
}

export const EMPTY_SCHEDULE: TournamentSchedule = { venues: [], kickoffs: [] };

const MAX_ITEMS = 12;
const MAX_VENUE_LEN = 60;

/** Normaliza el nombre de cancha: recorta espacios y largo. */
function normalizeVenue(v: string): string {
  return v.trim().replace(/\s+/g, ' ').slice(0, MAX_VENUE_LEN);
}

/**
 * Normaliza un horario: acepta "9", "9:30", "09:05" y devuelve "HH:MM".
 * Devuelve null si es inválido (hora 0-23, minutos 0-59).
 */
export function normalizeKickoff(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Lista desde textarea: separada por líneas o comas, sin vacíos ni repetidos. */
function parseList(raw: string, normalize: (v: string) => string | null): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const v = normalize(part);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_ITEMS);
}

/** Lee canchas y horarios desde los campos del formulario del torneo. */
export function scheduleFromForm(form: Record<string, unknown>): TournamentSchedule {
  return {
    venues: parseList(String(form['venues'] ?? ''), normalizeVenue),
    kickoffs: parseList(String(form['kickoffs'] ?? ''), normalizeKickoff),
  };
}

/** Schedule guardado en el config del torneo; tolera configs viejos o corruptos. */
export function scheduleOf(configJson: string): TournamentSchedule {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return EMPTY_SCHEDULE;
  }
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS) : [];
  return {
    venues: list(raw['venues']),
    kickoffs: list(raw['kickoffs']),
  };
}

/**
 * Slots de una jornada con `count` partidos: primera hora en todas las
 * canchas, después la siguiente hora, y así. Con count 0, sin canchas o sin
 * horarios no hay nada que asignar.
 */
export function roundSlots(
  count: number,
  s: TournamentSchedule
): { venue: string; kickoff: string }[] {
  if (count <= 0 || (s.venues.length === 0 && s.kickoffs.length === 0)) return [];
  const venues = s.venues.length ? s.venues : [''];
  const kickoffs = s.kickoffs.length ? s.kickoffs : [''];
  const slots: { venue: string; kickoff: string }[] = [];
  for (const kickoff of kickoffs) {
    for (const venue of venues) slots.push({ venue, kickoff });
  }
  return Array.from({ length: count }, (_, i) => slots[i % slots.length]!);
}

/** true si los slots alcanzan para todos los partidos de una jornada. */
export function scheduleCovers(s: TournamentSchedule, matchesPerRound: number): boolean {
  if (matchesPerRound <= 0) return true;
  return s.venues.length * Math.max(1, s.kickoffs.length) >= matchesPerRound;
}
