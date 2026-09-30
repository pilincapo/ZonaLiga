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

## [0.2.80] — 2026-09-30 — Cierre automático de sanciones cumplidas (Fase 8)

### Nuevo

- Las sanciones con suspension por días pasan solas a "Cumplida" cuando la fecha actual supera la fecha de finalización.
- Las sanciones con suspension por fechas pasan solas a "Cumplida" cuando ya se jugaron todas las fechas que cubrían (requiere poder ubicar la jornada del incidente; sin ese dato no se cierra, no se inventa).
- El cierre corre al consultar Suspensiones y al evaluar elegibilidad en la planilla: idempotente, sin procesos extra, y el historial conserva todo.

### Importante

- Advertencias, pérdidas de puntos y expulsiones no se cierran solas (no expiran): la expulsión solo se levanta anulando. Anuladas e historial intactos.

---

## [0.2.79] — 2026-09-30 — Sanciones disciplinarias a equipos (Fase 7B)

### Nuevo

- Medidas disciplinarias para equipos en el tribunal: advertencia, pérdida de puntos, suspensión por fechas, suspensión por días y expulsión del torneo.
- La pérdida de puntos resta puntos reales en las tablas de posiciones (panel y sitio público), con la categoría de la sanción como motivo visible.
- La expulsión marca al equipo como inhabilitado en la tabla del torneo; la anulación (con motivo) revierte la marca y la deja documentada en el historial.
- Las suspensiones de equipo y las advertencias se ven como avisos en la planilla del administrador y en el panel del delegado, sin suspender jugadores individuales.

### Mejora

- El formulario de nueva sanción muestra campos distintos según la medida elegida: puntos a restar, cantidad de fechas o fecha de finalización.

---

## [0.2.78] — 2026-09-30 — Elegibilidad por suspensiones (Fases 1–6)

### Nuevo

- Sanciones disciplinarias manuales: el tribunal de la liga registra sanciones a un jugador o a un equipo, con duración por fechas, por días o hasta una fecha, categoría, descripción y observaciones.
- Lectura unificada de disciplina: en una sola vista se ven las suspensiones automáticas por tarjetas junto a las sanciones del tribunal, sin fusionarse — cada sanción mantiene su origen (Automática o Manual).
- Nueva pantalla Administración → Suspensiones, con métricas, listado combinado, historial de cumplidas y anuladas, y formulario de alta.
- Alta de sanciones y anulación con motivo obligatorio; la anulación conserva el registro y queda documentada en el historial.
- Elegibilidad por partido: para cada partido se evalúa si cada jugador está suspendido, considerando la jornada y la fecha reales del encuentro. Las sanciones anuladas o cumplidas no bloquean y las de otro torneo no aplican; si falta algún dato, se muestra “revisar” sin inventar fechas restantes.
- Bloqueo de eventos de jugadores suspendidos en la planilla del administrador y en la carga del delegado: el jugador queda visible y marcado con “🚫 Suspendido” (con motivo, origen y fechas restantes cuando se puedan calcular), y si se intenta cargarle un evento, el sistema rechaza el guardado explicando el motivo.
- Sanciones a equipo: aparecen como aviso de disciplina del equipo en las pantallas de carga, sin convertir automáticamente a sus jugadores en suspendidos.

### Mejora

- Los tests e2e contra el servidor de desarrollo usan un tiempo máximo de 30 segundos por prueba, para eliminar los fallos espurios que a veces aparecían por tiempos de arranque del servidor.

---

## [0.2.77] — 2026-09-29 — Sanciones disciplinarias del tribunal

### Nuevo

- El panel de Suspensiones combina las suspensiones automáticas por tarjetas con las sanciones disciplinarias que registra el tribunal: alta de sanciones a jugador o equipo, con duración por fechas, por días o hasta una fecha, categoría, descripción y observaciones.
- Historial de sanciones cumplidas y anuladas; la anulación pide motivo obligatorio y conserva el registro.
- Cada sanción muestra su origen (automática o manual) y las fechas o días restantes cuando se pueden calcular.

