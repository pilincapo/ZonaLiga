// Ayuda del panel: TODO el contenido en un solo lugar.
//
// Este módulo es la fuente única de verdad de la documentación interna. Si
// cambia una funcionalidad, se actualiza acá y se actualiza en toda la guía
// y en las ayudas contextuales (que leen de las mismas estructuras). No tiene
// base de datos ni HTML: se puede testear entero y reutilizar desde cualquier
// pantalla del panel.
//
// Regla de oro: acá solo se documenta lo que el sistema REALMENTE hace. Si
// una función no existe, no aparece. Si algo cambia de comportamiento, se
// corrige el texto, no el código.

/* ============================== Tipos ============================== */

/** Bloques de contenido que sabe renderizar la ayuda. */
export type HelpBlock =
  | { kind: 'p'; d: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'steps'; items: { t: string; d: string }[] }
  | { kind: 'warn'; t?: string; d: string }
  | { kind: 'note'; d: string }
  | { kind: 'keys'; rows: [string, string][] }
  | { kind: 'links'; items: { label: string; href: string }[] };

/** Sección de la guía (ancla navegable). */
export interface HelpSection {
  /** Ancla estable dentro de /admin/ayuda. */
  id: string;
  title: string;
  blocks: HelpBlock[];
  /** Palabras extra para la búsqueda (sin repetir lo que ya dice el texto). */
  keywords?: string[];
}

/** Categoría de la guía (pestaña del índice). */
export interface HelpCategory {
  id: string;
  title: string;
  icon: string;
  summary: string;
  sections: HelpSection[];
}

/**
 * Ayuda contextual de una pantalla del panel: el "¿Qué puedo hacer aquí?".
 * Se muestra plegada arriba del contenido de cada sección.
 */
export interface HelpTopic {
  /** Igual a la clave `active` de adminLayout. */
  id: string;
  /** Ruta de la pantalla, para el enlace "ver la pantalla". */
  page: string;
  /** Para qué sirve la pantalla, en una frase. */
  para: string;
  /** Qué acciones permite. */
  actions: string[];
  /** Qué precauciones tener. */
  cautions: string[];
  /** Qué bloqueos existen. */
  restrictions: string[];
  /** Secciones de la guía relacionadas. */
  more: { label: string; href: string }[];
}

