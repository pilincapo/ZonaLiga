// Changelog de ZonaLiga — fuente única de verdad: el archivo CHANGELOG.md
// de la raíz del proyecto.
//
// Convención: cada vez que agregamos o mejoramos algo, se suma una entrada
// al CHANGELOG.md (más nueva arriba) y se sube la versión en package.json.
// El pie de página muestra "vX.Y.Z" con link a /changelog para que cualquiera
// pueda ver las novedades. Este módulo lee el .md con import ?raw y lo
// convierte en datos para la página /changelog.

// El .md vive en la raíz del proyecto. Wrangler lo carga como Texto con la
// regla [[rules]] de wrangler.toml (import directo, sin sufijos); en los
// tests, vitest.config.ts define el mismo import con su loader de texto.
import mdSource from '../CHANGELOG.md';

/** Versión actual de la app: la primera entrada del changelog. */
export const APP_VERSION = parseChangelog(mdSource)[0]?.version ?? '0.0.0';

/** Categorías de cada cambio, con su etiqueta visible. */
export type ChangeKind = 'nuevo' | 'mejora' | 'arreglo';

export interface ChangelogItem {
  kind: ChangeKind;
  /** Texto en lenguaje sencillo: qué puede hacer ahora la gente. */
  text: string;
}

export interface ChangelogEntry {
  version: string;
  /** Fecha ISO (YYYY-MM-DD) de la publicación de esta versión. */
  date: string;
  /** Título corto de la versión. */
  title: string;
  items: ChangelogItem[];
}

/**
 * Parsea el CHANGELOG.md a la estructura de entradas. Es tolerante: si una
 * línea no encaja, la ignora (nunca rompe la página por un error de formato).
 *
 * Formato esperado por versión (Keep a Changelog):
 *
 *   ## [0.2.18] — 2026-09-24 — Título corto
 *
 *   ### Nuevo
 *   - Texto del cambio.
 *   ### Mejora
 *   - Otro cambio.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  // Encabezado de versión: admite "—" o "-" como separadores.
  const versionRe = /^##\s+\[([^\]]+)\]\s*[—-]\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$/;

  let current: ChangelogEntry | null = null;
  let currentKind: ChangeKind | null = null;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();

    const vm = versionRe.exec(line);
    if (vm) {
      current = { version: vm[1]!.trim(), date: vm[2]!.trim(), title: vm[3]!.trim(), items: [] };
      currentKind = null;
      entries.push(current);
      continue;
    }
    if (!current) continue;

    const km = /^###\s+(.+)$/.exec(line);
    if (km) {
      const h = km[1]!.toLowerCase();
      currentKind = h.startsWith('nuevo') ? 'nuevo' : h.startsWith('mejora') ? 'mejora' : h.startsWith('arreglo') ? 'arreglo' : null;
      continue;
    }

    if (line.startsWith('- ') && currentKind) {
      const text = line.slice(2).trim();
      if (text) current.items.push({ kind: currentKind, text });
    }
  }

  return entries;
}

/**
 * Entradas ordenadas de la más nueva a la más vieja. Compara la versión por
 * partes numéricas (0.2.16 > 0.2.9, que como texto saldría al revés).
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(mdSource).sort(
  (a, b) => b.date.localeCompare(a.date) || compareVersions(a.version, b.version)
);

/** Devuelve la entrada más reciente (la primera). */
export function latestEntry(): ChangelogEntry {
  return CHANGELOG[0]!;
}
