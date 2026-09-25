# CHANGELOG — ZonaLiga

> **Fuente única de verdad**: este archivo es el único lugar donde se registran
> los cambios. La página `/changelog` lo lee directo (vía `src/changelog.ts`,
> que lo parsea) y el pie de pantalla muestra la versión de la primera entrada.
> Al agregar una versión nueva: sumar la entrada acá (más nueva arriba) y subir
> la versión en `package.json`.
>
> Categorías: **Nuevo** (funcionalidad que no existía) · **Mejora** (algo existente
> queda mejor) · **Arreglo** (corrección de un error). Se escriben como
> subtítulos `### Nuevo` / `### Mejora` / `### Arreglo` dentro de cada versión.
>
> Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
> versionado SemVer (`MAJOR.MINOR.PATCH`).

---

## [0.2.27] — 2026-09-25 — Compartir posiciones y reposición con destino elegido

### Nuevo
- La página de posiciones tiene su botón "📲 Compartir tabla": manda por WhatsApp el top 3 de cada zona (o el top 5 general si no hay zonas) con el link.
- En el panel, el formulario de reposición permite elegir dónde agendar los postergados: reciclarlos en una fecha existente (preseleccionada la sugerida ⭐) o crear la fecha nueva al final. Si no entran todos en los slots libres de esa fecha, los que sobran quedan con día pero sin cancha y hora, para asignarlos a mano.

### Mejora
- El cuadro de fechas libres del panel avisa cuando la carga queda despareja: marca con una alerta a los equipos con dos o más fechas libres más que el que menos tiene.

---

## [0.2.26] — 2026-09-25 — Compartir fecha por WhatsApp y cuadro de libres afinado

### Nuevo
- El fixture público tiene botón "📲 Compartir": abre WhatsApp con la lista de partidos de la fecha que estás viendo y su link directo (`/fixture?f=N`), listo para mandar al grupo. Funciona también sin JavaScript (comparte la fecha por defecto).
- En el panel de fixture, el cuadro de fechas libres sugiere con un ⭐ qué fecha conviene para reciclar los partidos postergados: la de más equipos libres que todavía tiene pendientes.

### Mejora
- En el cuadro de fechas libres del panel, las fechas de cruce entre zonas van en columnas aparte (C) y aclaradas: solo juegan los emparejados, el resto libra por diseño, así que ya no confunden la lectura del desequilibrio.

---

## [0.2.25] — 2026-09-25 — Fecha compartible por link y fechas libres en el panel

### Nuevo
- El fixture recuerda la fecha en la dirección: al navegar por fechas el link cambia a `/fixture?f=3` y se puede compartir — quien lo abre ve directamente esa fecha.
- En el panel de fixture, cuadro de fechas libres por equipo: muestra en qué fechas cada equipo no tiene partido (por postergados o impar), ordenado por más fechas libres, con el total de libres por fecha para elegir dónde agendar la reposición.

---

## [0.2.24] — 2026-09-24 — Navegación de fechas y home reacomodada

### Nuevo
- El fixture se navega por fecha: flechas ‹ ›, salto directo a cualquier fecha y botón "Ver todas". Arranca en la primera fecha con partidos pendientes; con JavaScript desactivado se ven todas (como antes).

### Mejora
- En la portada, Torneos y Próxima fecha comparten la misma fila en escritorio: se elimina el hueco vacío al lado de la tarjeta de torneo. En celular se apilan como antes.
- En celular, la portada y el bloque "¿Cómo funciona?" ocupan menos altura (buscador y pasos más compactos): la home móvil baja unos 600px.

## [0.2.23] — 2026-09-24 — Sitio público más compacto

### Mejora
- Inspección visual del sitio público: menos aire entre secciones, títulos de sección pegados al contenido, tarjetas y tablas un punto más livianas, portada del inicio más baja y footer compacto en dos filas (de ~370px pasa a ocupar menos de la mitad). Tipografía base un punto más chica (14px). El panel admin hereda la compacción para verse consistente.
- Tabla de posiciones con densidad de diario deportivo: filas bajas con franjas alternadas, números grises salvo los puntos (destacados) y escudos más bajos.

## [0.2.22] — 2026-09-24 — Postergados mitad y mitad por zona

### Mejora
- Los partidos postergados de cada fecha se reparten ahora mitad y mitad entre las zonas (con tu caso: 1 de la Zona A y 1 de la Zona B). Cuando el excedente es impar, el partido extra rota de zona en cada fecha para que ninguna acumule. Dentro de cada zona, sigue eligiendo al azar entre los equipos que menos veces postergaron.

