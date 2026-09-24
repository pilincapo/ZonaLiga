# Scripts de carga y ayuda

Scripts para cargar datos (equipos, jugadores, torneos) y arreglar el
fixture desde la terminal. Todos hablan con el panel admin vía HTTP, así
que el server tiene que estar corriendo.

| Script | Sirve para | ¿Toca producción? |
|---|---|---|
| `seed-dev.mjs` | Cargar una liga de prueba completa en **local** | No |
| `seed-prod.mjs` | Cargar los equipos reales en **producción** | **Sí** ⚠️ |
| `fix-zonas.mjs` | Repartir los equipos en zonas y regenerar el fixture | Solo si le pasás la URL de producción |
| `gen-seed.ts` | Regenerar `seed.sql` (los datos de ejemplo del repo) | No |
| `test-e2e.mjs` | Tests de punta a punta (`npm run test:e2e`) | No |

## Antes de empezar

1. Levantar el server local: `npx wrangler dev --port 8790`
   (todos los scripts usan esa URL salvo que le pases otra).
2. Si el entorno tiene `ADMIN_PASSWORD` configurada, exportala:
   `export ADMIN_PASSWORD=tu-clave`. En local sin config, la clave es la
   de desarrollo (`zonaliga-dev-secret-change-me`).

## seed-dev.mjs — liga de prueba local

Crea equipos con nombres al azar, jugadores, un torneo con 2 zonas y
genera el fixture. No borra nada: si ya corrió, duplica (limpiá con
`npm run db:unseed:local && npm run db:migrate:local`).

```bash
node scripts/seed-dev.mjs                       # 30 equipos, 14 jugadores c/u
TEAMS_PER_ZONE=8 node scripts/seed-dev.mjs      # 16 equipos (8 por zona)
PLAYERS_PER_TEAM=0 node scripts/seed-dev.mjs    # sin jugadores
SHUFFLE_TEAMS=1 node scripts/seed-dev.mjs       # mezcla las zonas al azar
```

Variables: `TEAMS_PER_ZONE` (default 15), `PLAYERS_PER_TEAM` (default 14),
`TOURNAMENT_NAME` (default "Liga de Prueba 2026"), `SHUFFLE_TEAMS`,
`ADMIN_PASSWORD`.

## seed-prod.mjs — carga de producción ⚠️

Crea el torneo con zonas y los 44 equipos reales (22 por zona) con sus
jugadores. **No genera fixture ni canchas**: eso se hace desde el panel
después. Pide la contraseña real del sitio publicado:

```bash
ADMIN_PASSWORD=xxxx node scripts/seed-prod.mjs
```

Variables: `TOURNAMENT_NAME` (default "Torneo 2026"),
`PLAYERS_PER_TEAM` (default 14; con `0` salta los jugadores).
Los nombres de los equipos están en los arrays `ZONA_A`/`ZONA_B` del
script; editalos si cambia el plantel.

## fix-zonas.mjs — repartir zonas y regenerar el fixture

Reasigna los equipos activos en dos zonas iguales ("mitad y mitad": la
diferencia entre zonas nunca pasa de 1) y regenera el fixture del torneo.

**Ojo:** regenerar el fixture borra todos los partidos del torneo. Si hay
resultados cargados, el script frena solo: el panel se niega por diseño a
borrar partidos jugados. En ese caso usá "↻ Regenerar cruce" desde el panel
(conserva lo jugado) o borrá los resultados primero.

```bash
node scripts/fix-zonas.mjs                          # torneo activo, server local
node scripts/fix-zonas.mjs http://127.0.0.1:8790 2  # torneo id 2
node scripts/fix-zonas.mjs torneo-2026              # por slug
```

A diferencia del formulario del panel, este script no pisa el resto de la
config del torneo: lee las canchas, horarios y reglas tal como están y
solo cambia las zonas.

## gen-seed.ts — regenerar seed.sql

```bash
node --experimental-strip-types scripts/gen-seed.ts
```

Regenera `seed.sql` con el mismo generador de fixture de la app.