/* ============================== Categorías ============================== */

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    icon: 'list',
    summary: 'El recorrido completo para levantar un torneo desde cero, y cómo está armado el panel.',
    sections: [
      {
        id: 'como-armar-el-panel',
        title: 'Cómo está armado el panel',
        keywords: ['menu', 'sidebar', 'navegacion', 'secciones', 'selector de torneo'],
        blocks: [
          {
            kind: 'p',
            d: 'El panel tiene las mismas secciones en todas las pantallas: una barra lateral con los grupos, una barra superior y el contenido. Toda pantalla del panel se abre con un menú de lado y un buscador.',
          },
          {
            kind: 'keys',
            rows: [
              ['Inicio', 'Resumen con números del torneo activo: equipos, jugadores, partidos, jornadas, tabla, próximos partidos y últimos resultados.'],
              ['Competencia', 'Torneos y Fixture y llaves. Son las pantallas que se usan ANTES de que empiece la competencia.'],
              ['Operación', 'Fechas, Calendario, Resultados (planillas) y Entregas. Son las pantallas que se usan cada semana.'],
              ['Equipos', 'Equipos, Jugadores y Delegados.'],
              ['Estadísticas', 'Tabla, goleadores, tarjetas, fair play y valla menos vencida del torneo.'],
              ['Administración', 'Ajustes de puntos y Suspensiones (el tribunal).'],
              ['Ayuda', 'Esta guía.'],
            ],
          },
          {
            kind: 'note',
            d: 'El selector de torneo de la barra superior es global: el torneo que está seleccionado manda en almost todas las pantallas. También podés cambiar de torneo con ?t=nombre-del-torneo en la dirección.',
          },
        ],
      },
      {
        id: 'flujo-completo',
        title: 'Cómo administrar un torneo desde cero',
        keywords: ['flujo', 'paso a paso', 'empezar', 'primer torneo', 'tutorial'],
        blocks: [
          {
            kind: 'steps',
            items: [
              { t: 'Creá el torneo', d: 'En Torneos → + Nuevo torneo. Poné nombre, temporada y dejalo en Borrador por ahora. El nombre es lo que ve la gente en el sitio público.' },
              { t: 'Cargá los equipos', d: 'En Equipos creá cada equipo (nombre, abreviatura, color y escudo). Un equipo es global: sirve para todos los torneos de la liga.' },
              { t: 'Cargá las plantillas', d: 'En Jugadores sumá los jugadores de cada equipo: nombre, dorsal y posición. Conviene hacerlo antes de generar el fixture.' },
              { t: 'Elegí participantes y zonas', d: 'Volvé a editar el torneo y tildá los equipos que participan. Si dividís en zonas, asigná una zona a cada equipo (los que queden sin zona no entran al fixture).' },
              { t: 'Configurá la competencia', d: 'En la misma pantalla, en "Configuración de competencia": formato, grupos, clasificados, playoffs, puntos, desempates y localía.' },
              { t: 'Configurá canchas, horarios y calendario', d: 'Canchas (una por línea), horarios de inicio, fecha de inicio, días entre fechas y día de juego. Esto define el patrón con el que se arma la grilla.' },
              { t: 'Configurá las reglas de sanción', d: 'Goles en walkover, partidos de sanción por roja, amarillas para suspender y si querés mostrar fair play y valla menos vencida.' },
              { t: 'Pasá el torneo a Inscripciones o En curso', d: 'El estado se cambia desde el mismo formulario del torneo. Borrador es para armar; Inscripciones es para abrir el cupo de equipos; En curso es cuando ya se juega.' },
              { t: 'Generá el fixture', d: 'En Fixture y llaves → Preparar vista previa. Revisá la vista previa y confirmá. El fixture queda armado con fechas, horas y canchas.' },
              { t: 'Revisá Fechas y Calendario', d: 'En Fechas acomodá horarios y canchas arrastrando filas. En Calendario filtrá por fecha y estado para ver qué falta.' },
              { t: 'Cada semana: cargá resultados', d: 'En Resultados (planillas) abrí cada partido y cargá el marcador, los autores de gol y los eventos. También podés delegar esa carga a los delegados.' },
              { t: 'Controlá posiciones y estadísticas', d: 'En Estadísticas y en la pantalla pública de Posiciones. Si algo no cierra, revisá Ajustes de puntos y Suspensiones.' },
              { t: 'Reprogramá lo que haga falta', d: 'Desde el Calendario o desde la planilla del partido. Siempre con motivo: queda registrado en el historial.' },
              { t: 'Finalizá y archivá', d: 'Cuando terminó, poné el torneo en Finalizado. Ahí los resultados quedan congelados como históricos. Archivado es para torneos viejos que ya no querés ni ver en el selector.' },
            ],
          },
          {
            kind: 'warn',
            t: 'Orden importante',
            d: 'No cambies la configuración de competencia con el torneo En curso ni con resultados cargados: varios cambios quedan bloqueados justamente para no romper la competencia que ya empezó.',
          },
        ],
      },
      {
        id: 'como-entrar',
        title: 'Entrar al panel',
        keywords: ['login', 'contrasena', 'sesion', 'acceso'],
        blocks: [
          { kind: 'p', d: 'El panel pide una sola contraseña, configurada como secreto ADMIN_PASSWORD del proyecto. Si abre el sitio público pero no el panel, casi siempre es la contraseña.' },
          { kind: 'ul', items: ['La sesión dura lo que la cookie del navegador.', 'Cerrar sesión está arriba a la derecha, junto al selector de tema.', 'No hay usuarios ni contraseñas separadas: quien tiene la contraseña administra todo.'] },
        ],
      },
    ],
  },
  {
    id: 'torneos',
    title: 'Torneos',
    icon: 'trophy',
    summary: 'Crear, editar, borrar y mover un torneo por sus cinco estados. Qué se puede tocar en cada uno.',
    sections: [
      {
        id: 'crear-un-torneo',
        title: 'Crear un torneo',
        keywords: ['alta', 'nuevo', 'crear'],
        blocks: [
          { kind: 'p', d: 'Torneos → + Nuevo torneo. El formulario tiene, en orden: nombre y temporada, estado, zonas, participantes, canchas y horarios, configuración de competencia y reglas de puntuación.' },
          { kind: 'keys', rows: [
            ['Nombre', 'Obligatorio. Es el título que ven los visitantes. Se usa también para armar la dirección del torneo.'],
            ['Temporada', 'Opcional, texto libre. Ej.: 2026.'],
            ['Estado', 'Dónde empieza el torneo. Ver "Los estados del torneo".'],
            ['Formato (legado)', 'Campo informative y deshabilitado: los formatos viejos quedaron como dato histórico. El formato real se elige en Configuración de competencia.'],
          ] },
        ],
      },
      {
        id: 'estados-del-torneo',
        title: 'Los estados del torneo',
        keywords: ['borrador', 'inscripciones', 'activo', 'finalizado', 'archivado', 'estados'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['Borrador', 'Preparás todo con libertad: participantes, zonas, formato, fixture. Nadie ve el torneo en el sitio salvo que le compartas el enlace.'],
              ['Inscripciones', 'El torneo está abierto a equipos pero todavía no arranca. Se puede seguir ajustando la lista de participantes.'],
              ['En curso', 'Ya se juega. Se congelan las altas y bajas de participantes y la estructura del fixture.'],
              ['Finalizado', 'Terminó. Resultados, eventos, configuración de competencia y estructura quedan congelados como histórico.'],
              ['Archivado', 'Como Finalizado pero además fuera del selector habitual: es para torneos viejos.'],
            ],
          },
          { kind: 'note', d: 'El ciclo natural es Borrador → Inscripciones → En curso → Finalizado → Archivado. Mientras el torneo no esté Finalizado ni Archivado podés volverlo a un estado anterior. Desde Finalizado solo se pasa a Archivado; desde Archivado no se vuelve.' },
        ],
      },
      {
        id: 'que-se-puede-tocar',
        title: 'Qué se puede modificar en cada estado',
        keywords: ['bloqueos', 'solo lectura', 'congelado', 'que puedo editar'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['Borrador / Inscripciones', 'Todo: participantes, zonas, formato, puntos, desempates, localía, canchas, horarios, calendario, fixture y resultados.'],
              ['En curso', 'Se pueden cambiar las reglas de puntuación (puntos, desempates, localía, canchas y horarios) y cargar o corregir resultados y reprogramar. NO se pueden agregar ni sacar participantes, ni cambiar zonas, formato, grupos ni playoffs.'],
              ['Finalizado', 'Nada: ni participantes, ni estructura, ni reglas, ni resultados, ni reprogramaciones.'],
              ['Archivado', 'Nada, y además queda fuera del selector de torneo.'],
            ],
          },
          {
            kind: 'warn',
            t: 'Los bloqueos no son solo de la pantalla',
            d: 'Si una opción aparece deshabilitada es porque el estado del torneo lo impide. El servidor también lo valida: aunque se salte el botón, el cambio se rechaza.',
          },
        ],
      },
      {
        id: 'borrar-un-torneo',
        title: 'Borrar un torneo',
        keywords: ['eliminar', 'borrar'],
        blocks: [
          { kind: 'p', d: 'En la tarjeta del torneo, el botón ✕ pide confirmación y borra el torneo junto con todos sus partidos, eventos y entregas de delegados.' },
          { kind: 'warn', d: 'Es definitivo y no se puede deshacer. Si solo querés que no se use más, finalizalo o archivalo.' },
        ],
      },
      {
        id: 'participantes-y-zonas',
        title: 'Participantes y zonas',
        keywords: ['participantes', 'inscriptos', 'zonas', 'grupos manuales'],
        blocks: [
          { kind: 'p', d: 'En el formulario del torneo hay una tabla con todos los equipos: una casilla para marcar que participa y una lista para asignarle zona (si dividís en zonas).' },
          { kind: 'ul', items: [
            'Un equipo puede participar en varios torneos a la vez; la participación se marca torneo por torneo.',
            'Si activás "Dividir en zonas manualmente", escribí los nombres de las zonas (de 2 a 8, uno por línea).',
            'Un equipo que participa y no tiene zona no entra al fixture: la pantalla te avisa con ⚠ Participan sin zona.',
            'Un equipo inactivo aparece en la lista marcado como Inactivo, y no se le puede asignar zona (no puede asignarse zona a un equipo que no juega).',
          ] },
        ],
      },
    ],
  },
{
    id: 'competencia',
    title: 'Competencia',
    icon: 'chart',
    summary: 'Formatos, grupos, playoffs, puntos, desempates y localía. Cuándo usar cada formato.',
    sections: [
      {
        id: 'formatos',
        title: 'Formatos disponibles',
        keywords: ['todos contra todos', 'una rueda', 'dos ruedas', 'grupos', 'eliminacion directa', 'copa', 'fase final'],
        blocks: [
          { kind: 'p', d: 'El formato se elige en Configuración de competencia y define qué bloques de configuración aparecen y cómo se arma el fixture.' },
          {
            kind: 'keys',
            rows: [
              ['Todos contra todos (ida y vuelta)', 'Cada equipo juega contra todos los demás dos veces (una de local, una de visitante). Es el formato clásico de liga.'],
              ['Todos contra todos (solo ida)', 'Cada equipo juega contra todos una sola vez. Se usa cuando no se puede repetir localía.'],
              ['Todos contra todos (dos ruedas)', 'Como la ida y vuelta, pero organizando el fixture como dos ruedas separadas.'],
              ['Fase de grupos (sin playoffs)', 'Equipos repartidos en grupos; dentro de cada grupo se juega todos contra todos. Gana el mejor de cada grupo y ahí termina.'],
              ['Grupos + playoffs', 'Fase de grupos y después una llave de eliminación directa con los clasificados. Es el formato de copa con fase previa.'],
              ['Eliminación directa', 'Copa pura: desde la primera instancia, todos se eliminan. No hay tabla de puntos.'],
              ['Liga + fase final', 'Una liga (todos contra todos) y, al final, una llave entre los mejores.'],
              ['Fase regular + playoffs', 'Una primera fase (liga o grupos) y después una llave. La diferencia con "Liga + fase final" es que la fase previa puede ser por grupos.'],
            ],
          },
          {
            kind: 'note',
            d: 'Todos los formatos salvo Eliminación directa usan tabla de puntos. Grupos + playoffs, Eliminación directa, Liga + fase final y Fase regular + playoffs suman, además, una llave de playoffs.',
          },
        ],
      },
      {
        id: 'grupos',
        title: 'Grupos y clasificados',
        keywords: ['grupos', 'clasificados', 'fase de grupos'],
        blocks: [
          { kind: 'p', d: 'Aparecen solo en formatos con grupos. Configurás la cantidad de grupos (de 2 a 8) y cuántos clasifican de cada grupo (de 1 a 16).' },
          { kind: 'p', d: 'Al generar el fixture, los equipos participantes se reparten solos entre los grupos. Si dividiste en zonas manualmente, esas zonas mandan sobre los grupos automáticos.' },
          { kind: 'warn', d: 'Configuraciones que el sistema rechaza al guardar: menos de 2 grupos, más de 8 grupos, clasificados fuera de 1 a 16, o que en total no sigan clasificando al menos 2 equipos a la llave.' },
        ],
      },
      {
        id: 'playoffs',
        title: 'Playoffs',
        keywords: ['playoffs', 'llaves', 'cuartos', 'semifinales', 'octavos', 'penales', 'tercer puesto'],
        blocks: [
          { kind: 'p', d: 'Aparece en los cuatro formatos con playoffs. Se configura en qué instancia arranca la llave, cómo se resuelve un empate y si hay partido de ida y vuelta.' },
          {
            kind: 'keys',
            rows: [
              ['Instancia inicial', 'Desde qué ronda arranca la llave: octavos (16 equipos), cuartos (8), semifinales (4) o final (2). Si el sistema te rechaza la instancia, es que no llegan los equipos suficientes.'],
              ['Partidos de ida y vuelta', 'Si está activado, cada cruce se juega en dos partidos. Si no, partido único.'],
              ['Empate en playoffs', 'Penales · Definición por penales tras gol de visitante · Empate se obra (siguen ambos) · Partido desempate.'],
              ['Partido por el tercer puesto', 'Agrega un partido extra entre los que pierden la semifinal.'],
            ],
          },
          { kind: 'warn', d: 'Con ida y vuelta la cantidad de equipos en la llave tiene que ser par. Y el partido por el tercer puesto requiere al menos semifinales.' },
          { kind: 'p', d: 'Las llaves se arman desde Fixture y llaves → Generar llaves, y solo cuando la fase previa terminó de jugarse y no hay resultados cargados todavía. Los equipos "Por definir" se completan solos a medida que se cargan los resultados de la ronda anterior.' },
        ],
      },
      {
        id: 'puntos-y-desempates',
        title: 'Puntos y desempates',
        keywords: ['puntos', 'desempate', 'tabla', 'fair play', 'head to head'],
        blocks: [
          { kind: 'p', d: 'Cada formato con tabla define los puntos por victoria, empate y derrota (por defecto 3 / 1 / 0) y el orden de los criterios de desempate.' },
          {
            kind: 'keys',
            rows: [
              ['Puntos', '3 para el ganador, 1 para el empate, 0 para el que pierde (configurable).'],
              ['Diferencia de goles', 'Goles a favor menos goles en contra.'],
              ['Goles a favor', 'Cuántos goles hizo el equipo.'],
              ['Goles en contra', 'Cuántos goles le hicieron.'],
              ['Fair play', 'Menos tarjetas es mejor: amarilla suma 1, roja suma 3. Solo está activo si activaste "Fair play y valla menos vencida".'],
              ['Entre enfrentados', 'Los puntos que cada uno le sacó al otro en sus partidos directos.'],
            ],
          },
          { kind: 'p', d: 'Los desempates se ordenan de mayor a menor prioridad: el 1º se aplica primero y solo se usa el 2º si hay empate en el anterior.' },
          { kind: 'warn', d: 'El sistema rechaza puntos que no sean enteros de 0 a 100, una victoria que no sea mayor que el empate, un empate menor que la derrota, y criterios de desempate repetidos o inexistentes.' },
        ],
      },
      {
        id: 'localia',
        title: 'Localía',
        keywords: ['localia', 'local', 'visitante', 'cancha neutral'],
        blocks: [
          { kind: 'keys', rows: [
            ['Alternada', 'Cada equipo va alternando local y visitante en cada fecha.'],
            ['Sorteada', 'La localía se define al generar el fixture.'],
            ['Sin localía fija (cancha neutral)', 'Todos los partidos se cargan con el local primero y todos los equipos funcionan como visitantes en la práctica.'],
          ] },
          { kind: 'note', d: 'La localía se elige una vez y afecta la generación del fixture. Cambiarla después con partidos ya generados no reorganiza lo que ya está armado.' },
        ],
      },
      {
        id: 'reglas-de-sancion',
        title: 'Reglas de sanción',
        keywords: ['walkover', 'roja', 'amarillas', 'sancion', 'fair play'],
        blocks: [
          { kind: 'p', d: 'Este bloque del formulario del torneo define cómo se comportan las tarjetas y el walkover en ESTE torneo.' },
          { kind: 'keys', rows: [
            ['Goles en walkover', 'Resultado que se le asienta al ganador de un partido marcado como Walkover.'],
            ['Suspensión por roja', 'Partidos de sanción por roja directa (se puede dejar en 0 si no querés suspender por rojas).'],
            ['Amarillas para suspensión', 'Cantidad de amarillas acumuladas para quedar suspendido. 0 = desactivado.'],
            ['Ventana de acumulación', 'Últimas N jornadas en las que se cuentan las amarillas. 0 = cuenta todo el torneo.'],
            ['Fair play y valla menos vencida', 'Activa la columna y los líderes de fair play y valla en Posiciones y Estadísticas.'],
          ] },
        ],
      },
      {
        id: 'canchas-y-calendario',
        title: 'Canchas, horarios y calendario',
        keywords: ['canchas', 'horarios', 'kickoff', 'fecha de inicio', 'dia de juego', 'calendario'],
        blocks: [
          { kind: 'p', d: 'El patrón con el que se arman las fechas del fixture sale de acá.' },
          { kind: 'keys', rows: [
            ['Canchas', 'Una por línea, hasta 12. Si no cargás ninguna, el fixture sale sin cancha.'],
            ['Horarios de inicio', 'Uno por línea o separados por comas, hasta 12. Acepta "9" o "9:30".'],
            ['Fecha de inicio', 'Primer día de juego. Desde ahí el calendario avanza.'],
            ['Días entre fechas', 'De 1 a 30. 7 = cada fecha una semana después; 3 o 4 si jugás a mitad de semana.'],
            ['Día de juego', 'Las fechas se agarran a ese día (por ejemplo, sábado).'],
          ] },
          { kind: 'p', d: 'Al generar el fixture, los partidos de cada fecha rotan entre canchas y horarios: primera hora en todas las canchas, después la siguiente hora, y así. Si la configuración no alcanza para todos los partidos de una fecha, los últimos repiten horario.' },
        ],
      },
    ],
  },
  {
    id: 'equipos',
    title: 'Equipos',
    icon: 'users',
    summary: 'Alta, edición, activación, borrado y la relación entre un equipo y cada torneo.',
    sections: [
      {
        id: 'crear-equipo',
        title: 'Crear y editar un equipo',
        keywords: ['alta', 'equipo', 'escudo', 'color', 'abreviatura'],
        blocks: [
          { kind: 'keys', rows: [
            ['Nombre', 'Obligatorio, hasta 80 caracteres.'],
            ['Abreviatura', 'Hasta 4 caracteres: es lo que se ve en los escudos chicos.'],
            ['Color', 'Hexadecimal tipo #22c55e. Se usa en las tablas y distintivos.'],
            ['Escudo', 'Dirección web de una imagen (http o https). Solo direcciones web: si ponés otra cosa, el escudo queda roto en todo el sitio.'],
            ['Activo', 'Un equipo inactivo no puede jugar ni entra en la generación del fixture.'],
          ] },
          { kind: 'warn', d: 'El color y el escudo se validan: un color que no sea hexadecimal o un escudo que no sea una dirección web se rechazan con un error.' },
        ],
      },
      {
        id: 'borrar-equipo',
        title: 'Activar, desactivar y borrar',
        keywords: ['borrar', 'eliminar', 'desactivar', 'activo', 'inactivo'],
        blocks: [
          { kind: 'keys', rows: [
            ['Desactivar', 'El equipo queda cargado pero no juega: no aparece como participante válido para generar fixture. Es la salida cuando un equipo se da de baja a mitad de torneo y querés conservar su historial.'],
            ['Borrar', 'Solo se permite si el equipo NO tiene partidos en ningún fixture. Si tiene partidos, el borrado se bloquea y la pantalla lo explica.'],
          ] },
          { kind: 'p', d: 'Si dejó de competir pero tiene partidos, la salida es marcarlo inactivo. El borrado de verdad solo es para equipos que nunca jugaron.' },
        ],
      },
      {
        id: 'equipo-torneo',
        title: 'Equipo global y participación en un torneo',
        keywords: ['participacion', 'inscripto', 'globales'],
        blocks: [
          { kind: 'p', d: 'Un equipo existe una sola vez en toda la liga: es global. Lo que es por torneo es la participación.' },
          { kind: 'ul', items: [
            'Un mismo equipo puede participar en varios torneos a la vez, con participantes distintos en cada uno.',
            'La participación se marca en el formulario del torneo (casilla "Participa").',
            'Si el torneo tiene zonas, además hay que asignarle una zona a cada equipo participante.',
            'Dar de baja un equipo globalmente no lo saca de los torneos en los que ya participated: por eso conviene desactivarlo en lugar de borrarlo.',
          ] },
        ],
      },
      {
        id: 'delegado-por-equipo',
        title: 'Delegado del equipo',
        keywords: ['delegado', 'codigo', 'acceso'],
        blocks: [
          { kind: 'p', d: 'Desde la ficha del equipo (o desde Delegados) se puede habilitar un delegado: se genera un código de acceso con el que ese delegado entra a una pantalla propia para entregar el resultado de sus partidos.' },
          { kind: 'warn', d: 'Generar un código nuevo invalida el anterior: el delegado que tenga el viejo deja de poder entrar.' },
        ],
      },
    ],
  },
  {
    id: 'jugadores',
    title: 'Jugadores',
    icon: 'users',
    summary: 'Altas, edición, dorsales, posiciones, baja y reactivación. Qué pasa con el historial.',
    sections: [
      {
        id: 'alta-jugador',
        title: 'Cargar un jugador',
        keywords: ['alta', 'jugador', 'dorsal', 'numero', 'posicion'],
        blocks: [
          { kind: 'keys', rows: [
            ['Equipo', 'La plantilla a la que pertenece.'],
            ['Nombre', 'Obligatorio, hasta 80 caracteres.'],
            ['Dorsal', 'Opcional, entre 1 y 99. Si dos jugadores del mismo equipo tienen el mismo dorsal, el sistema te avisa pero guarda igual.'],
            ['Posición', 'AR (arquero), DF (defensor), MED (mediocampista), DEL (delantero). Opcional.'],
          ] },
        ],
      },
      {
        id: 'editar-jugador',
        title: 'Editar y buscar en la plantilla',
        keywords: ['editar', 'filtros', 'busqueda'],
        blocks: [
          { kind: 'p', d: 'Cada tarjeta de la lista de jugadores trae su propio formulario de edición (nombre, dorsal y posición), que se abre sin salir de la pantalla.' },
          { kind: 'p', d: 'La lista se filtra por equipo, por texto (nombre o dorsal) y por estado (en plantilla / dado de baja) y posición. Los filtros se combinan.' },
        ],
      },
      {
        id: 'baja-y-reactivacion',
        title: 'Baja, borrado y reactivación',
        keywords: ['baja', 'eliminar', 'reactivar', 'logico', 'historial'],
        blocks: [
          { kind: 'p', d: 'Qué pasa al quitar un jugador depende de su historial, y el botón te lo dice antes de confirmar:' },
          {
            kind: 'keys',
            rows: [
              ['Se elimina', 'El jugador no tiene ningún evento (goles, tarjetas) ni entregas de delegado cargadas. Se borra de verdad y no queda rastro.'],
              ['Se da de baja', 'El jugador tiene eventos o entregas. No se borra: se marca como dado de baja para que sus estadísticas, la planilla y las fichas públicas conserven al autor.'],
            ],
          },
          { kind: 'p', d: 'Un jugador dado de baja se puede reactivar en cualquier momento con el botón ↺ Reactivar de su tarjeta. Vuelve a estar en la plantilla.' },
          {
            kind: 'warn',
            t: 'Un detalle que conviene saber',
            d: 'Cuando un jugador está dado de baja, sus datos NO se borran: el dorsal, el nombre y el historial siguen ahí. En la planilla el jugador puede seguir apareciendo, porque el sistema guarda la historia completa del partido. Ese jugador no se puede elegir para cargar algo nuevo, pero el gol o la tarjeta que ya tiene sigue con su nombre: si desapareciera de la lista, al guardar la planilla ese gol se volvería "Sin autor" sin avisar. Por eso vuelve a las listas de autores marcado con "dado de baja (se conserva)". Si lo reactivás, vuelve a ser elegible como cualquier otro.',
          },
        ],
      },
      {
        id: 'historial-jugador',
        title: 'Qué historial ve el jugador',
        keywords: ['historial', 'eventos', 'entregas'],
        blocks: [
          { kind: 'p', d: 'Cada tarjeta muestra cuántos eventos tiene el jugador y el botón de quitar avisa si lo va a eliminar o a dar de baja. El sistema nunca borra a alguien que ya aparece en un resultado.' },
        ],
      },
    ],
  },
{
    id: 'delegados',
    title: 'Delegados',
    icon: 'shield',
    summary: 'Habilitar delegados por equipo, códigos de acceso y entregas de resultados.',
    sections: [
      {
        id: 'habilitar-delegado',
        title: 'Habilitar un delegado',
        keywords: ['delegado', 'codigo', 'revocar', 'habilitar'],
        blocks: [
          { kind: 'p', d: 'En Delegados (o desde la ficha de un equipo) podés habilitar el acceso de cada equipo a la pantalla de entregas.' },
          {
            kind: 'keys',
            rows: [
              ['Habilitar', 'Genera el código de acceso del equipo. Ese código es la contraseña del delegado.'],
              ['Código (⟳)', 'Genera un código nuevo. El anterior deja de funcionar de inmediato.'],
              ['Revocar (✕)', 'Deja al equipo sin acceso. Podés volver a habilitarlo más adelante.'],
            ],
          },
          { kind: 'note', d: 'Cada equipo tiene su propio código: son independientes entre sí y del password del panel.' },
        ],
      },
      {
        id: 'entregas',
        title: 'Entregas de resultados',
        keywords: ['entregas', 'aprobar', 'rechazar', 'resultado por delegado'],
        blocks: [
          { kind: 'p', d: 'Un delegado habilitado entra a una pantalla propia, ve los partidos de su equipo y envía un resultado con sus eventos (goles, tarjetas, minutos). Queda como "entrega pendiente": nada se publica hasta que el administrador lo apruebe.' },
          { kind: 'p', d: 'En Entregas (o desde el bloque de entregas que aparece en la planilla de cada partido) revisás cada entrega y decidís:' },
          { kind: 'ul', items: [
            'Aprobar aplicando el resultado y/o los eventos: lo que marques se publica en la tabla, el fixture y las estadísticas.',
            'Rechazar con un motivo: la entrega queda descartada y el delegado puede enviarla de nuevo.',
          ] },
          { kind: 'warn', d: 'Aprobar con "aplicar eventos" reemplaza los eventos del equipo que entregó en ese partido. Si los cargaste vos a mano en la planilla, revisá antes de aprobar.' },
          { kind: 'note', d: 'La pantalla de Entregas marca con un distintivo los partidos que tienen entregas esperando revisión. El mismo número aparece en el menú.' },
        ],
      },
      {
        id: 'sanciones-del-delegado',
        title: 'Límites de lo que puede cargar el delegado',
        keywords: ['delegado', 'validacion', 'limites'],
        blocks: [
          { kind: 'ul', items: [
            'Solo puede entregar partidos de su propio equipo.',
            'Solo puede cargar eventos de jugadores de su propia plantilla.',
            'El tipo de evento tiene que ser gol, en contra, amarilla o roja.',
            'El minuto, si se informa, va de 0 a 130.',
            'Hay un máximo de eventos por entrega.',
          ] },
          { kind: 'p', d: 'Los eventos del delegado que no están habilitados no pueden guardarse.' },
        ],
      },
    ],
  },
  {
    id: 'fixture',
    title: 'Fixture',
    icon: 'calendar',
    summary: 'Generar el fixture, la vista previa, las llaves, el cruce entre zonas y las protecciones.',
    sections: [
      {
        id: 'generar-fixture',
        title: 'Generar el fixture',
        keywords: ['generar', 'fixture', 'vista previa', 'confirmar'],
        blocks: [
          {
            kind: 'steps',
            items: [
              { t: 'Preparar vista previa', d: 'En Fixture y llaves, el botón arma un borrador del fixture con los equipos activos que participan del torneo, aplicando formato, zonas, canchas y horarios. Todavía no se guarda nada.' },
              { t: 'Revisar la vista previa', d: 'Te muestra fechas, cruces y zona de cada partido antes de confirmar. Si algo está mal, corregí el formulario del torneo y volvé a preparar.' },
              { t: 'Confirmar', d: 'Guarda el fixture: se borra el fixture anterior (si había) y se crea el nuevo.' },
              { t: 'Descartar', d: 'Cierra la vista previa sin guardar nada.' },
            ],
          },
          { kind: 'note', d: 'El formato de la competencia manda: en formatos con grupos el generador usa ida o ida y vuelta según el formato configurado, y no se puede cambiar desde acá.' },
        ],
      },
      {
        id: 'protecciones-fixture',
        title: 'Protecciones al generar',
        keywords: ['proteccion', 'bloqueo', 'regenerar', 'jugados'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['Torneo En curso', 'No se puede generar ni regenerar el fixture: la estructura ya está en juego.'],
              ['Torneo Finalizado o Archivado', 'Tampoco: es solo lectura.'],
              ['Ya hay partidos jugados', 'Confirmar un fixture nuevo está bloqueado: se avisaría cuántos partidos se perderían.'],
              ['Sin partidos jugados', 'Se puede reemplazar todo el fixture freely.'],
            ],
          },
          { kind: 'p', d: 'Estos bloqueos los aplica el servidor, no solo la pantalla: saltarte el botón no los esquiva.' },
        ],
      },
      {
        id: 'regenerar',
        title: 'Regenerar cruce',
        keywords: ['regenerar', 'regenerar cruce', 'equipo nuevo', 'pendientes'],
        blocks: [
          { kind: 'p', d: 'Es una operación distinta a "regenerar fixture". Regenerar cruce rearma SOLO los partidos pendientes y conserva los jugados con sus resultados intactos. Es lo que se usa cuando entró un equipo nuevo o hay que acomodar los pendientes.' },
          { kind: 'ul', items: [
            'Los partidos jugados y con resultado no se tocan jamás.',
            'Los partidos pendientes que cambian se reemplazan por nuevos cruces.',
            'Las entregas de delegados de esos partidos pendientes se descartan.',
            'Al terminar, el sistema vuelve a verificar que no haya choques (dos partidos con la misma cancha y hora el mismo día) y te avisa si encuentra alguno.',
          ] },
        ],
      },
      {
        id: 'cruce-entre-zonas',
        title: 'Cruce entre zonas',
        keywords: ['cruce', 'zonas', 'espejo', 'invertido', 'cruzado'],
        blocks: [
          { kind: 'p', d: 'Cuando el torneo tiene exactamente dos zonas, el generador ofrece una fecha de cruce entre ellas: los equipos de una zona se cruzan con los de la otra en esa fecha.' },
          { kind: 'keys', rows: [
            ['Espejo', '1º de A contra 1º de B, 2º de A contra 2º de B, y así.'],
            ['Invertido', '1º de A contra el último de B, 2º de A contra el anteúltimo de B.'],
            ['Cruzado', '1º de A contra 2º de B, 2º de A contra 1º de B.'],
            ['Los cruces suman puntos', 'Si está activado, los partidos del cruce cuentan para la tabla. Si no, no cuentan (pero se siguen jugando).'],
            ['Fecha del cruce', 'Se puede fijar en qué fecha va; si se deja vacío, se usa la primera fecha libre después de las fechas de zona.'],
          ] },
          { kind: 'warn', d: 'Para cambiar un cruce ya generado hay que regenerar el fixture completo (y eso exige que no haya partidos jugados).' },
        ],
      },
      {
        id: 'partido-suelto',
        title: 'Partidos sueltos y editar un partido',
        keywords: ['partido suelto', 'editar partido', 'agregar partido'],
        blocks: [
          { kind: 'p', d: 'Además del fixture generado se pueden agregar partidos sueltos (por ejemplo un desempate o un partido extra) desde Fixture y llaves → + Partido suelto.' },
          { kind: 'keys', rows: [
            ['Torneo', 'A qué torneo pertenece.'],
            ['Fecha (jornada)', 'A qué fecha (ronda) del fixture se lo engancha.'],
            ['Zona', 'Opcional.'],
            ['Local y Visitante', 'Se eligen de los participantes del torneo.'],
            ['Día, Hora, Cancha', 'Los datos de agendado.'],
            ['Estado', 'Programado, Jugado, Postergado, Suspendido o Walkover.'],
          ] },
          { kind: 'note', d: 'Desde esa pantalla no se carga el resultado: eso se hace desde la planilla del partido, a la que hay un enlace directo.' },
          { kind: 'p', d: 'En la grilla del fixture, cada partido tiene una acción para editarlo y otra para eliminarlo (solo si no tiene resultado cargado).' },
        ],
      },
    ],
  },
  {
    id: 'partidos',
    title: 'Partidos y planillas',
    icon: 'ball',
    summary: 'Cargar resultados, autores de gol, eventos y estados del partido. Incluye todas las validaciones.',
    sections: [
      {
        id: 'abrir-una-planilla',
        title: 'Abrir la planilla de un partido',
        keywords: ['planilla', 'resultado', 'abrir'],
        blocks: [
          { kind: 'p', d: 'La planilla es la pantalla donde se carga todo lo que pasó en un partido: estado, resultado, autores de gol, tarjetas y notas. Está en Resultados.' },
          { kind: 'p', d: 'La lista muestra los partidos pendientes (con el día más próximo primero) y los últimos cargados. Si el torneo tiene una entrega de delegado pendiente, el partido aparece marcado con "Entrega".' },
          { kind: 'note', d: 'Si hay más de un torneo, la lista tiene un selector arriba para elegir de cuál es.' },
        ],
      },
      {
        id: 'estados-del-partido',
        title: 'Estados del partido',
        keywords: ['estado', 'jugado', 'programado', 'postergado', 'suspendido', 'libre', 'walkover'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['Programado', 'El partido está agendado pero todavía no se jugó.'],
              ['Jugado', 'Tiene resultado cargado: cuenta para la tabla.'],
              ['Libre', 'El partido NO se juega nunca: queda exento de la tabla, no bloquea las llaves y no se re-agenda. Es el estado para cuando un partido queda cancelado (por ejemplo, se disarmó la cancha).'],
              ['Postergado', 'No se pudo jugar en su fecha pero todavía puede llegar a jugarse: hay que buscarle lugar.'],
              ['Suspendido', 'No se juega por una causa de disciplina (por ejemplo, un expulsado).'],
              ['Walkover', 'Se decide sin jugar: el ganador recibe el resultado configurado en las reglas del torneo y el perdedor queda en 0.'],
            ],
          },
          { kind: 'p', d: 'Solo cuentan para la tabla los partidos Jugado y Walkover. Postergado, Suspendido, Libre y Programado no suman nada hasta que cambies su estado.' },
          {
            kind: 'warn',
            t: 'Cancelar un partido',
            d: 'Cuando ponés un partido en "Libre" el sistema te pide el motivo: sin motivo no lo guarda. Ese texto queda escrito en la bitácora del partido, así siempre queda dicho POR QUÉ no se jugó. Si volvés a guardar un partido que ya estaba en Libre, no te lo vuelve a pedir.',
          },
          {
            kind: 'warn',
            d: 'Si volvés un partido de Jugado a Programado, el resultado deja de contar en la tabla (se recalcula al instante). Los autores de gol que habías cargado siguen guardados.',
          },
        ],
      },
      {
        id: 'cargar-resultado',
        title: 'Cargar el resultado y los autores de gol',
        keywords: ['resultado', 'marcador', 'autores', 'goles'],
        blocks: [
          { kind: 'p', d: 'En la planilla escribís el marcador (goles local y visitante) y, debajo, elegís el autor de cada gol de una lista. Las listas se despliegan solas según la cantidad de goles que declaraste.' },
          { kind: 'p', d: 'Cada lista de autor ofrece tres opciones especiales además de la plantilla:' },
          { kind: 'ul', items: [
            'En contra: el gol cuenta a favor del rival (gol en el arco propio).',
            'Sin autor: el gol cuenta, pero no se atribuye a nadie.',
            'Los jugadores de la plantilla, con su dorsal.',
          ] },
          { kind: 'p', d: 'Al guardar, los goles del partido se REEMPLAZAN con lo que declaraste: nunca se duplican ni se suman de más. Si un equipo no tiene plantilla cargada, sus goles quedan sin autor (salvo los "en contra").' },
          {
            kind: 'warn',
            t: 'Cuidado al bajar el marcador',
            d: 'Si bajás el marcador de un partido que ya tiene goles con autor, se borran esos autores. La pantalla te avisa y te pide marcar una casilla de confirmación antes de guardar.',
          },
        ],
      },
      {
        id: 'cargar-eventos',
        title: 'Cargar eventos (tarjetas y minutos)',
        keywords: ['eventos', 'tarjetas', 'amarilla', 'roja', 'minuto'],
        blocks: [
          { kind: 'p', d: 'Abajo de la planilla hay un bloque de eventos por equipo (Local y Visitante). En cada uno elegís: el tipo de evento, el minuto (opcional) y el jugador, y lo agregás.' },
          { kind: 'ul', items: [
            'Gol, En contra, Amarilla y Roja.',
            'El minuto es opcional y va de 0 a 130.',
            'Un jugador suspendido para ese partido aparece marcado y no puede recibir eventos.',
            'Los eventos se pueden borrar con el ✕ de cada fila.',
          ] },
          {
            kind: 'warn',
            d: 'Un evento solo se carga si el jugador es de ese mismo equipo y si ese equipo juega ese partido. Si no, el sistema lo rechaza.',
          },
          { kind: 'note', d: 'Los eventos alimentan las tarjetas por equipo, el fair play, la valla menos vencida, las estadísticas y el cálculo automático de suspensiones.' },
        ],
      },
      {
        id: 'bitacora-del-partido',
        title: 'Bitácora del partido (qué se cambió y por qué)',
        keywords: ['bitacora', 'historial', 'cambio', 'quien cambio', 'motivo', 'auditoria partido'],
        blocks: [
          { kind: 'p', d: 'Al pie de la planilla hay un bloque "Bitácora del partido": una fila por cada cosa que cambió de verdad, con la fecha y hora, qué se tocó, quién lo hizo, cómo estaba antes, cómo quedó y el motivo.' },
          {
            kind: 'ul',
            items: [
              'Estado (por ejemplo, de Programado a Jugado).',
              'Resultado y a quién se le acreditó cada gol.',
              'Día, hora y cancha.',
              'Eventos: cada tarjeta o gol que se agregó o se borró, con su jugador y su minuto.',
              'Los equipos del partido y su fecha.',
            ],
          },
          { kind: 'p', d: 'El campo "Motivo del cambio" de la planilla es opcional: lo que escribas ahí se repite en todas las filas de ese guardado. Cuando el motivo importa de verdad, es la forma de dejarlo escrito.' },
          { kind: 'note', d: 'Guardar sin tocar nada NO escribe nada: si abrís la planilla, revisás y volvés a guardar igual, la bitácora queda limpia. Solo se anotan los cambios reales.' },
          { kind: 'note', d: 'El alcance es solo partidos: los equipos, los jugadores y los ajustes de puntos no llevan bitácora.' },
        ],
      },
      {
        id: 'puntos-manuales',
        title: 'Puntos manuales',
        keywords: ['puntos', 'override', 'penales', 'manual'],
        blocks: [
          { kind: 'p', d: 'En "Ajustes y notas" de la planilla hay dos campos para cargar los puntos a mano (local y visitante).' },
          { kind: 'ul', items: [
            'Si los dejás vacíos, los puntos se calculan con las reglas del torneo (por defecto 3 / 1 / 0).',
            'Si los cargás, el torneo los usa tal cual para ese partido.',
            'En un partido empatado de una llave, esos mismos valores se usan como resultado de los penales.',
          ] },
          { kind: 'note', d: 'Por eso el límite real de los puntos manuales es de 0 a 30 y no de 0 a 3: tiene que dar para un resultado de penales. Son enteros. Un 99 tipeado se rechaza.' },
        ],
      },
    ],
  },
{
    id: 'calendario',
    title: 'Calendario',
    icon: 'calendar',
    summary: 'La vista operativa del torneo: qué está jugado, qué falta y qué se reprogramó.',
    sections: [
      {
        id: 'que-muestra',
        title: 'Qué muestra el calendario',
        keywords: ['calendario', 'vista', 'jornadas'],
        blocks: [
          { kind: 'p', d: 'El calendario agrupa todos los partidos del torneo fecha por fecha, con el estado real de cada uno. Arriba hay números con el total de cada estado.' },
          { kind: 'keys', rows: [
            ['Jugado', 'Tiene resultado cargado.'],
            ['Pendiente', 'Todavía no se jugó y no fue reprogramado.'],
            ['Reprogramado', 'Tiene al menos una reprogramación registrada; muestra la fecha vigente.'],
            ['Postergado', 'No entró en fecha y hay que buscarle lugar.'],
            ['Suspendido', 'No se juega por disciplina.'],
            ['Libre', 'El partido no se juega.'],
          ] },
        ],
      },
      {
        id: 'filtros',
        title: 'Filtros',
        keywords: ['filtro', 'zona', 'jornada', 'estado'],
        blocks: [
          { kind: 'p', d: 'El calendario se puede filtrar por torneo, zona/grupo, jornada y estado. Los filtros se combinan y quedan guardados en la dirección de la página, así que podés compartir o recargar el link sin perderlos.' },
        ],
      },
      {
        id: 'acciones-calendario',
        title: 'Acciones rápidas y reprogramados',
        keywords: ['acciones', 'accesos rapidos', 'reprogramado', 'historial'],
        blocks: [
          { kind: 'p', d: 'Cada fila del calendario tiene accesos rápidos: cargar planilla, ver resultado (si ya se jugó), reprogramar y editar.' },
          { kind: 'p', d: 'Los partidos reprogramados muestran siempre la fecha, la hora y la cancha vigentes, con el motivo del último cambio y el historial completo de cambios.' },
          { kind: 'note', d: 'A los partidos ya jugados o a un torneo finalizado/archivado no se les ofrece reprogramar.' },
        ],
      },
      {
        id: 'fechas-pagina',
        title: 'La pantalla Fechas',
        keywords: ['fechas', 'grilla', 'arrastrar', 'hora', 'cancha'],
        blocks: [
          { kind: 'p', d: 'Fechas muestra una grilla fecha por fecha con la hora y la cancha de cada partido. Ahí se ajusta el agendado.' },
          { kind: 'ul', items: [
            'Arrastrá una fila y soltala sobre otra de la MISMA fecha para intercambiarles hora y cancha (funciona en computadora y celular).',
            'Guardá con el botón "Guardar fecha" cuando esté listo: nada se guarda hasta que apretás ese botón.',
            '"↻ Regenerar fecha" re-arma hora y cancha de los partidos pendientes de esa fecha, esquivando las que ya están ocupadas.',
            'El número "días a correr" mueve la fecha entera de todos los pendientes.',
            'Si quedaron partidos postergados sin lugar, aparece un bloque para agendarlos en una fecha de reposición.',
            'Debajo está el cuadro de fechas libres por equipo y la alerta de carga despareja.',
          ] },
          { kind: 'warn', d: 'El menú de Fechas muestra un número cuando hay partidos programados a los que todavía no se les definieron hora o cancha.' },
        ],
      },
    ],
  },
  {
    id: 'reprogramaciones',
    title: 'Reprogramaciones',
    icon: 'clock',
    summary: 'Cuándo se puede reprogramar un partido, qué se cambia y cómo queda registrado.',
    sections: [
      {
        id: 'cuando-reprogramar',
        title: 'Cuándo se puede reprogramar',
        keywords: ['reprogramar', 'cuando', 'restricciones'],
        blocks: [
          { kind: 'ul', items: [
            'Se puede reprogramar cualquier partido que NO se haya jugado todavía.',
            'Un partido Jugado o Walkover ya no se reprograma: su fecha y resultado son parte del historial.',
            'Si el torneo está Finalizado o Archivado, no se reprograma nada.',
            'Un partido Libre no tiene sentido reprogramarlo.',
          ] },
        ],
      },
      {
        id: 'que-se-reprograma',
        title: 'Qué se puede cambiar',
        keywords: ['reprogramar', 'fecha', 'hora', 'cancha', 'motivo'],
        blocks: [
          { kind: 'p', d: 'Desde la planilla del partido o desde el calendario, el bloque Reprogramar permite cambiar:' },
          { kind: 'ul', items: [
            'La nueva fecha del partido.',
            'La nueva hora.',
            'La nueva cancha.',
            'El motivo (obligatorio: queda registrado en el historial).',
          ] },
          { kind: 'note', d: 'Dejá en blanco lo que no cambie. El motivo es obligatorio para que quede documentado el por qué del cambio.' },
          { kind: 'p', d: 'Reprogramar no cambia los equipos, ni la jornada, ni el resultado. Solo el cuándo y el dónde.' },
        ],
      },
      {
        id: 'historial-y-publico',
        title: 'Historial y cómo lo ve el público',
        keywords: ['historial', 'publico', 'aviso', 'reprogramacion'],
        blocks: [
          { kind: 'p', d: 'Cada reprogramación queda en el historial del partido, que se ve en la propia planilla y en el calendario.' },
          { kind: 'p', d: 'En el sitio público, los partidos reprogramados se marcan con un distintivo y repiten la fecha, la hora y la cancha vigentes: es lo único que necesita saber el que tiene que ir a jugar.' },
          { kind: 'warn', d: 'Reprogramar sin motivo deja el historial vacío de explicación: si después alguien pregunta por qué se movió, no hay respuesta.' },
        ],
      },
    ],
  },
  {
    id: 'disciplina',
    title: 'Disciplina',
    icon: 'shield',
    summary: 'Suspensiones automáticas por tarjetas y sanciones manuales del tribunal.',
    sections: [
      {
        id: 'suspensiones-automaticas',
        title: 'Suspensiones automáticas',
        keywords: ['suspension', 'tarjetas', 'roja', 'amarillas', 'automatica'],
        blocks: [
          { kind: 'p', d: 'Las suspensiones automáticas se calculan solas a partir de los eventos (tarjetas) que se cargan en las planillas. No hay que cargarlas a mano.' },
          {
            kind: 'keys',
            rows: [
              ['Roja directa', 'Cada roja genera una suspensión de "Partidos de sanción por roja" (configurable en las reglas del torneo).'],
              ['Acumulación de amarillas', 'Cada vez que un jugador llega a "Amarillas para suspensión" (configurable), queda suspendido un partido y el contador vuelve a cero.'],
              ['Ventana de acumulación', 'Si está activada, las amarillas solo cuentan en las últimas N jornadas; si es 0, cuenta todo el torneo.'],
            ],
          },
          { kind: 'p', d: 'Cuando un jugador está suspendido, en la planilla de cada partido aparece marcado como 🚫 Suspendido con el motivo, y no puede recibir eventos ni ser autor de un gol en ese partido. Los partidos ya jugados cuentan como partidos de sanción cumplida.' },
        ],
      },
      {
        id: 'sanciones-manuales',
        title: 'Sanciones manuales',
        keywords: ['sancion', 'tribunal', 'manual'],
        blocks: [
          { kind: 'p', d: 'Las sanciones manuales las carga el administrador (el tribunal) y son independientes de las tarjetas. Se registran desde la pantalla Suspensiones, con el botón "Nueva sanción".' },
          { kind: 'keys', rows: [
            ['Alcance', 'A quién se le aplica: Jugador o Equipo.'],
            ['Categoría', 'Agresión · Pelea / desmanes · Conducta antideportiva · Incidente con árbitro · Incidente con otro equipo · Incumplimiento reglamentario · Otro.'],
            ['Fecha del incidente', 'Cuándo ocurrió.'],
            ['Duración', 'Por fechas (N jornadas) · Por días (contados desde el incidente) · Hasta una fecha (inclusive).'],
            ['Descripción', 'Qué pasó (visible en el sitio).'],
            ['Observaciones', 'Notas internas (no se publican).'],
          ] },
          {
            kind: 'note',
            d: 'Para sanciones a EQUIPOS se agrega la Medida, que define el efecto real: Advertencia (solo constancia) · Pérdida de puntos (resta en la tabla del torneo) · Suspensión por fechas · Suspensión por días (hasta una fecha) · Expulsión (queda inhabilitado en ese torneo). Para jugadores, la medida no aplica: la sanción siempre es la suspensión.',
          },
          { kind: 'ul', items: [
            'La fecha del incidente y la categoría son obligatorias.',
            'La duración "hasta una fecha" no puede ser anterior al incidente.',
            'Las sanciones por días y hasta fecha se cierran solas cuando pasa la fecha; las de cantidad de fechas se cierran cuando ya se jugaron las jornadas que cubrían.',
            'Las advertencias, pérdidas de puntos y expulsiones no expiran solas.',
          ] },
        ],
      },
      {
        id: 'efectos-disciplina',
        title: 'Cómo afecta la disciplina a todo lo demás',
        keywords: ['efectos', 'planilla', 'posiciones', 'disponibilidad'],
        blocks: [
          { kind: 'keys', rows: [
            ['Planilla', 'Los jugadores suspendidos aparecen marcados y no pueden recibir eventos ni ser autores de gol en ese partido.'],
            ['Disponibilidad', 'Un equipo con una sanción de expulsion o suspension queda con una advertencia visible en la planilla del partido.'],
            ['Posiciones', 'Las sanciones de EQUIPO con medida "Pérdida de puntos" se descuentan en la tabla del torneo (mismo mecanismo que Ajustes de puntos).'],
            ['Estadísticas', 'Las suspensiones automáticas no dependen de estadísticas: se calculan de los eventos.'],
          ] },
          { kind: 'p', d: 'La pantalla Suspensiones muestra, lado a lado, las suspensiones automáticas y las sanciones manuales activas, con su origen (Automática o Manual), el motivo y lo que falta. Debajo queda el historial de las cumplidas y anuladas.' },
          { kind: 'warn', d: 'Una sanción de equipo con medida "Suspensión por fechas/días" es un aviso operativo: el sistema NO le asienta automáticamente un walkover ni le baja puntos. Si querés que pierda puntos, usá la medida "Pérdida de puntos" o un Ajuste de puntos.' },
        ],
      },
      {
        id: 'anular-sancion',
        title: 'Anular una sanción',
        keywords: ['anular', 'anulacion', 'cumplida', 'error'],
        blocks: [
          { kind: 'p', d: 'Si cargaste una sanción por error, se puede anular con el botón de la fila. El sistema te pide un motivo de anulación, que es obligatorio (queda en el historial).' },
          { kind: 'note', d: 'Anular no borra: la sanción queda registrada como anulada, con su motivo. Eso es a propósito, para que quede constancia de qué se corrigió.' },
        ],
      },
    ],
  },
  {
    id: 'estadisticas',
    title: 'Estadísticas',
    icon: 'chart',
    summary: 'Tabla, goleadores, tarjetas, fair play y valla menos vencida. De dónde salen.',
    sections: [
      {
        id: 'pestanas',
        title: 'Las cuatro pestañas',
        keywords: ['estadisticas', 'pestanas', 'tabla', 'goleadores', 'fair play', 'valla'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['Tabla', 'Las posiciones del torneo, agrupadas por zona si las hay.'],
              ['Goleadores y tarjetas', 'Quiénes hicieron más goles y quiénes acumularon más tarjetas.'],
              ['Fair play', 'Tabla de menos tarjetas a más tarjetas (amarilla = 1 punto, roja = 3). Solo aparece si el torneo tiene activada la regla avanzada.'],
              ['Valla menos vencida', 'Equipos que menos goles en contra reciben (solo los que jugaron). Misma condición.'],
            ],
          },
        ],
      },
      {
        id: 'de-donde-salen',
        title: 'De dónde salen los números',
        keywords: ['origen', 'calculo', 'automatico', 'fuente'],
        blocks: [
          { kind: 'p', d: 'Las estadísticas NO se cargan: se calculan siempre a partir de los partidos y eventos guardados.' },
          {
            kind: 'keys',
            rows: [
              ['Tabla', 'De los partidos con resultado (Jugado y Walkover), aplicando puntos, desempates, ajustes de puntos y sanciones de pérdida de puntos.'],
              ['Goleadores', 'De los eventos de tipo "gol" y "en contra" con jugador asignado.'],
              ['Tarjetas', 'De los eventos de tipo "amarilla" y "roja" con jugador asignado.'],
              ['Fair play', 'De las tarjetas, pero sumadas por EQUIPO según la tabla del evento.'],
              ['Valla menos vencida', 'De los goles en contra de los partidos contados en la tabla.'],
            ],
          },
          { kind: 'p', d: 'Todo se recalcula al instante. Si modificás un resultado o un evento, las estadísticas y la tabla cambian solas en la siguiente carga de página. No hay que "actualizar" nada.' },
          { kind: 'note', d: 'Un jugador dado de baja conserva sus números: los eventos se guardan con su nombre, así que sus estadísticas no desaparecen.' },
        ],
      },
    ],
  },
  {
    id: 'administracion',
    title: 'Administración',
    icon: 'shield',
    summary: 'Ajustes de puntos y el resto del panel.',
    sections: [
      {
        id: 'ajustes-de-puntos',
        title: 'Ajustes de puntos',
        keywords: ['ajustes', 'puntos', 'descuento', 'penalizacion'],
        blocks: [
          { kind: 'p', d: 'Los ajustes de puntos suman o restan puntos a un equipo en la tabla de un torneo, con un motivo documentado. Sirven para penalizaciones o correcciones puntuales.' },
          { kind: 'ul', items: [
            'Elegí el torneo y el equipo (solo participantes del torneo).',
            'La cantidad tiene que ser un número distinto de cero y no superar los 100 puntos.',
            'El motivo es obligatorio.',
            'Queda un historial con equipo, puntos, motivo y fecha; desde ahí se puede borrar un ajuste.',
          ] },
          { kind: 'note', d: 'Los ajustes cambian los puntos (y por lo tanto el orden de la tabla), pero nunca los partidos jugados ni los goles.' },
        ],
      },
      {
        id: 'que-no-existe',
        title: 'Lo que hoy no existe (para no buscarlo)',
        keywords: ['no existe', 'pendiente', 'bandeja', 'auditoria', 'transferencias', 'historial general'],
        blocks: [
          { kind: 'p', d: 'Para evitar sorpresas, esta es la lista de cosas que el sistema NO hace todavía:' },
          {
            kind: 'ul',
            items: [
              'No hay una bandeja de pendientes que junte automáticamente los partidos sin resultado o las planillas incompletas: hay que revisarlos desde el calendario y la lista de planillas.',
              'No hay una auditoría general de TODO el sistema. El historial existe solo de partidos (la bitácora de cada planilla) y de reprogramaciones y sanciones anuladas; los equipos, jugadores y ajustes de puntos no llevan bitácora.',
              'No hay transferencias de jugadores de un equipo a otro.',
              'No hay migración de plantillas de un torneo a otro.',
            ],
          },
          {
            kind: 'note',
            d: 'Sobre el estado "Cancelado": no existe con ese nombre. Para un partido que no se va a jugar nunca se usa "Libre", y al ponerlo el sistema pide un motivo que queda anotado en la bitácora del partido.',
          },
          { kind: 'note', d: 'Si alguna vez se agregan, esta guía se actualiza en este mismo archivo.' },
        ],
      },
    ],
  },
{
    id: 'faq',
    title: 'Problemas frecuentes',
    icon: 'search',
    summary: 'Errores y validaciones, situaciones habituales y soluciones.',
    sections: [
      {
        id: 'errores-y-validaciones',
        title: 'Errores y validaciones',
        keywords: ['error', 'validacion', 'mensaje', 'no deja guardar', 'rechazado'],
        blocks: [
          {
            kind: 'p',
            d: 'Cuando el sistema rechaza algo, no lo guarda y te devuelve un mensaje arriba de la pantalla que dice qué pasó. Estos son los mensajes que existen y qué significan.',
          },
          {
            kind: 'keys',
            rows: [
              ['Estado inválido', 'El estado del partido no es uno de los válidos. En la planilla se elige de una lista, pero si llega roto el sistema lo rechaza.'],
              ['Falta elegir el estado del partido', 'No se envió el campo estado. Recargá la página y guardá de nuevo.'],
              ['La fecha no tiene el formato AAAA-MM-DD / no existe en el calendario', 'La fecha escrita no existe (por ejemplo, 31 de febrero). Revisá el día.'],
              ['La hora no tiene el formato HH:MM', 'La hora está mal (por ejemplo, 25:00 o "mediodía"). Va de 00:00 a 23:59.'],
              ['Tipo de evento inválido', 'El tipo de evento no es gol, en contra, amarilla ni roja.'],
              ['Falta elegir el tipo de evento', 'No se envió el tipo. Recargá la página.'],
              ['Elegí el equipo del partido al que pertenece el evento', 'El evento se intentó cargar con un equipo que no juega ese partido. Cargalo en el bloque del equipo correcto.'],
              ['Ese jugador no está en la plantilla del equipo', 'El jugador no pertenece al equipo indicado. Revisá de qué lado lo estás cargando.'],
              ['El minuto tiene que ser un número entero / El minuto va de 0 a 130', 'El minuto está mal. Va de 0 a 130 (90 + prórroga y descuento).'],
              ['Los puntos a mano tienen que ser un número entero de 0 a 30...', 'Los puntos manuales están fuera de rango. Dejalos vacíos para que se calculen solos, o poné un número de 0 a 30 (para un resultado de penales).'],
              ['Ese evento no pertenece a este partido', 'Se intentó borrar un evento desde la planilla de otro partido. Volvé a la planilla correcta.'],
              ['Completá las listas: falta el autor de N gol(es)', 'Declaraste más goles de los que tienen autor elegido. Elegí el autor de cada gol.'],
              ['Hay un autor inválido en las listas de goles', 'Alguna lista de autor tiene un valor raro. Volvé a elegir el autor.'],
              ['Marcá la casilla de confirmación para guardar igual', 'Bajaste el marcador de un partido con goles con autor. Marcá la casilla para confirmar que querés pisar esos autores.'],
              ['La cancha es demasiado larga / Las notas son demasiado largas', 'La cancha o las notas superan el largo máximo permitido.'],
            ],
          },
          {
            kind: 'note',
            d: 'Todos estos mensajes son de validación del sistema, no fallas: el dato NO se guardó. Cuando aparece un aviso rojo, corregí el campo y guardá de nuevo; no hace falta "deshacer" nada.',
          },
          { kind: 'p', d: 'Además, hay bloqueos propios del estado del torneo (finalizado/archivado) y de la existencia de partidos jugados. Esos no son errores de datos: son condiciones del torneo. Volvé a la sección "Los estados del torneo" de esta guía.' },
        ],
      },
      {
        id: 'situaciones-habituales',
        title: 'Situaciones habituales',
        keywords: ['que hago', 'situacion', 'problema', 'como arreglo'],
        blocks: [
          {
            kind: 'steps',
            items: [
              { t: 'Cargué mal el nombre de un equipo', d: 'Equipos → Editar el equipo → corregir el nombre → Guardar. El cambio se refleja en todo el sitio. Si el equipo ya tenía partidos, no lo borres: lo deactivated es un nombre corregido.' },
              { t: 'Cargué mal el dorsal de un jugador', d: 'Jugadores → la tarjeta tiene su propio formulario de edición: corregí el dorsal y guardá. (Dos jugadores con el mismo dorsal generan un aviso, pero se guarda igual.)' },
              { t: 'Un jugador deja de jugar', d: 'Jugadores → quitá al jugador. Si no tiene nada cargado (ni goles ni tarjetas ni entregas), se elimina; si tiene historial, se da de baja y podés reactivarlo después con ↺ Reactivar. Los números históricos se conservan.' },
              { t: 'Quiero reactivar un jugador', d: 'Jugadores → su tarjeta tiene el botón ↺ Reactivar. Vuelve a estar en la plantilla.' },
              { t: 'Necesito corregir un resultado', d: 'Resultados → abrí la planilla del partido → corregí el marcador y los autores → Guardar. Si bajás el marcador con autores cargados, te va a pedir marcar la casilla de confirmación.' },
              { t: 'El partido cambia de horario', d: 'Desde el calendario o desde la planilla del partido, usá el bloque Reprogramar: poné la nueva hora (y la fecha o cancha si cambian) con un motivo, y guardá. Queda en el historial.' },
              { t: 'El partido no se juega', d: 'En la planilla poné el estado "Libre": el partido queda exento de la tabla y los equipos no pierden puntos. Si es por disciplina, usá "Suspendido".' },
              { t: 'Necesito suspender un partido', d: 'Planilla del partido → Estado → Suspendido. No cuenta para la tabla. Para definir quién lo ganó por margen, usá Walkover (el ganador recibe el resultado de las reglas del torneo).' },
              { t: 'Un jugador queda suspendido', d: 'Si fue por tarjetas, no hay que hacer nada: el sistema lo calcula solo y lo marca en la planilla. Si querés una sanción administrativa, registrala en Suspensiones → Nueva sanción (alcance Jugador).' },
              { t: 'Debo sancionar a un equipo', d: 'Suspensiones → Nueva sanción → alcance Equipo y elegí la medida: Advertencia, Pérdida de puntos, Suspensión por fechas/días o Expulsión. Para que pierda puntos de verdad, usá "Pérdida de puntos" o un Ajuste de puntos.' },
              { t: 'Debo descontar puntos', d: 'Administración → Ajustes de puntos. Elegí equipo, cantidad (con signo negativo para restar) y motivo. Queda en el historial.' },
              { t: 'Quiero corregir la configuración', d: 'Torneos → Editar. Mientras el torneo esté en Borrador o Inscripciones se cambia todo. Con el torneo En curso solo se ajustan puntos, desempates, localía, canchas y horarios. Con resultados cargados no se cambia la estructura (formato, grupos, playoffs, participantes, zonas).' },
              { t: 'El torneo ya está En curso y necesito modificar la estructura', d: 'No se puede: la estructura se congela al empezar. Lo que sí podés es ajustar las reglas de puntuación, reprogramar partidos y cargar resultados. Si de verdad necesitás cambiar el formato, la salida es crear un torneo nuevo.' },
              { t: 'Ya hay partidos jugados y necesito regenerar', d: 'Regenerar el fixture completo está bloqueado (perderías resultados). Usá "↻ Regenerar cruce", que rearma solo los pendientes y conserva lo jugado.' },
              { t: 'Entró un equipo nuevo a mitad de torneo', d: 'Agregalo como participante desde el formulario del torneo, pero ojo: con el torneo En curso los participantes están congelados. Si el equipo entró antes de que empezara, agregalo en Inscripciones y usá "Regenerar cruce".' },
              { t: 'Me equivoqué al aprobar una entrega de delegado', d: 'Rechazala con un motivo y volvé a cargarla. Si ya la habías aprobado, corregí el resultado desde la planilla del partido.' },
            ],
          },
        ],
      },
      {
        id: 'problemas-tecnicos',
        title: 'Problemas técnicos',
        keywords: ['no funciona', 'error 500', 'pantalla en blanco', 'no carga'],
        blocks: [
          {
            kind: 'keys',
            rows: [
              ['No me deja entrar al panel', 'Revisá la contraseña del administrador. El sitio público puede abrir sin ella, pero el panel no.'],
              ['No aparece un torneo en el selector', 'Puede estar Archivado, que queda fuera del selector. Buscalo en Torneos.'],
              ['El menú tiene un número en Fechas o Entregas', 'Es un aviso, no un error: hay partidos sin hora/cancha definida, o entregas de delegados esperando revisión.'],
              ['Los números no coinciden con lo que esperaba', 'Recordá que las estadísticas y la tabla se recalculan solas de los partidos y eventos. Revisá que el estado del partido sea el correcto (Jugado/Walkover cuentan; los demás no).'],
            ],
          },
        ],
      },
    ],
  },
];
/* ============================== Ayuda contextual ============================== */

