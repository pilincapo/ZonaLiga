// Zonas manuales del torneo: definición, parseo del form y validación.
// Se guardan en el JSON de configuración (columna config) junto a reglas y
// calendario. Dominio puro: no toca la base.

/** Campos de equipo que la validación necesita (acepta Team completo). */
export interface TeamLike {
  id: number;
  name: string;
  active: number | boolean;
}

export interface ZoneDef {
  /** Nombre corto de la zona: A, B, Norte, Sur… */
  name: string;
  /** IDs de equipos que la integran. */
  teamIds: number[];
}

export interface ZoneConfig {
  enabled: boolean;
  zones: ZoneDef[];
}

export const EMPTY_ZONES: ZoneConfig = { enabled: false, zones: [] };

const MAX_ZONES = 8;
const MAX_TEAM_IDS = 64;

/** Nombres de zona desde textarea (uno por línea, sin repetidos, hasta 8). */
export function parseZoneNames(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const z = line.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (z && !out.some((x) => x.toLowerCase() === z.toLowerCase())) out.push(z);
  }
  return out.slice(0, MAX_ZONES);
}

/**
 * Asignaciones "equipo → zona" desde los selects del form (zone_of_<teamId>,
 * valores '1'..'8' = posición del nombre en zone_names). Devuelve solo los
 * pares con equipo válido y zona existente.
 */
export function parseAssignments(form: Record<string, unknown>): Map<number, string> {
  const names = parseZoneNames(String(form['zone_names'] ?? ''));
  const idxToName = new Map<string, string>();
  names.forEach((name, i) => idxToName.set(String(i + 1), name));

  const out = new Map<number, string>();
  for (const [key, value] of Object.entries(form)) {
    const m = /^zone_of_(\d+)$/.exec(key);
    if (!m) continue;
    const teamId = Number(m[1]);
    const name = idxToName.get(String(value ?? '').trim());
    if (Number.isInteger(teamId) && teamId > 0 && name) out.set(teamId, name);
  }
  return out;
}

/** zones.enabled desde el checkbox del form. */
function parseEnabled(form: Record<string, unknown>): boolean {
  const v = form['zones_enabled'];
  return v === 'on' || v === '1' || v === 'true';
}

/** Lee la config de zonas desde los campos del formulario del torneo. */
export function zonesFromForm(form: Record<string, unknown>): ZoneConfig {
  const enabled = parseEnabled(form);
  if (!enabled) return { ...EMPTY_ZONES };
  const names = parseZoneNames(String(form['zone_names'] ?? ''));
  if (names.length < 2) return { ...EMPTY_ZONES };
  const assign = parseAssignments(form);
  const zones: ZoneDef[] = names.map((name) => ({ name, teamIds: [] }));
  const index = new Map(names.map((name, i) => [name.toLowerCase(), i]));
  for (const [teamId, zoneName] of assign) {
    const i = index.get(zoneName.toLowerCase());
    if (i != null && zones[i]!.teamIds.length < MAX_TEAM_IDS) zones[i]!.teamIds.push(teamId);
  }
  return { enabled: true, zones };
}

/** Zones guardadas en el config JSON del torneo; tolera configs viejos. */
export function zonesOf(configJson: string): ZoneConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(configJson || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    return { ...EMPTY_ZONES };
  }
  if (!raw['zones'] || typeof raw['zones'] !== 'object') return { ...EMPTY_ZONES };
  const obj = raw['zones'] as Record<string, unknown>;
  const arr = Array.isArray(obj['zones']) ? obj['zones'] : [];
  const zones: ZoneDef[] = [];
  for (const item of arr.slice(0, MAX_ZONES)) {
    if (!item || typeof item !== 'object') continue;
    const z = item as Record<string, unknown>;
    const name = typeof z['name'] === 'string' ? z['name'].trim().slice(0, 40) : '';
    const teamIds = Array.isArray(z['teamIds'])
      ? (z['teamIds'] as unknown[]).filter((id): id is number => Number.isInteger(id)).slice(0, MAX_TEAM_IDS)
      : [];
    if (name && teamIds.length > 0) zones.push({ name, teamIds });
  }
  return { enabled: obj['enabled'] === true && zones.length >= 2, zones };
}

export interface ZonesIssue {
  kind: 'warning' | 'error';
  text: string;
}

/**
 * Valida la config de zonas contra los equipos activos del torneo.
 * Errores: equipo sin zona o repetido. Avisos: desbalance grande o zona de
 * un solo equipo (no bloquean la generación).
 */
export function validateZones(zones: ZoneConfig, activeTeams: ReadonlyArray<TeamLike>): ZonesIssue[] {
  if (!zones.enabled) return [];
  const issues: ZonesIssue[] = [];
  const assigned = new Map<number, string>();
  for (const z of zones.zones) {
    for (const id of z.teamIds) {
      if (assigned.has(id)) {
        issues.push({
          kind: 'error',
          text: `Un equipo está en dos zonas (${assigned.get(id)} y ${z.name}). Cada equipo va en una sola.`,
        });
      }
      assigned.set(id, z.name);
    }
  }
  const active = activeTeams.filter((t) => t.active);
  const missing = active.filter((t) => !assigned.has(t.id));
  if (missing.length > 0) {
    issues.push({
      kind: 'error',
      text: `Sin zona: ${missing.map((t) => t.name).join(', ')}. Asignale zona a todos los equipos activos.`,
    });
  }
  const counts = zones.zones.map((z) => z.teamIds.filter((id) => active.some((t) => t.id === id)).length);
  const realZones = counts.filter((n) => n > 0).length;
  const max = Math.max(0, ...counts);
  const min = counts.length ? Math.min(...counts.filter((n) => n > 0)) : 0;
  if (realZones >= 2 && max - min > 1) {
    issues.push({
      kind: 'warning',
      text: `Zonas desbalanceadas: la más grande tiene ${max} equipos y la más chica ${min}. El fixture va a tener fechas de largos distintos.`,
    });
  }
  if (counts.some((n) => n === 1)) {
    issues.push({ kind: 'warning', text: 'Hay una zona con un solo equipo: no genera partidos.' });
  }
  return issues;
}