---

## [0.2.21] — 2026-09-24 — Turnos mezclados entre zonas

### Mejora
- Al generar el fixture por zonas, los partidos de cada fecha se mezclan al azar antes de asignar canchas y horarios: los primeros turnos (10:00, 11:00…) ya no son siempre de la misma zona, ahora las dos zonas comparten todos los horarios de la fecha.

---

## [0.2.20] — 2026-09-24 — Reparto equilibrado de postergados

### Mejora
- Quiénes quedan postergados ya no depende del orden del fixture (antes caían siempre en la misma zona): la generación cuenta cuántas veces postergó cada equipo y elige al azar entre los que menos esperaron. Zonas y equipos quedan parejos, y ninguna zona acumula todas las postergaciones.

---

## [0.2.19] — 2026-09-24 — Partidos postergados y fecha de reposición

### Nuevo
- Si los partidos de una fecha superan las canchas × horarios del torneo, el excedente queda **postergado** (sin cancha, sin día) en vez de duplicar reservas: esos equipos libran la fecha hasta que se jueguen.
- Botón **“Agendar fecha de reposición”**: junta TODOS los postergados al final del fixture, en bloques del tamaño de la capacidad (si no alcanzan los slots, se crean varias fechas de reposición seguidas, cada una con su día del calendario).
- La página del fixture muestra el plan sugerido (“Fecha 16: 8 partidos · Fecha 17: 6 partidos…”), cuántos equipos tienen fechas libres, y la alternativa de reprogramar a mano desde Días, horas y canchas.
- Cada fecha del fixture muestra un contador “N postergado(s)” junto al título.

### Mejora
- Generar el fixture ya nunca crea dobles reservas de cancha y horario: si no alcanzan los slots, posterga.

---

## [0.2.18] — 2026-09-24 — Playoff opcional al terminar las fechas

### Nuevo
- Nuevo bloque “Playoff (llave opcional entre zonas)” en el fixture del panel: se habilita recién cuando todas las fechas de zona están jugadas (te dice cuántas faltan) y lo generás con un toque.
- Tres formatos para elegir: final única (1ºA vs 1ºB), semifinales + final, o semifinales + final + 3er puesto.
- La llave avanza sola: cuando se carga el resultado de una semifinal, la final se completa con el ganador (y el 3er puesto con los perdedores). Si la semifinal termina empatada, se define por penales cargando los puntos en la planilla y la llave sigue sola.
- El sitio público muestra la llave en la sección Llaves / Playoffs, y en el historial el campeón es el ganador de la final (no el primero de la tabla).

### Mejora
- Los partidos de llave no cuentan para la tabla de posiciones y “Regenerar cruce” nunca los borra.

---

## [0.2.17] — 2026-09-24 — Fecha especial de cruce entre zonas

### Nuevo
- Nueva fecha especial de cruce entre zonas: los equipos de una zona se enfrentan a los de la otra según la tabla del momento, con tres reglas para elegir — Espejo (1ºA vs 1ºB, 2ºA vs 2ºB…), Invertido (1ºA vs último B…) y Cruzado (1ºA vs 2ºB, 2ºA vs 1ºB…).
- Antes de generar, la página muestra cómo quedarían los cruces con cada regla usando la tabla de hoy; si una zona tiene más equipos, los que sobran libran y se avisa.
- Al crear la fecha elegís si los puntos de los cruces cuentan para la tabla de cada zona o si es una fecha festiva que no mueve la tabla (los goles igual suman a los goleadores).

### Mejora
- El fixture marca la fecha con la etiqueta “Cruce entre zonas” en el panel y en el sitio público. Regenerar cruces a mitad de torneo nunca toca esas fechas.

---

## [0.2.16] — 2026-09-23 — Zonas manuales con canchas compartidas

### Nuevo
- En el torneo podés activar la división en zonas: les ponés nombre (A, B, Norte, Sur…) y asignás cada equipo a su zona desde la configuración.
- Al generar el fixture, cada zona arma su calendario interno (los cruces nunca salen de la zona) y las canchas se comparten entre zonas: los partidos de la fecha se intercalan en la misma lista de canchas y horarios (10:00 A, 10:00 B, 11:00 A…).
- La tabla de posiciones se muestra agrupada por zona automáticamente.

### Mejora
- La validación avisa si falta asignar zona a un equipo, si hay un equipo en dos zonas o si las zonas quedaron desbalanceadas.
- Regenerar cruces a mitad de torneo respeta las zonas: los partidos pendientes se rearman solo entre equipos de la misma zona y comparten las canchas del día sin duplicar horario.