/**
 * Ayuda contextual de cada pantalla del panel. Se muestra plegada arriba del
 * contenido ("? Ayuda") y se resuelve sola desde la sección activa de la
 * pantalla, así que cada una tiene su propio texto.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'admin',
    page: '/admin',
    para: 'Resumen del torneo activo: números, tabla, próximos partidos, últimos resultados y accesos directos.',
    actions: [
      'Ver el estado general (equipos, jugadores, partidos, jornadas).',
      'Mirar la tabla y los próximos partidos desde una sola pantalla.',
      'Entrar por atajos a cargar resultados, generar fixture o cargar plantillas.',
    ],
    cautions: ['Los números corresponden al torneo que está seleccionado en la barra superior, no a todos los torneos.'],
    restrictions: ['Con un torneo Finalizado o Archivado el resumen muestra los últimos datos cargados, pero no se puede escribir nada desde acá.'],
    more: [
      { label: 'Cómo se arma el panel', href: '/admin/ayuda#como-armar-el-panel' },
      { label: 'El flujo completo', href: '/admin/ayuda#flujo-completo' },
    ],
  },
  {
    id: 'torneos',
    page: '/admin/torneos',
    para: 'Crear, editar y borrar torneos, y moverlos por sus cinco estados.',
    actions: [
      'Crear un torneo nuevo (+ Nuevo torneo).',
      'Editar un torneo: participantes, zonas, formato, reglas y calendario.',
      'Ver todos los torneos con sus estados y abrir el sitio público de cada uno.',
      'Borrar un torneo (definitivo).',
    ],
    cautions: ['Borrar un torneo borra también sus partidos, eventos y entregas. Si solo querés dejar de usarlo, finalizalo o archivalo.'],
    restrictions: ['Con el torneo En curso no se pueden agregar ni sacar participantes ni cambiar la estructura.'],
    more: [
      { label: 'Los estados del torneo', href: '/admin/ayuda#estados-del-torneo' },
      { label: 'Qué se puede tocar en cada estado', href: '/admin/ayuda#que-se-puede-tocar' },
    ],
  },
  {
    id: 'fixture',
    page: '/admin/fixture',
    para: 'Generar el fixture (y las llaves de playoffs), ver los cruces y administrar los partidos sueltos.',
    actions: [
      'Preparar una vista previa del fixture y confirmarla.',
      'Regenerar el cruce (solo pendientes) sin perder lo jugado.',
      'Generar o regenerar las llaves de playoffs.',
      'Agregar, editar o eliminar partidos sueltos.',
      'Ver la grilla completa con zonas, fechas y estados.',
    ],
    cautions: [
      'Confirmar un fixture nuevo borra el anterior (por eso hay una confirmación).',
      'Regenerar el cruce descarta las entregas de delegados de los partidos pendientes que reemplaza.',
    ],
    restrictions: [
      'Con partidos jugados, o con el torneo En curso / Finalizado / Archivado, no se puede generar el fixture completo.',
      'Las llaves solo se generan cuando la fase previa terminó y no hay resultados cargados.',
    ],
    more: [
      { label: 'Generar el fixture', href: '/admin/ayuda#generar-fixture' },
      { label: 'Protecciones al generar', href: '/admin/ayuda#protecciones-fixture' },
    ],
  },
  {
    id: 'fechas',
    page: '/admin/fechas',
    para: 'Día, hora y cancha de cada fecha del torneo, en una grilla que se reordena arrastrando.',
    actions: [
      'Intercambiar hora y cancha entre partidos de la misma fecha arrastrando filas.',
      'Regenerar la hora y la cancha de una fecha para esquivar lo ya ocupado.',
      'Mover una fecha entera (días a correr).',
      'Agendar los partidos postergados que quedaron sin lugar.',
      'Ver el cuadro de fechas libres por equipo y la alerta de carga despareja.',
    ],
    cautions: ['Nada se guarda hasta que apretás "Guardar fecha".', '"Regenerar fecha" pisa la hora y la cancha de los pendientes de esa fecha.'],
    restrictions: ['Un torneo Finalizado o Archivado no permite cambios de fechas.'],
    more: [
      { label: 'La pantalla Fechas', href: '/admin/ayuda#fechas-pagina' },
      { label: 'Reprogramaciones', href: '/admin/ayuda#que-se-reprograma' },
    ],
  },
  {
    id: 'calendario',
    page: '/admin/calendario',
    para: 'La vista operativa del torneo: qué está jugado, qué falta y qué se reprogramó, fecha por fecha.',
    actions: [
      'Filtrar por torneo, zona/grupo, jornada y estado.',
      'Ver los partidos reprogramados con su fecha vigente y su historial.',
      'Cargar planilla, ver resultado, reprogramar o editar desde cada fila.',
    ],
    cautions: ['El filtro queda guardado en la dirección de la página: se puede compartir el link tal cual.'],
    restrictions: ['A los partidos jugados y a los torneos finalizados no se les ofrece reprogramar.'],
    more: [
      { label: 'Qué muestra el calendario', href: '/admin/ayuda#que-muestra' },
      { label: 'Filtros', href: '/admin/ayuda#filtros' },
    ],
  },
  {
    id: 'planilla',
    page: '/admin/planilla',
    para: 'Cargar el resultado, los autores de gol y los eventos (tarjetas) de cada partido.',
    actions: [
      'Elegir el torneo y abrir la planilla de un partido.',
      'Poner el estado del partido y el marcador.',
      'Elegir el autor de cada gol (jugador, en contra o sin autor).',
      'Agregar y borrar eventos con su minuto.',
      'Cargar notas del partido y, si hace falta, puntos manuales.',
      'Reprogramar el partido y ver su historial de cambios.',
    ],
    cautions: [
      'Guardar reemplaza los autores de gol del partido: no se suman ni se duplican.',
      'Bajar el marcador de un partido con autores cargados borra esos autores: hay que marcar una casilla para confirmar.',
    ],
    restrictions: ['Un torneo Finalizado o Archivado no permite tocar resultados ni eventos.'],
    more: [
      { label: 'Cargar el resultado y los autores de gol', href: '/admin/ayuda#cargar-resultado' },
      { label: 'Errores y validaciones', href: '/admin/ayuda#errores-y-validaciones' },
    ],
  },
  {
    id: 'entregas',
    page: '/admin/entregas',
    para: 'Revisar las entregas de resultado que mandaron los delegados y publicarlas o descartarlas.',
    actions: [
      'Ver cada entrega pendiente y compararla con el resultado oficial.',
      'Aprobarla aplicando el resultado, los eventos, o ambos.',
      'Rechazarla con un motivo para que el delegado la vuelva a mandar.',
    ],
    cautions: ['Aprobar con "aplicar eventos" reemplaza los eventos de ese equipo en el partido.'],
    restrictions: ['Solo se puede aprobar o rechazar una entrega que esté pendiente.'],
    more: [
      { label: 'Entregas de resultados', href: '/admin/ayuda#entregas' },
      { label: 'Delegados', href: '/admin/ayuda#habilitar-delegado' },
    ],
  },
  {
    id: 'equipos',
    page: '/admin/equipos',
    para: 'Alta, edición, activación y borrado de los equipos de la liga.',
    actions: [
      'Crear un equipo (nombre, abreviatura, color, escudo).',
      'Editar los datos o activar/desactivar un equipo.',
      'Ver de un vistazo cuántos jugadores, partidos y torneos tiene cada equipo.',
      'Abrir la plantilla del equipo o su acceso de delegado.',
      'Borrar un equipo (solo si no tiene partidos).',
    ],
    cautions: ['Un dorsal o un escudo mal cargado se rechaza con un mensaje; nada se guarda.'],
    restrictions: ['No se puede borrar un equipo que tiene partidos: la salida es desactivarlo.'],
    more: [
      { label: 'Crear y editar un equipo', href: '/admin/ayuda#crear-equipo' },
      { label: 'Equipo global y participación', href: '/admin/ayuda#equipo-torneo' },
    ],
  },
  {
    id: 'jugadores',
    page: '/admin/jugadores',
    para: 'Cargar y mantener las plantillas: nombre, dorsal y posición de cada jugador.',
    actions: [
      'Alta de jugadores en la plantilla de un equipo.',
      'Editar nombre, dorsal y posición sin borrar y recrear.',
      'Filtrar por equipo, texto, estado y posición.',
      'Quitar un jugador (se elimina o se da de baja, según su historial) y reactivarlo.',
    ],
    cautions: ['Un jugador con historial (goles, tarjetas, entregas) nunca se borra: se da de baja y sus números se conservan.'],
    restrictions: ['No hay transferencias de jugadores entre equipos.'],
    more: [
      { label: 'Baja, borrado y reactivación', href: '/admin/ayuda#baja-y-reactivacion' },
    ],
  },
  {
    id: 'delegados',
    page: '/admin/delegados',
    para: 'Habilitar el acceso de los delegados y ver las entregas pendientes de cada equipo.',
    actions: [
      'Habilitar un delegado por equipo (genera su código).',
      'Generar un código nuevo (invalida el anterior).',
      'Revocar el acceso de un equipo.',
      'Ver cuántas entregas pendientes tiene cada equipo.',
    ],
    cautions: ['El código es la contraseña del delegado: no lo compartas públicamente. Regenerarlo deja afuera al que tenía el anterior.'],
    restrictions: ['Cada equipo tiene su propio código, independiente del password del panel.'],
    more: [
      { label: 'Habilitar un delegado', href: '/admin/ayuda#habilitar-delegado' },
      { label: 'Entregas de resultados', href: '/admin/ayuda#entregas' },
    ],
  },
  {
    id: 'estadisticas',
    page: '/admin/estadisticas',
    para: 'Tabla de posiciones, goleadores, tarjetas, fair play y valla menos vencida del torneo.',
    actions: ['Ver la tabla (por zona si las hay).', 'Ver goleadores y tarjetas.', 'Ver fair play y valla menos vencida.'],
    cautions: ['Todo se calcula de los partidos y eventos cargados: no se carga a mano. Si un número no cierra, revisá el estado del partido.'],
    restrictions: ['Fair play y valla solo aparecen si el torneo tiene activada la regla avanzada.'],
    more: [
      { label: 'De dónde salen los números', href: '/admin/ayuda#de-donde-salen' },
    ],
  },
  {
    id: 'ajustes',
    page: '/admin/ajustes',
    para: 'Sumar o restar puntos a un equipo en la tabla, con un motivo documentado.',
    actions: ['Aplicar un ajuste de puntos a un equipo del torneo.', 'Ver el historial de ajustes y borrar uno mal cargado.'],
    cautions: ['El motivo es obligatorio y queda en el historial. El ajuste cambia el orden de la tabla, pero no los partidos ni los goles.'],
    restrictions: ['Solo se puede ajustar a un equipo que participa del torneo.'],
    more: [
      { label: 'Ajustes de puntos', href: '/admin/ayuda#ajustes-de-puntos' },
    ],
  },
  {
    id: 'suspensiones',
    page: '/admin/suspensiones',
    para: 'Ver las suspensiones automáticas y registrar o anular las sanciones manuales (el tribunal).',
    actions: [
      'Ver las suspensiones automáticas (por roja y por acumulación de amarillas) y las manuales, con su motivo.',
      'Registrar una sanción manual a un jugador o a un equipo.',
      'Anular una sanción con un motivo.',
      'Ver el historial de las sanciones cumplidas y anuladas.',
    ],
    cautions: ['Las sanciones de equipo con "Suspensión por fechas/días" son un aviso: no le bajan puntos ni le asientan un walkover solos.'],
    restrictions: ['Las suspensiones automáticas se calculan solas y no se editan a mano.'],
    more: [
      { label: 'Suspensiones automáticas', href: '/admin/ayuda#suspensiones-automaticas' },
      { label: 'Sanciones manuales', href: '/admin/ayuda#sanciones-manuales' },
    ],
  },
  {
    id: 'ayuda',
    page: '/admin/ayuda',
    para: 'Esta guía. Todo el contenido vive en un solo archivo del sistema, así que se mantiene en un solo lugar.',
    actions: ['Buscar por palabra.', 'Seguir el índice por categorías.', 'Ir a la ayuda puntual de cada pantalla con el botón "? Ayuda" de arriba.'],
    cautions: [],
    restrictions: [],
    more: [],
  },
];

/* ============================== Consultas ============================== */

