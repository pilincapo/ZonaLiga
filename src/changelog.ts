// Changelog de ZonaLiga — fuente única de verdad.
//
// Convención: cada vez que agregamos o mejoramos algo, se suma una entrada
// acá (más nueva arriba) y se sube APP_VERSION. El pie de página muestra
// "vX.Y.Z" con link a /changelog para que cualquiera pueda ver las novedades.

/** Versión actual de la app. Mantener sincronizada con la de package.json. */
export const APP_VERSION = '0.2.13';

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
    version: '0.2.13',
    date: '2026-09-23',
    title: 'Diseño flat y compacto (estilo apps de resultados)',
    items: [
      { kind: 'mejora', text: 'Nuevo look flat: se fueron degradados, sombras y bordes redondeados de más. Todo queda con bordes de 1px, colores planos y radios chicos — como FotMob o SofaScore.' },
      { kind: 'mejora', text: 'Todo más denso: filas de tabla más bajas, header de 52px, tarjetas y formularios con menos aire. En celular la tabla de posiciones muestra #, Equipo, PJ, DIF, PTS y FP sin scroll horizontal (las demás columnas aparecen en desktop).' },
      { kind: 'mejora', text: 'Números tabulares: las columnas de la tabla quedan alineadas en vertical. Escudos y botones más chicos y planos.' },
    ],
  },
  {
    version: '0.2.12',
    date: '2026-09-23',
    title: 'Planilla: los goles se declaran junto al marcador',
    items: [
      { kind: 'mejora', text: 'Goles local/visitante volvieron al form de la planilla y, al declararlos, se despliegan las listas para elegir el autor de cada gol: jugador de la plantilla, “En contra” o “Sin autor”. Se carga una sola vez — guardar reemplaza la declaración, nunca duplica.' },
      { kind: 'arreglo', text: 'Las listas de autores viven dentro del form principal: marcador y goleadores se guardan juntos. Las listas quedan prellenadas con lo ya cargado y, si un equipo no tiene plantilla, sus goles quedan “Sin autor” (salvo los “En contra”). El apartado de tarjetas queda solo para eventos sueltos.' },
      { kind: 'arreglo', text: 'Los “En contra” se registran a nombre del equipo cuyo arco recibió el gol — el rival —, como en la planilla de papel.' },
    ],
  },
  {
    version: '0.2.11',
    date: '2026-09-23',
    title: 'Planilla: listas por gol y marcador sin dobles cargas',
    items: [
      { kind: 'mejora', text: 'La carga rápida ahora muestra una lista desplegable por gol: elegís al autor (o “En contra”) — sin tildes ni escritura. La cantidad abre y cierra las listas.' },
      { kind: 'arreglo', text: 'Se sacaron los casilleros “Goles local/visitante” de la planilla: el marcador se muestra y se arma solo desde los goles cargados, así nunca difiere de los eventos. El walkover conserva su carga especial.' },
      { kind: 'arreglo', text: 'Las listas de goles del segundo equipo (visitante) no desplegaban al elegir la cantidad: ya funciona en los dos lados.' },
    ],
  },
  {
    version: '0.2.10',
    date: '2026-09-23',
    title: 'Marcador automático al cargar goles',
    items: [
      { kind: 'mejora', text: 'Al usar la carga rápida de goles, el marcador del partido se actualiza solo (cuenta los goles y también los en contra).' },
    ],
  },
  {
    version: '0.2.9',
    date: '2026-09-23',
    title: 'Carga rápida de goles en la planilla',
    items: [
      { kind: 'nuevo', text: 'En la planilla de cada partido hay una carga rápida: elegís cuántos goles hizo el equipo (1 a 4, o “Más de 4”) y tildás a los goleadores en la plantilla — sin escribir uno por uno.' },
      { kind: 'mejora', text: 'La app controla que la cantidad de goles coincida con los goleadores tildados y que todos sean del equipo, y ahora muestra los avisos de éxito y de error de la planilla (antes no se veían).' },
    ],
  },
  {
    version: '0.2.8',
    date: '2026-09-23',
    title: 'Fair play y valla menos vencida',
    items: [
      { kind: 'nuevo', text: 'Posiciones muestra una columna FP (fair play) calculada desde las tarjetas: amarilla 1 punto, roja 3 — gana el equipo que menos tiene.' },
      { kind: 'nuevo', text: 'Debajo de la tabla aparecen los líderes de Valla menos vencida (menos goles en contra) y Fair Play.' },
      { kind: 'mejora', text: 'Se puede encender o apagar desde las Reglas del torneo ("Fair play y valla menos vencida").' },
    ],
  },
  {
    version: '0.2.7',
    date: '2026-09-23',
    title: 'El fixture no se pisa con resultados cargados',
    items: [
      { kind: 'mejora', text: 'Si el torneo ya tiene partidos jugados (o está finalizado), el botón “Generar” de Fixture queda deshabilitado y la app explica por qué: así nunca se borran resultados sin querer.' },
      { kind: 'mejora', text: 'Para rearmar los cruces de un torneo empezado sigue estando “Regenerar cruce”, que conserva todo lo jugado.' },
    ],
  },
  {
    version: '0.2.6',
    date: '2026-09-23',
    title: 'Hora y cancha desde la configuración del torneo',
    items: [
      { kind: 'nuevo', text: 'En Fechas, la hora y la cancha de cada partido ahora se eligen con listas desplegables que toman los datos cargados en la configuración del torneo.' },
      { kind: 'mejora', text: 'Al regenerar una fecha, la app verifica que la cancha y el horario no se dupliquen con otro partido del mismo día: evita lo ocupado y, si no alcanzan las canchas, lo avisa con detalle.' },
    ],
  },
  {
    version: '0.2.5',
    date: '2026-09-23',
    title: 'Regenerar cruces a mitad de torneo',
    items: [
      { kind: 'nuevo', text: 'Botón “Regenerar cruce”: rearma los partidos pendientes cuando entra un equipo nuevo o cambió un participante, sin tocar lo jugado.' },
      { kind: 'nuevo', text: 'Al regenerar se verifica todo el fixture: si algún partido nuevo chocara con uno ya jugado (cruce repetido, equipo en dos partidos de la fecha o cancha doble), se avisa en detalle.' },
    ],
  },
  {
    version: '0.2.4',
    date: '2026-09-23',
    title: 'Día de juego',
    items: [
      { kind: 'nuevo', text: 'Elegí el día de juego del torneo (ej.: sábado): todas las fechas del calendario caen en ese día.' },
    ],
  },
  {
    version: '0.2.3',
    date: '2026-09-23',
    title: 'Aviso de slots en el fixture',
    items: [
      { kind: 'nuevo', text: 'El fixture avisa si alguna fecha tiene más partidos que canchas y horarios, y te dice cuántos slots faltan.' },
    ],
  },
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