---

## [0.2.76] — 2026-09-29 — Participación de equipos por torneo

### Nuevo

- El formulario del torneo permite elegir qué equipos participan, con una casilla por equipo, y la zona se elige en la misma fila (apagada si el equipo no participa).
- Los equipos participantes quedan guardados por torneo: al armar el fixture, cada torneo usa solo sus equipos.
- Un torneo viejo sin equipos marcados sigue funcionando como hasta ahora (usa todos los activos), para no cambiar nada de lo que ya operaba.

---

## [0.2.75] — 2026-09-29 — Legibilidad de los textos de ayuda en modo oscuro

### Arreglo

- Los textos de ayuda dentro de las tarjetas del panel se leen mejor en modo oscuro (pasaron del gris tenue al gris claro de los secundarios).

---

## [0.2.74] — 2026-09-29 — Ajuste de legibilidad del login en modo oscuro

### Arreglo

- El texto de ayuda del acceso al panel se lee mejor en modo oscuro (pasó del gris tenue a un gris más claro, igual que los secundarios del panel).

---

## [0.2.73] — 2026-09-29 — Login y vista previa del fixture con el shell del panel

### Mejora

- El acceso al panel y la vista previa del fixture adoptan el shell del dashboard: el login se centra en una tarjeta con el escudo y la vista previa muestra el borrador en tarjetas con el resumen destacado antes de confirmar. Formularios y confirmaciones intactos; con esto todas las vistas del administrador comparten el mismo marco.

---

## [0.2.72] — 2026-09-29 — Botones de eliminación unificados y guía de diseño del panel

### Mejora

- El botón ✕ de eliminar partidos del fixture usa el mismo estilo discreto del resto del panel (el de eventos de la planilla conserva su rojo de precaución). Se documenta el sistema de diseño del panel (tokens, componentes y patrones) para futuras pantallas.

---

## [0.2.71] — 2026-09-29 — Nuevo diseño de Suspensiones y Ajustes de puntos

### Mejora

- Suspensiones estrena selector de torneo, reglas en su propia tarjeta y una card por jugador suspendido con las fechas pendientes bien visibles. Ajustes de puntos: formulario en tarjeta destacada y historial con el ajuste coloreado según sume o reste. Formularios y comportamiento intactos; con esto queda rediseñado todo el panel.

---

## [0.2.70] — 2026-09-29 — Nuevo diseño de Entregas y Estadísticas

### Mejora

- Entregas se vuelve una bandeja operativa: cada partido en una tarjeta destacada con su resultado oficial y cada entrega como card del equipo, con propuesta, comparación y acciones bien separadas; el aviso de dos entregas combinadas ahora se destaca. Estadísticas estrena encabezado con selector de torneo, pestañas visuales y tablas contenidas en cards del panel. Toda la lógica queda intacta.

---

## [0.2.69] — 2026-09-29 — Nuevo diseño de Fechas y Planillas

### Mejora

- Fechas, listado de Planillas y la planilla de cada partido adoptan el lenguaje visual del dashboard: encabezado con selector de torneo, cards con títulos de sección (estado y resultado, autores de goles por equipo, ajustes y notas, eventos del local y del visitante, reposición de postergados). El arrastre de horarios, los formularios y toda la lógica quedaron intactos.

---

## [0.2.68] — 2026-09-29 — Nuevo diseño de Delegados y marco visual de Fixture

### Mejora

- Delegados estrena el lenguaje visual del dashboard: métricas reales (total, habilitados, sin código y sin delegado), búsqueda y filtro por estado, y una card por equipo con delegado, código y entregas pendientes. En Fixture, el encabezado gana un selector de torneo, el generador es una tarjeta destacada y las fechas llevan un marcador verde; toda la lógica y estructuras de tabla quedaron intactas.

---

## [0.2.67] — 2026-09-29 — Nuevo diseño de Equipos y Jugadores