---

## [0.2.15] — 2026-09-23 — Panel de administración plano y compacto

### Mejora
- El panel hereda el nuevo look flat con densidad extra: títulos de página más contenidos, formularios con campos más bajos y etiquetas más chicas.
- Los botones repetidos por fila (Cargar planilla) pasaron al verde suave: el verde fuerte queda reservado para la acción principal de cada página.
- En celular, la bandeja de planillas muestra Partido y acción sin columnas de más: nada se corta ni desborda.

---

## [0.2.14] — 2026-09-23 — Tipografía Inter

### Mejora
- La tipografía Inter se carga desde CDN (con font-display swap): el sitio se ve igual en cualquier dispositivo, sin depender de las fuentes instaladas. Mientras llega, se muestra la del sistema — sin pantalla en blanco.

---

## [0.2.13] — 2026-09-23 — Diseño flat y compacto (estilo apps de resultados)

### Mejora
- Nuevo look flat: se fueron degradados, sombras y bordes redondeados de más. Todo queda con bordes de 1px, colores planos y radios chicos — como FotMob o SofaScore.
- Todo más denso: filas de tabla más bajas, header de 52px, tarjetas y formularios con menos aire. En celular la tabla de posiciones muestra #, Equipo, PJ, DIF, PTS y FP sin scroll horizontal (las demás columnas aparecen en desktop).
- Números tabulares: las columnas de la tabla quedan alineadas en vertical. Escudos y botones más chicos y planos.

---

## [0.2.12] — 2026-09-23 — Planilla: los goles se declaran junto al marcador

### Mejora
- Goles local/visitante volvieron al form de la planilla y, al declararlos, se despliegan las listas para elegir el autor de cada gol: jugador de la plantilla, “En contra” o “Sin autor”. Se carga una sola vez — guardar reemplaza la declaración, nunca duplica.

### Arreglo
- Las listas de autores viven dentro del form principal: marcador y goleadores se guardan juntos. Las listas quedan prellenadas con lo ya cargado y, si un equipo no tiene plantilla, sus goles quedan “Sin autor” (salvo los “En contra”). El apartado de tarjetas queda solo para eventos sueltos.
- Los “En contra” se registran a nombre del equipo cuyo arco recibió el gol — el rival —, como en la planilla de papel.

---

## [0.2.11] — 2026-09-23 — Planilla: listas por gol y marcador sin dobles cargas

### Mejora
- La carga rápida ahora muestra una lista desplegable por gol: elegís al autor (o “En contra”) — sin tildes ni escritura. La cantidad abre y cierra las listas.

### Arreglo
- Se sacaron los casilleros “Goles local/visitante” de la planilla: el marcador se muestra y se arma solo desde los goles cargados, así nunca difiere de los eventos. El walkover conserva su carga especial.
- Las listas de goles del segundo equipo (visitante) no desplegaban al elegir la cantidad: ya funciona en los dos lados.

---

## [0.2.10] — 2026-09-23 — Marcador automático al cargar goles

### Mejora
- Al usar la carga rápida de goles, el marcador del partido se actualiza solo (cuenta los goles y también los en contra).

---

## [0.2.9] — 2026-09-23 — Carga rápida de goles en la planilla

### Nuevo
- En la planilla de cada partido hay una carga rápida: elegís cuántos goles hizo el equipo (1 a 4, o “Más de 4”) y tildás a los goleadores en la plantilla — sin escribir uno por uno.

### Mejora
- La app controla que la cantidad de goles coincida con los goleadores tildados y que todos sean del equipo, y ahora muestra los avisos de éxito y de error de la planilla (antes no se veían).

---

## [0.2.8] — 2026-09-23 — Fair play y valla menos vencida

### Nuevo
- Posiciones muestra una columna FP (fair play) calculada desde las tarjetas: amarilla 1 punto, roja 3 — gana el equipo que menos tiene.
- Debajo de la tabla aparecen los líderes de Valla menos vencida (menos goles en contra) y Fair Play.

### Mejora
- Se puede encender o apagar desde las Reglas del torneo ("Fair play y valla menos vencida").

---

## [0.2.7] — 2026-09-23 — El fixture no se pisa con resultados cargados

### Mejora
- Si el torneo ya tiene partidos jugados (o está finalizado), el botón “Generar” de Fixture queda deshabilitado y la app explica por qué: así nunca se borran resultados sin querer.
- Para rearmar los cruces de un torneo empezado sigue estando “Regenerar cruce”, que conserva todo lo jugado.

---

## [0.2.6] — 2026-09-23 — Hora y cancha desde la configuración del torneo

