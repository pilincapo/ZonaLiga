// Changelog de ZonaLiga — fuente única de verdad.
//
// Convención: cada vez que agregamos o mejoramos algo, se suma una entrada
// acá (más nueva arriba) y se sube APP_VERSION. El pie de página muestra
// "vX.Y.Z" con link a /changelog para que cualquiera pueda ver las novedades.

/** Versión actual de la app. Mantener sincronizada con la de package.json. */
export const APP_VERSION = '0.2.2';

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
 * Entradas ordenadas de la más nueva a la más vieja.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.2',
    date: '2026-09-23',
    title: 'Calendario automático',
    items: [
      { kind: 'nuevo', text: 'Cargá la fecha de inicio del torneo (y los días entre fechas): el fixture nace con el día de cada jornada calculado.' },
      { kind: 'mejora', text: 'En Fechas, los partidos sin día muestran su fecha planificada; al guardar, queda registrada.' },
    ],
  },
  {
    version: '0.2.1',
    date: '2026-09-23',
    title: 'Regenerar una fecha',
    items: [
      { kind: 'nuevo', text: 'Botón “Regenerar fecha” en Días, horas y canchas: re-slotea hora y cancha de un solo día con el patrón del torneo.' },
      { kind: 'nuevo', text: 'Si el inicio se retrasa, con un número podés correr todos los partidos pendientes de ese día (+ o − días) sin tocar el resto.' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-09-23',
    title: 'Canchas, horarios y ajustes de puntos',
    items: [
      { kind: 'nuevo', text: 'Configurá las canchas y horarios del torneo: el fixture se arma con ellos ya cargados.' },
      { kind: 'nuevo', text: 'Ajustes manuales de puntos: penalizaciones o correcciones, con motivo documentado y a la vista en posiciones.' },
      { kind: 'mejora', text: 'El historial de torneos aclara si el campeón tuvo ajustes de puntos.' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-23',
    title: 'Primera versión pública',
    items: [
      { kind: 'nuevo', text: 'Podés ver el sitio con fixture, posiciones, goleadores, equipos e historial de torneos.' },
      { kind: 'nuevo', text: 'Nueva página "En vivo": los partidos de hoy se actualizan solos, sin recargar.' },
      { kind: 'nuevo', text: 'Los delegados de cada equipo pueden cargar el resultado desde el celular y el administrador lo aprueba.' },
      { kind: 'nuevo', text: 'Se pueden compartir la tabla, la fecha y los resultados por WhatsApp con un toque.' },
      { kind: 'mejora', text: 'Tema claro u oscuro: elegilo en el botón de arriba o dejalo en automático.' },
      { kind: 'mejora', text: 'La app se puede instalar en el celular como si fuera una aplicación (PWA).' },
      { kind: 'mejora', text: 'Buscador único para encontrar equipos, jugadores y torneos al instante.' },
      { kind: 'nuevo', text: 'Esta página de novedades, con un acceso chiquito al pie de cada pantalla.' },
    ],
  },
];

/** Devuelve la entrada más reciente (la primera). */
export function latestEntry(): ChangelogEntry {
  return CHANGELOG[0]!;
}