### Mejora

- Equipos y Jugadores adoptan el lenguaje visual del dashboard: métricas reales, filtros instantáneos y cards por equipo (escudo, nombre, estado y acciones) o por jugador (dorsal, posición y estado). En Jugadores, el selector de equipo pasa al encabezado y el alta se integra en una tarjeta. Sin cambios de funcionalidad.

---

## [0.2.66] — 2026-09-29 — Nuevo diseño del listado de torneos

### Mejora

- La pantalla de torneos del panel estrena el lenguaje visual del dashboard: métricas con datos reales, buscador y filtro por estado instantáneos, y una card por torneo con sus acciones; el torneo seleccionado queda destacado en verde. Sin cambios de funcionalidad.

---

## [0.2.65] — 2026-09-29 — Arreglo: el cambio de tema ya funciona en todo el panel

### Arreglo

- El botón de tema (claro / oscuro / automático) del panel de administración volvió a abrir su menú y a guardar la elección en todas las pantallas: la lógica del menú no estaba incluida en el shell del panel.

---

## [0.2.64] — 2026-09-29 — Todo el panel usa el shell del dashboard

### Mejora

- Todas las pantallas del panel (`/admin/*`) adoptan el mismo shell visual del inicio: menú lateral, barra superior con selector de torneo, buscador, campana de entregas y cambio de tema. El contenido de cada pantalla no cambia; solo el marco común. El panel del delegado y el sitio público siguen igual.

---

## [0.2.63] — 2026-09-29 — Dashboard admin: pasada de contraste en modo oscuro

### Mejora

- El dashboard de `/admin` gana legibilidad sin cambiar estructura ni datos: títulos y números de métricas más claros y grandes, sidebar con logo y textos más visibles y grupos mejor separados, cards y accesos rápidos con más contraste sobre el fondo, tablas y filas de partidos con separadores y encabezados más marcados, y acento verde ZonaLiga reforzado.

---

## [0.2.62] — 2026-09-28 — Nuevo diseño del inicio del panel de administración

### Mejora

- El inicio del panel (`/admin`) estrena diseño tipo dashboard: menú lateral fijo con navegación agrupada, buscador, campana de entregas pendientes y selector de tema; saludo de bienvenida, métricas con barra de progreso (equipos, jugadores, partidos y jornadas), tabla de posiciones, resultados recientes, próximos partidos, goleadores y accesos rápidos.
- En pantallas chicas el menú lateral se convierte en cajón con botón ☰. El resto de las pantallas del panel sigue como estaba.

## [0.2.61] — 2026-09-28 — La portada ya no queda tapada ni pegada a los bordes

### Arreglo

- En la portada, el cartel de bienvenida quedaba parcialmente tapado por el menú superior: ahora arranca debajo, en todas las pantallas.
- Entre 861 y 1120px de ancho (por ejemplo, notebooks en ventana chica) el contenido quedaba pegado a los bordes: ahora tiene aire lateral, sin cambiar cómo se ve en celular ni en pantalla grande.

## [0.2.60] — 2026-09-28 — Menú activo en Buscar y Novedades; En vivo respeta tu elección de torneo

### Arreglo

- Al navegar a Buscar o Novedades, el menú ahora marca bien el ítem correspondiente dentro del grupo "Más".
- En la página En vivo, si entrás sin elegir torneo (`?t=`), el menú ya no agrega el torneo activo por su cuenta: los enlaces quedan como en la portada. Si entrás con `?t=torneo-2026`, sí se conserva tu elección.

## [0.2.59] — 2026-09-28 — Posición del equipo dentro de su zona

### Arreglo

- La posición de la ficha de equipo se cuenta dentro de su zona/grupo (con la zona en la etiqueta), no sobre la tabla global de la liga.

## [0.2.58] — 2026-09-28 — La ficha del equipo muestra su zona

### Mejora

- La página de cada club indica a qué zona pertenece (por ejemplo "SPO · Zona Primera") junto a su nombre corto.