### Nuevo
- En Fechas, la hora y la cancha de cada partido ahora se eligen con listas desplegables que toman los datos cargados en la configuración del torneo.

### Mejora
- Al regenerar una fecha, la app verifica que la cancha y el horario no se dupliquen con otro partido del mismo día: evita lo ocupado y, si no alcanzan las canchas, lo avisa con detalle.

---

## [0.2.5] — 2026-09-23 — Regenerar cruces a mitad de torneo

### Nuevo
- Botón “Regenerar cruce”: rearma los partidos pendientes cuando entra un equipo nuevo o cambió un participante, sin tocar lo jugado.
- Al regenerar se verifica todo el fixture: si algún partido nuevo chocara con uno ya jugado (cruce repetido, equipo en dos partidos de la fecha o cancha doble), se avisa en detalle.

---

## [0.2.4] — 2026-09-23 — Día de juego

### Nuevo
- Elegí el día de juego del torneo (ej.: sábado): todas las fechas del calendario caen en ese día.

---

## [0.2.3] — 2026-09-23 — Aviso de slots en el fixture

### Nuevo
- El fixture avisa si alguna fecha tiene más partidos que canchas y horarios, y te dice cuántos slots faltan.

---

## [0.2.2] — 2026-09-23 — Calendario automático

### Nuevo
- Cargá la fecha de inicio del torneo (y los días entre fechas): el fixture nace con el día de cada jornada calculado.

### Mejora
- En Fechas, los partidos sin día muestran su fecha planificada; al guardar, queda registrada.

---

## [0.2.1] — 2026-09-23 — Regenerar una fecha

### Nuevo
- Botón “Regenerar fecha” en Días, horas y canchas: re-slotea hora y cancha de un solo día con el patrón del torneo.
- Si el inicio se retrasa, con un número podés correr todos los partidos pendientes de ese día (+ o − días) sin tocar el resto.

---

## [0.2.0] — 2026-09-23 — Canchas, horarios y ajustes de puntos

### Nuevo
- Configurá las canchas y horarios del torneo: el fixture se arma con ellos ya cargados.
- Ajustes manuales de puntos: penalizaciones o correcciones, con motivo documentado y a la vista en posiciones.

### Mejora
- El historial de torneos aclara si el campeón tuvo ajustes de puntos.

---

## [0.1.0] — 2026-09-23 — Primera versión pública

### Nuevo
- Podés ver el sitio con fixture, posiciones, goleadores, equipos e historial de torneos.
- Nueva página "En vivo": los partidos de hoy se actualizan solos, sin recargar.
- Los delegados de cada equipo pueden cargar el resultado desde el celular y el administrador lo aprueba.
- Se pueden compartir la tabla, la fecha y los resultados por WhatsApp con un toque.
- Esta página de novedades, con un acceso chiquito al pie de cada pantalla.

### Mejora
- Tema claro u oscuro: elegilo en el botón de arriba o dejalo en automático.
- La app se puede instalar en el celular como si fuera una aplicación (PWA).
- Buscador único para encontrar equipos, jugadores y torneos al instante.

---

## Notas internas

- **Fuente única**: este archivo es la única fuente del changelog. `src/changelog.ts`
  lo lee con `import ... from '../CHANGELOG.md'` y lo parsea (`parseChangelog`).
- **Cómo se empaqueta**: en producción, wrangler sube el `.md` como módulo de texto
  gracias a la regla `[[rules]] type = "Text"` de `wrangler.toml`; en los tests,
  `vitest.config.ts` define el plugin `markdown-loader` que hace lo mismo.
- **Reglas de formato que entiende el parser**: cada versión es un encabezado
  `## [x.y.z] — AAAA-MM-DD — Título` (admite `—` o `-` como separadores); las
  categorías son subtítulos `### Nuevo`, `### Mejora`, `### Arreglo`; los cambios,
  viñetas `- texto`. Cualquier otra sección (como esta) se ignora sin romper nada
  (hay un test que lo valida).
- **Al publicar una versión**: sumar la entrada acá + subir `version` en
  `package.json`. Los testsvalidan que la primera entrada coincida con la versión
  y que el parseo cubra todas las entradas del archivo.
- **Verificación por cambio**: cada versión de este changelog pasó
  `npm run typecheck` + `npm test` (+ `npm run test:e2e` cuando toca rutas o sesiones).
- **Stack**: Cloudflare Workers + D1 + Hono, TypeScript estricto. Estructura:
  `src/lib` (dominio), `src/routes` (HTTP), `src/ui` (vistas), `migrations` (base).