/** Categoría por id, o null si no existe. */
export function helpCategory(id: string): HelpCategory | null {
  return HELP_CATEGORIES.find((c) => c.id === id) ?? null;
}

/** Sección por id (busca en todas las categorías), con su categoría. */
export function helpSection(id: string): { category: HelpCategory; section: HelpSection } | null {
  for (const category of HELP_CATEGORIES) {
    const section = category.sections.find((s) => s.id === id);
    if (section) return { category, section };
  }
  return null;
}

/** Ayuda contextual por id de sección de pantalla. */
export function helpTopic(id: string): HelpTopic | null {
  return HELP_TOPICS.find((t) => t.id === id) ?? null;
}

/** Normaliza para buscar: minúsculas y sin acentos. */
export function normalizeHelp(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Texto plano de un bloque (para búsqueda y para el índice). */
export function blockText(b: HelpBlock): string {
  switch (b.kind) {
    case 'p':
    case 'warn':
    case 'note':
      return `${'t' in b && b.t ? b.t + '. ' : ''}${b.d}`;
    case 'ul':
    case 'ol':
      return b.items.join('. ');
    case 'steps':
      return b.items.map((i) => `${i.t}. ${i.d}`).join(' ');
    case 'keys':
      return b.rows.map(([k, v]) => `${k}: ${v}`).join('. ');
    case 'links':
      return b.items.map((i) => i.label).join('. ');
  }
}

/** Texto plano de una sección, para la búsqueda. */
export function sectionText(s: HelpSection): string {
  return [s.title, ...s.blocks.map(blockText), ...(s.keywords ?? [])].join(' ');
}

/** Texto plano de una categoría, para la búsqueda. */
export function categoryText(c: HelpCategory): string {
  return [c.title, c.summary, ...c.sections.map(sectionText)].join(' ');
}

export interface HelpHit {
  categoryId: string;
  categoryTitle: string;
  sectionId: string;
  sectionTitle: string;
  /** Resumen corto con el texto alrededor de la primera coincidencia. */
  snippet: string;
  /** Cuántos términos de la búsqueda encontró la sección. */
  score: number;
}

const SNIPPET_LEN = 150;

/**
 * Recorta un fragmento alrededor de `pos` sin cortar palabras: si arranca en
 * medio de una, avanza hasta el espacio siguiente; si termina en medio de
 * una, retrocede hasta el espacio anterior.
 */
export function helpSnippet(plain: string, pos: number, len = SNIPPET_LEN): string {
  let start = Math.max(0, pos - 40);
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    start = sp === -1 ? 0 : sp + 1;
  }
  let end = Math.min(plain.length, start + len);
  if (end < plain.length) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp > start) end = sp;
  }
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '');
}