## [0.2.57] — 2026-09-28 — La portada recuerda el torneo elegido

### Mejora

- Si entrás a la portada con un torneo en particular (/?t=...), los enlaces "Ver fixture →", "Tabla completa →" y "Ver todos" llevan a ese mismo torneo, no al activo.

## [0.2.56] — 2026-09-28 — Nueva navegación del sitio público

### Mejora

- El menú principal se reordena según cómo se usa la liga: Inicio, En vivo, Fixture, Posiciones, Equipos y Estadísticas (la tabla de goleadores y tarjetas, con su nuevo nombre).
- Un menú "Más" agrupa Historial, Suspensiones, Buscar y Novedades; el pie de página refleja la misma estructura sin duplicados.
- Cuando estás viendo un torneo en particular, los enlaces del menú conservan ese torneo al navegar entre secciones.

## [0.2.55] — 2026-09-28 — Menús desplegables del panel visibles

### Arreglo

- Los menús Competencia, Operación, Equipos y Administración se despliegan completos encima del contenido: antes quedaban recortados por el scroll interno de la barra de navegación.

## [0.2.54] — 2026-09-28 — Ajustes de pantalla angosta en el panel

### Arreglo

- En el celular, la fila de acciones de cada fecha (Guardar / Regenerar) se apila y ningún botón queda cortado.
- En computadora con ventana angosta, el menú del panel compacta su espaciado para que las 6 secciones entren sin truncarse.

## [0.2.53] — 2026-09-28 — Reposición de postergados en Fechas

### Mejora

- La reposición de partidos postergados ahora vive en Operación → Fechas, junto a la grilla de la semana; Fixture queda solo con sus herramientas de estructura.

## [0.2.52] — 2026-09-28 — Nuevas páginas: Delegados y Estadísticas

### Nuevo

- La sección Delegados muestra todos los clubes juntos: quién tiene delegado, su código, entregas pendientes y accesos para habilitar, regenerar o revocar.
- La sección Estadísticas reúne en pestañas la tabla por zona, goleadores y tarjetas, fair play y valla menos vencida del torneo.

## [0.2.51] — 2026-09-28 — Panel reorganizado: nuevo menú con secciones

### Mejora

- El panel de administración estrena su navegación en 6 secciones: Inicio, Competencia (Torneos, Fixture y llaves), Operación (Fechas, Resultados, Entregas), Equipos (Equipos, Jugadores, Delegados), Estadísticas y Administración (Ajustes de puntos, Suspensiones).
- Fechas deja de estar escondido: ahora es un ítem de primer nivel dentro de Operación.
- El header del panel suma un selector único de torneo activo y menús desplegables en computadora; en celular el menú funciona como acordeón.

## [0.2.50] — 2026-09-28 — Color en el historial y en cada equipo

### Mejora

- En el historial, cada torneo muestra sus totales con ícono y color (equipos en verde, partidos en azul) y el campeón estrena una banda naranja con el trofeo.
- La página de cada equipo suma una tira de estadísticas con los 4 acentos: posición (verde), partidos jugados (azul), goles a favor (violeta) y valla (naranja).

## [0.2.49] — 2026-09-28 — Goleadores a todo color

### Mejora

- En la tabla de goleadores, el podio se pinta con los acentos nuevos (1° verde, 2° azul, 3° violeta, igual que en posiciones) y los goles de los tres primeros llevan el mismo color, un poco más grandes.
- El bloque de goleadores de la portada usa los mismos chips de color para el podio.

## [0.2.48] — 2026-09-28 — Los números del torneo a todo color

### Mejora

- La línea gris de números de la portada ahora es un bloque de tarjetas de estadística: Equipos (verde), Partidos jugados (azul), Goles (violeta) y Goles por partido (naranja), con ícono, número grande y los 4 acentos nuevos, en tema claro y oscuro.

## [0.2.47] — 2026-09-25 — Nuevo look claro y oscuro estilo dashboard

### Mejora

