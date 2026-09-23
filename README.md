# ZonaLiga ⚽ — Control de ligas de fútbol amateur

App web para administrar ligas amateur: fixture, resultados, posiciones, goleadores,
tarjetas, suspensiones, historial de torneos y plantillas. 100% en el free tier de
**Cloudflare Workers + D1**.

## Stack

| Capa | Tecnología | Costo |
|---|---|---|
| Servidor + SSR | Cloudflare Workers + Hono | Gratis (100k req/día) |
| Base de datos | Cloudflare D1 (SQLite edge) | Gratis (5GB) |
| Assets estáticos | Cloudflare Assets (CSS, PWA, íconos) | Gratis |
| Instalable | PWA (manifest + service worker) | Gratis |

## Desarrollo local

```bash
npm install
npm run db:migrate:local   # crea las tablas en D1 local
npm run db:seed:local      # carga el torneo de ejemplo (Copa Barrial 2026)
npm run dev                # http://localhost:8787
```

- Sitio público: `/`
- Panel admin: `/admin` → contraseña de desarrollo: `zonaliga-dev-secret-change-me`
  (definida como fallback en `src/routes/admin.ts`; en producción se configura como secreto).
- Panel de delegado: `/delegado` → se entra con el código del equipo (se genera desde el admin).

Comandos útiles:

```bash
npm test                   # tests de lógica (fixture, posiciones, suspensiones, auth)
npm run typecheck          # tsc --noEmit
npm run db:unseed:local    # borra TODOS los datos locales
```

## Deploy a Cloudflare (gratis)

> **Deploy actual:** https://liga-amateur.pilin123.workers.dev
> (base D1 `liga-amateur`, región ENAM, con el torneo de ejemplo cargado)

1. **Creá la base D1** (una sola vez):

   ```bash
   npx wrangler login
   npx wrangler d1 create liga-amateur
   ```

   Copiá el `database_id` que devuelve y pegalo en `wrangler.toml`
   (reemplazá `REPLACE_WITH_YOUR_D1_DATABASE_ID`).

2. **Migraciones + datos remotos:**

   ```bash
   npm run db:migrate:remote
   npm run db:seed:remote    # opcional: torneo de ejemplo
   ```

3. **Contraseña del panel** (reemplazá tu contraseña fuerte):

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```

4. **Publicar:**

   ```bash
   npm run deploy
   ```

   Tu app queda en `https://liga-amateur.<tu-subdominio>.workers.dev`.

## CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — en cada push y PR: `npm run typecheck` + `npm test` con Node 22 (cachea `npm ci`).
- **`.github/workflows/deploy.yml`** — en cada push a `main`: corre los mismos checks y si pasan publica con `wrangler-action`. Usa el environment `production` (restringido a `main`), que permite aprobar o cancelar el deploy desde la pestaña *Environments* de GitHub.

Secrets requeridos en el repo (Settings → Secrets and variables → Actions):

| Secret | Cómo obtenerlo |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens → *Create Token* → plantilla **Edit Cloudflare Workers** → Continue → copiar. Usar en `wrangler-action@v3` o `npx wrangler deploy` con `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`. |
| `CLOUDFLARE_ACCOUNT_ID` | Valor no secreto, visible en el dashboard o `npx wrangler whoami`. Ya cargado. |

Recomendación: el token de CI puede compartir los mismos permisos que el deploy manual. Si se quiere menor radio de impacto, excluir D1 (las migraciones se corren local o manualmente con `npm run db:migrate:remote`).

## Dominio propio

1. Agregá tu dominio a Cloudflare (Plan Free: **Add site** y seguí el asistente;
   cambiá los nameservers en tu registrador).
2. En el dashboard: **Workers & Pages → liga-amateur → Settings → Domains & Routes →
   Add → Custom domain** (ej: `ligas.tudominio.com`). Cloudflare crea el DNS y el
   certificado TLS solos.
3. Listo: la app sirve HTTPS en tu dominio sin costo extra.

## Armar tu liga (2 minutos)

1. `/admin` → **Torneos → + Nuevo torneo**: nombre, formato y reglas
   (puntos, walkover, suspensión por roja y acumulación de amarillas).
2. **Equipos → + Nuevo equipo**: nombre, corto (3 letras) y color de camiseta
   (la cresta se genera sola; podés poner URL de escudo).
3. **Jugadores**: elegí el equipo y cargá la plantilla.
4. **Fixture → Generar**: ida o ida y vuelta con todos los equipos activos.
   Después **Fechas** para asignar día, hora y cancha de cada jornada.
5. Cada fecha: **Planilla → Cargar planilla**: resultado + goles y tarjetas
   (el minuto es opcional). Las posiciones, goleadores y suspensiones se
   recalculan solos.
6. Opcional: **Delegados** por equipo (ver abajo) para que ellos carguen los
   resultados y vos solo apruebes.

## Carga de resultados por los delegados

Cada equipo puede tener un **delegado** que carga el resultado de sus partidos desde el
celular; nada se publica hasta que vos lo apruebes.

**Configurar el delegado (una vez por equipo)**

1. `/admin` → **Equipos** → abrí el equipo.
2. En **Delegado del equipo**: nombre (ej. “Diego — DT”) y un teléfono opcional, Guardar.
3. **Generar código de acceso**: aparece un código de 8 caracteres. Al guardarlo se
   marca automáticamente si el código es nuevo, así podés avisarle solo si cambió.
4. **Enviar por WhatsApp**: botón que abre WhatsApp con el mensaje ya armado
   (link de acceso + código + instrucciones). Reenviar no regenera el código.

**Cómo lo usa el delegado**

- Entra a `/delegado` desde el celular, pega el código y ve **solo los partidos de su
  equipo** (programados primero, con día, hora y cancha).
