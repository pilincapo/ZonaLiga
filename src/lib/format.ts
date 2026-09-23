// Formateo de fechas y horas en español, sin depender del ICU del runtime.

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Parsea 'YYYY-MM-DD' como fecha local (sin TZ) para formatear día/mes. */
function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "sáb 09 ago" o "" si no hay fecha. */
export function formatDateShort(iso: string): string {
  const d = parseDate(iso);
  if (!d) return '';
  return `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

/** "sábado 9 de agosto" o "" si no hay fecha. */
export function formatDateLong(iso: string): string {
  const d = parseDate(iso);
  if (!d) return '';
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`;
}

/** Devuelve el año de una fecha ISO, o "" si no hay fecha. */
export function yearOf(iso: string): string {
  const m = /^(\d{4})/.exec(iso);
  return m?.[1] ?? '';
}

/** "2026" para un torneo con season, o el año de su primer partido como fallback. */
export function tournamentYear(season: string, firstMatchDate: string): string {
  return season || yearOf(firstMatchDate) || '';
}