- Rediseño visual completo del sitio (público y panel) inspirado en un dashboard deportivo: tarjetas flotantes con esquinas más redondeadas y sombra suave en el tema claro, y superficies más profundas con verde más vivo en el oscuro.
- Las tablas de posiciones estrenan chips de posición: 1° verde, 2° azul, 3° violeta, resto gris.
- Nuevos colores de acento para estadísticas (verde, azul, violeta y naranja) listos para números y gráficos.
- El héroe de la portada suma una franja diagonal verde decorativa, y las tarjetas de torneo tienen un fondo con degradado verde.

## [0.2.46] — 2026-09-25 — Nueva portada: lo del sábado primero

### Mejora

- La portada arranca directo por lo que le interesa al hincha: la próxima fecha con los partidos en filas más legibles (nombre completo de cada equipo, y hora, día y cancha en línea propia con íconos).
- Las posiciones de portada ahora se muestran por zona: los primeros 3 de cada una; la tabla completa sigue a un clic.
- Mientras no haya resultados ni goles cargados, esas secciones no ocupan pantalla con carteles de vacío: aparecen solas cuando hay datos.
- Los números del torneo pasaron a una sola línea y el bloque de “cómo funciona” se resumió a una franja corta al final de la página.

## [0.2.45] — 2026-09-25 — El intercambio por arrastre ahora funciona en el celular

### Mejora

- En el panel “Días, horas y canchas”, el arrastre de partidos ya funciona con el dedo: se agarra la fila desde la manija (⋮⋮) y se suelta sobre otra de la misma fecha, igual que con el mouse.
- Además hay un camino alternativo sin arrastrar: tocar un partido y después otro los intercambia (tocar de nuevo el mismo lo desmarca). Sirve también en la computadora.

## [0.2.44] — 2026-09-25 — Intercambiar horario y cancha arrastrando (panel)

### Nuevo

- En el panel “Días, horas y canchas” de cada fecha, los partidos se pueden reordenar arrastrando la fila (⋮⋮) y soltándola sobre otra de la misma fecha: los dos intercambian horario y cancha, y el día queda como está. Sirve para el pedido típico de un equipo que pide jugar en otro horario: se arrastra su partido sobre el que hoy ocupa ese horario. Nada se guarda hasta apretar “Guardar fecha”.

## [0.2.43] — 2026-09-25 — Fixture ordenado por cancha y hora

### Mejora

- El fixture público de cada fecha ya no mezcla los partidos al azar: salen en el orden del cronograma real del día, por hora y cancha (si dos arrancan a la misma hora, ordena por cancha). Para que se entienda el orden, cada fila ahora también muestra la cancha del partido, junto al horario.
- En la página de inicio y en la página de cada equipo, la próxima fecha sigue el mismo orden cronológico.

## [0.2.42] — 2026-09-25 — Zonas visibles también en los cruces

### Nuevo

- En los partidos de cruce entre zonas del fixture público, cada equipo muestra su distintivo de zona (viene de la configuración del torneo): así se distingue de un vistazo que el cruce enfrenta a un equipo de cada zona. También en el inicio y en la página de cada equipo.

## [0.2.41] — 2026-09-25 — Mezcla real en el generador: cancha y hora por sorteo por día

### Arreglo

- Se descubrió la causa raíz de que "el azar no impactaba": la función que baraja del generador tenía un error y en realidad nunca mezclaba nada (devolvía los elementos a sus mismos lugares). Todas las barajas del generador eran falsas desde siempre.
- Además, la asignación ahora es en dos fases, como se sugirió: primero se arma cada día (quién juega contra quién), después cada día baraja sus partidos y les sortea cancha y hora. Un partido de cualquier zona puede tocarle la hora temprana o la tardía.

## [0.2.40] — 2026-09-25 — Distintivo de zona junto a cada equipo

### Nuevo

