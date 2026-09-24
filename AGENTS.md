# AGENTS.md — Reglas de trabajo para los asistentes (Codebuff / Buffy)

Este archivo le indica a cualquier asistente de IA cómo trabajar en este proyecto (ZonaLiga).
Es un acuerdo de trabajo: si algo de acá no se cumple, el usuario tiene derecho a pedir que se corrija.

## 1. Idioma

- **Todas las respuestas deben estar en español**, siempre, sin excepción.
- También los comentarios que se agreguen al código, los textos del changelog y los mensajes que ve el usuario en la app.
- Los nombres de archivos, funciones y comandos quedan en inglés (así lo exige el código), pero **todo lo que se le explica al usuario va en español**.

## 2. Lenguaje para personas no programadoras

- Explicar las cosas **en lenguaje sencillo**, como se le contaría a alguien que maneja la liga pero no programa.
- Nada de jerga técnica sin explicar: si hay que mencionar algo técnico (una "migración", una "columna", un "endpoint"), se explica en una frase qué es y por qué importa.
- Usar ejemplos concretos de fútbol cuando ayude: "cada fecha", "la tabla de posiciones", "un partido suspendido".
- Está bien mostrar el detalle técnico en bloques de código, pero **el resumen y la decisión siempre van en lenguaje común**.

## 3. Formas de trabajar (importante)

Antes de escribir código para un cambio con varias formas posibles de hacerlo:

1. **Proponer alternativas**: presentar 2 o 3 opciones de diseño o de implementación, cada una con sus ventajas y desventajas en lenguaje sencillo.
2. **Esperar la elección del usuario**: no empezar a programar hasta que el usuario diga cuál prefiere (ej.: "opción 2").
3. Si una opción es claramente la recomendada, se marca como **(Recomendada)** y se explica por qué en una o dos frases.

Para cambios chicos o evidentes (un arreglo de un error, un texto mal escrito), se puede avanzar directo sin pedir elección.

## 4. Mostrar cómo va a quedar ANTES (mockup)

Antes de implementar cualquier cambio que se vea en pantalla (panel admin, sitio público, formularios, tablas):

- **Mostrar primero un boceto (mockup)** de cómo va a quedar la pantalla.
- Puede ser un dibujo en texto (cajas y líneas), un ejemplo del HTML que se va a mostrar, o una descripción clara pantalla por pantalla.
- Incluir qué campos va a tener cada formulario, qué botones y qué va a ver el usuario al terminar.
- Esperar la aprobación del diseño antes de escribir el código de la vista.

Ejemplo de mockup en texto:

```
┌─────────────────────────────────┐
│  Torneo: Ascenso 2026           │
│                                 │
│  Zona:  [ Ascenso ▾ ]           │
│                                 │
│  Fecha especial de cruce:       │
│  [x] Habilitar                  │
│  Día:    [ 15/05/2026 ]         │
│  Regla:  [ Por posición ▾ ]     │
│                                 │
│  [ Guardar ]  [ Cancelar ]      │
└─────────────────────────────────┘
```

## 5. Verificación obligatoria

Antes de dar por terminado cualquier cambio de código:

1. Correr `npm run typecheck` (revisa que no haya errores de tipos).
2. Correr `npm test` (los tests tienen que quedar todos en verde).
3. Si el cambio toca rutas o sesiones, correr también `npm run test:e2e`.
4. Informar en el resumen final qué comandos se corrieron y si pasaron.

## 6. Estilo del proyecto (ya existente, no cambiar)

- Sitio en español de Argentina ("vos" en los textos de la interfaz).
- Cambios visibles se registran en `src/changelog.ts` y se sube la versión en `package.json`.
- El código fuente usa TS estricto con Hono + D1; respetar la estructura de `src/lib`, `src/ui`, `src/routes` y `migrations`.
- No usar librerías nuevas sin avisar; el proyecto evita dependencias innecesarias.

## 7. Resumen final

Al terminar un trabajo, el resumen final para el usuario debe decir:

- Qué se hizo, en lenguaje sencillo.
- Qué archivos se tocaron.
- Qué comandos de verificación se corrieron y si pasaron.
- Qué queda pendiente (si algo) y qué decisión falta tomar (si alguna).