- Toca un partido → carga el resultado con goles y tarjetas (marcador, goleador,
  tipo de evento; minuto opcional) → **Enviar al administrador**.
- Puede **editar o retirar** su envío mientras esté pendiente, y ve el motivo si
  lo rechazás.
- El delegado nunca escribe en las tablas oficiales: solo ve su envío y su estado.

**Aprobación (admin)**

- `/admin` → **Entregas** (el menú muestra un contador con lo pendiente).
- Cada tarjeta muestra el marcador enviado junto al oficial, quién lo cargó, cuándo y
  las notas. Si ya hay resultado oficial y **coincide**, se avisa; si **difiere**,
  el oficial se resalta para que lo revises.
- **Aprobar** copia el resultado y todos los eventos a las tablas oficiales
  (el partido pasa a “jugado” y las posiciones, goleadores y suspensiones se recalculan).
- **Rechazar** pide un motivo; el delegado lo ve en su panel y puede corregir y reenviar.

**Seguridad**: el código se guarda solo como hash (`código + ADMIN_PASSWORD`), la sesión de
delegado es una cookie HMAC firmada que incluye ese hash — **regenerar o revocar el código
invalida las sesiones abiertas al instante**. Los eventos se validan contra la plantilla del
equipo y el partido (no se puede cargar un gol de un jugador ajeno ni un partido de otro equipo).

## Fecha en vivo

Vista pública `/en-vivo` pensada para el celular el día de partido: muestra **los partidos de
hoy** y se actualiza sola, sin que nadie recargue.

- Los partidos se agrupan por estado: en juego, por jugar, terminados, postergados y
  suspendidos, con un resumen arriba (cuántos en cancha, cuántos por jugar, goles del día).
- Cada tarjeta muestra la fase real según el horario: **Próximo** (con cuenta regresiva),
  **1er tiempo**, **Entretiempo**, **2do tiempo**, **Alargue**, **Penales** o **Final**.
  Los tiempos se calculan con la cancha de cada partido, así que se ven iguales para todo el mundo.
- Si un delegado cargó un resultado que vos todavía no aprobaste, aparece como
  **PROVISORIO** (marcador punteado) con el nombre de quien lo envió; al aprobarlo se vuelve oficial.
- Los goleadores del día se listan al pie de cada partido.
- La página pide `GET /api/vivo` cada 30 s (y al volver a la pestaña), parchea el DOM en el
  lugar y **se pausa sola** cuando no hay partidos en curso. Si el navegador no soporta
  `fetch`, cae a una recarga completa. No usa websockets ni servicios extra: sigue dentro
  del free tier.
- Los días sin partidos no gasta requests: la página dice **“Hoy no se juega”** y cuándo es
  la próxima fecha, y no arranca el refresco automático.
- El home muestra un aviso **“Hoy se juega · N partidos”** que lleva a la vista en vivo.

> La hora de la liga se configura en `src/lib/live.ts` (`LEAGUE_TZ_OFFSET`, por defecto
> UTC−3, Argentina). Todo el cálculo de fases es lógica pura y está cubierto por
> `test/live.test.ts`.

## Diseño

Tema **claro deportivo**: barra navy fija, acento verde, tarjetas blancas con sombra
suave y mobile-first. El home tiene hero con buscador, grilla de torneos con estado
(*En curso / Próximo / Finalizado*) y totales, próxima fecha, últimos resultados,
tablas, goleadores y números del torneo.

- Sin dependencias externas: el CSS vive en `public/css/app.css` con tokens
  (`--navy`, `--accent`, `--surface`, `--border`, …), sin frameworks ni fuentes remotas.
- **Tema: claro / oscuro / automático.** El botón del header abre un menú con las
  tres opciones. Sin elección manual el sitio **sigue la preferencia del sistema**
  (`prefers-color-scheme`) y reacciona en vivo si cambia; cuando el usuario elige
  claro u oscuro, esa elección **siempre gana** y se guarda en `localStorage`
  (`zl-theme`). "Automático" borra la clave y vuelve a seguir al sistema.
- El oscuro reusa la paleta original y vive bajo `html[data-theme='dark']` en el mismo
  CSS, como override de tokens. Un script inline en el `<head>` pinta el tema antes de
  que cargue la hoja de estilos, así no hay parpadeo.
  `design/app.css.dark-original` queda solo como referencia histórica.
- **Buscador** en `/buscar?q=`: busca equipos, jugadores y torneos a la vez.
- El tema oscuro anterior quedó guardado en `design/app.css.dark-original`
  (para volver atrás: copiarlo sobre `public/css/app.css`).
- **Caché del service worker:** al tocar CSS o íconos, subí `ASSET_VERSION` en
  `src/ui/components.ts` (versiona `/css/app.css?v=N`, así saltea la caché vieja).
  Los estáticos se sirven con *stale-while-revalidate*: aun sin tocar la versión,
  el próximo deploy se ve en la siguiente visita.

## Estructura

```
migrations/         Esquema D1 (0001_init, 0002_delegados)
seed.sql            Torneo de ejemplo (fictional)
src/lib/            Lógica pura: tipos+reglas, standings, fixture (algoritmo del círculo),
                    bracket, suspensiones, delegates, auth HMAC, share WhatsApp, queries D1
src/ui/             Vistas SSR (strings, sin build de frontend)
src/routes/         Handlers del panel admin (admin.ts) y del delegado (delegate.ts)
public/             CSS (tema claro), manifest PWA, service worker, íconos
design/             Tema oscuro original, por si querés volver atrás
test/               Vitest: 57 tests de la lógica crítica
```

## Quitar los datos de ejemplo

```bash
npm run db:unseed:remote   # o :local para el entorno de desarrollo
```