- En las filas de partido del sitio público (fixture, inicio), cada equipo muestra su distintivo de zona (A, B, Norte…): como la lista va mezclada, el badge permite ver de un vistazo quién pertenece a cada zona. En pantallas de celular angostas se oculta para no romper la fila.

## [0.2.39] — 2026-09-25 — En vivo también mezcla la fecha del día

### Arreglo

- La página En vivo ordenaba los partidos del día por hora, y como los horarios se asignan por zona, la grilla mostraba siempre la misma zona arriba. Ahora usa la misma mezcla estable que el fixture.

## [0.2.38] — 2026-09-25 — Los 5 próximos del inicio salen mezclados de toda la fecha

### Arreglo

- El bloque "Próxima fecha" del inicio cortaba los 5 partidos por orden de carga antes de mezclar: mostraba solo los de la zona que se generó primero. Ahora elige la fecha completa, la mezcla con la clave estable del fixture y recién después corta.

## [0.2.37] — 2026-09-25 — Mezclado en el inicio, el compartir y las fechas del panel

### Mejora

- El bloque "Próxima fecha" del inicio y el texto para compartir por WhatsApp ahora listan los partidos con la misma mezcla estable que el fixture (antes iban en orden de zona).
- La página "Días, horas y canchas" del panel también muestra cada fecha mezclada; guardar sigue funcionando igual porque el orden visual no afecta los datos.
- En el inicio, los 5 próximos partidos salen mezclados de toda la fecha: antes se cortaban por orden de carga y mostraban solo los de una zona.

## [0.2.36] — 2026-09-25 — Mezclado real de las fechas (v2)

### Arreglo

- El mezclado de la versión anterior respetaba la hora, pero como los horarios se asignan por zona (la A juega temprano y la B tarde, por ejemplo), el resultado visual seguía siendo zona A arriba y zona B abajo. Ahora el orden dentro de cada fecha es puramente mezclado y estable: las zonas quedan entremezcladas de verdad.

## [0.2.35] — 2026-09-25 — Partidos de cada fecha en orden mezclado

### Mejora

- En el fixture público, el panel y la página En vivo, los partidos de cada fecha ya no salen agrupados por zona (siempre la A primero): se muestran mezclados. El horario manda — el cronograma del día se respeta — y el mezclado es estable: la misma fecha se ve siempre igual, así que compartir por WhatsApp sigue sirviendo.

## [0.2.34] — 2026-09-25 — Aviso de desborde del cruce en la vista previa

### Nuevo

- Si la fecha del cruce elegida no alcanza para todos los cruces (más cruces que canchas y horarios, o equipos ya ocupados ese día), los sobrantes caen a las fechas siguientes y la vista previa muestra un aviso claro antes de confirmar: qué fecha elegiste, cuáles quedaron desbordadas y cómo corregirlo.
- La tabla "Cruces por fecha" marca con una etiqueta las fechas desbordadas.

### Mejora

- Antes, pedir una fecha sin lugar suficiente cancelaba la generación con un error. Ahora nada se pierde: los cruces entran de a uno por fecha y el plan se arma igual, avisando el desborde.

## [0.2.33] — 2026-09-25 — El cruce respeta la fecha que elegís

### Arreglo

- Al generar el fixture, la fecha del cruce que escribís en el formulario ahora se respeta: los cruces quedan exactamente en esa fecha. Antes el número se registraba pero los partidos terminaban repartidos al final del calendario.
- Si dejás la fecha vacía (automática), el cruce cae en la primera fecha libre después de las fechas de zona (antes podía caer en la fecha 1).
- Las fechas sin partidos que puedan quedar en el medio ya no se renumeran: el cruce conserva el número de fecha que elegiste.

## [0.2.32] — 2026-09-25 — El cruce se configura solo al generar el fixture

### Nuevo

- El formulario de generar fixture ahora también define en qué fecha vive el cruce: escribís el número o lo dejás vacío y el sistema lo pone en la primera fecha libre después de las fechas de zona.
- El panel muestra el cruce vigente (fecha, regla y si suma puntos) y aclara que se reemplaza al generar de nuevo: para cambiar un cruce hay que regenerar el fixture.