/**
 * Busca en toda la guía. Todos los términos tienen que aparecer (AND), así
 * que "partido goleador" no trae todo lo que dice "goleador".
 */
export function searchHelp(query: string, limit = 20): HelpHit[] {
  const terms = normalizeHelp(query).split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  const hits: HelpHit[] = [];
  for (const category of HELP_CATEGORIES) {
    for (const section of category.sections) {
      const hay = normalizeHelp(sectionText(section));
      let score = 0;
      if (!terms.every((t) => hay.includes(t))) continue;
      for (const t of terms) {
        const n = hay.split(t).length - 1;
        score += n > 0 ? 1 + Math.min(n, 4) : 0;
      }
      const pos = hay.indexOf(terms[0]!);
      const snippet = helpSnippet(sectionText(section), pos);
      hits.push({
        categoryId: category.id,
        categoryTitle: category.title,
        sectionId: section.id,
        sectionTitle: section.title,
        snippet,
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.sectionTitle.localeCompare(b.sectionTitle));
  return hits.slice(0, limit);
}

/** Todas las secciones, en orden de categorías (para el índice). */
export function allHelpSections(): { category: HelpCategory; section: HelpSection }[] {
  const out: { category: HelpCategory; section: HelpSection }[] = [];
  for (const category of HELP_CATEGORIES) {
    for (const section of category.sections) out.push({ category, section });
  }
  return out;
}