### Mejora

- Se quitó la sección "Fecha especial de cruce entre zonas" del panel y su creación manual: el cruce solo se configura y genera desde el formulario de generar fixture, una sola vez por generación. La vista previa sigue mostrando los cruces antes de confirmar.

## [0.2.31] — 2026-09-25 — Fixture sin cruces y arreglo del doble cruce

### Nuevo

- El formulario de generar fixture tiene un selector de cruces: "Con cruces" (como siempre) o "Sin cruces", que arma el fixture solo con los partidos de zona y al confirmar borra también los cruces que ya existían.

### Arreglo

- Si la misma fecha quedaba declarada dos veces como cruce (por ejemplo, generando la fecha de cruce dos veces con distinta regla), el generador armaba el doble de partidos de cruce. Ahora una fecha = un cruce: la última declaración reemplaza a la anterior, y la config se deduplica al leer.

## [0.2.30] — 2026-09-25 — Cruces: un solo camino y más control al generar

### Nuevo

- Al preparar la vista previa del fixture podés elegir la regla de cruce entre zonas (Espejo, Invertido o Cruzado) y si esos cruces suman puntos a la tabla, igual que en la fecha de cruce manual.
- La vista previa muestra una estadística con cuántos cruces quedaron en cada fecha del borrador.
- La ficha individual de cada partido en el sitio público muestra la marca "Cruce" cuando es un cruce entre zonas, igual que en el fixture.

### Mejora

- La fecha de cruce manual ahora escribe la marca de cruce en la nota de cada partido, igual que el generador automático: los dos caminos dejan el mismo rastro y la tabla, el playoff y la regeneración tratan los cruces idéntico.
- Nuevo test e2e que recorre el camino completo: preparar la vista previa eligiendo regla de cruce y puntos, confirmar, y verificar en la base que cada partido quedó con su nota de cruce correcta.

## [0.2.29] — 2026-09-25 — Cruces marcados y al azar al generar desde cero

### Nuevo
- Los partidos de cruce entre zonas generados con la bolsa mezclada llevan una marca distintiva "Cruce" (en el fixture público, en el panel y en la vista previa), con la aclaración de que no suman a la tabla de zona.
- La marca vive en el dato (nota interna del partido), así que la tabla, el playoff y "Regenerar cruce" los tratan bien aunque convivan con partidos de zona en la misma fecha.

### Mejora
- Al generar el fixture desde cero, los cruces se arman con posiciones al azar de cada zona (nadie tiene puntos todavía; antes quedaban ordenados por carga del sistema, prácticamente por ID).
- Si la config del cruce marca "los puntos cuentan para la tabla", la marca lo respeta y ese cruce sí suma.

---

## [0.2.28] — 2026-09-25 — Fixture con vista previa y confirmación (generador nuevo)

### Nuevo
- Generar fixture pasa a dos pasos: **Preparar vista previa** arma TODO el plan (no guarda nada) y muestra fecha por fecha con día, cancha y hora; recién con **Confirmar** se reemplaza el fixture. **Descartar** no toca nada.
- El planificador lee toda la configuración del torneo: zonas, canchas × horarios, fecha de inicio y fechas de cruce. Si hay cruces configurados, sus partidos entran a la misma bolsa que los de zona y caen mezclados en cualquier fecha.
- Cero postergados por falta de canchas: si un día no alcanzan los horarios/canchas, el resto de la bolsa sigue en el día siguiente (el torneo suma las fechas que necesite).
- Reglas duras, verificadas antes de mostrar y de guardar: cada fecha del fixture es un único día, un equipo nunca juega dos veces el mismo día y los horarios no se fuerzan (pueden quedar huecos para balancear).

### Mejora
- La vista previa muestra un resumen (partidos, fechas, tope por día, rango de fechas libres y cuántos cruces entraron) y guarda el borrador en la base: lo que ves es exactamente lo que se confirma.

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
