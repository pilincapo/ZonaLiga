# ZonaLiga — Sistema de diseño del panel (`/admin`)

> Referencia rápida para crear o ajustar pantallas del panel. El estilo vive
> en `public/css/app.css` (tokens al inicio, bloque dashboard al final) y los
> componentes en `src/ui/components.ts`. Todo lo de acá ya está en producción.

## 1. El shell (no se duplica, se reutiliza)

Toda pantalla de `/admin/*` se renderiza **solo** con `adminLayout()` (en
`src/ui/admin.ts`), que llama a `dashboardShell()` (en `src/ui/components.ts`).
Nada debe armar su propio `<html>`, header ni menú: pasás título, `active`
(qué item del menú queda marcado) y `body` (el contenido).

- Sidebar 244px navy con grupos: Inicio · Competencia · Operación · Equipos · Estadísticas · Administración.
- Topbar: selector de torneo, buscador, campana de entregas, menú de tema.
- Móvil (≤900px): drawer con hamburguesa + overlay + Escape (script incluido en el shell).
- Tema claro/oscuro: tokens compartidos; el shell nunca se estila por pantalla.

## 2. Tokens (variables CSS, `public/css/app.css`)

| Uso | Claro | Oscuro |
|---|---|---|
| Fondo | `--bg` `#eef2f7` | `#0a0d12` |
| Card (nivel 1) | `--surface` `#ffffff` | `--surface-2` `#1a2330` |
| Card destacada | `--surface-2` | `--surface-3` |
| Borde de card | `--border-strong` | `#33455e` |
| Texto | `--text` | `#eaf0f6`; títulos blancos `#ffffff` |
| Secundario | `--muted` `#5a6b7e` | `#b3c2d4` |
| Acento | `--accent` `#22c55e` | `#2ee07a` |
| Peligro | `--danger` `#e5484d` | `#f87171` |
| Radios | `--radius` 14px, `--radius-sm` 10px, `--radius-xs` 8px | mismos |
| Métricas | `--st-green/blue/violet/amber` (+ `m-red` local del panel) | más vivos |

Reglas de oro: **nada de gradientes exagerados ni imágenes de fondo**; las
cards flotan por borde + sombra suave; un solo acento (verde) y rojo solo para
peligro.

## 3. Patrones de página (en orden vertical)

1. **Hero** (`dash-hero`): kicker en uppercase verde (sección: Competencia /
   Operación / Equipos / Panel / Administración) + `h1` + descripción breve a
   la derecha del botón/acción principal (verde ZonaLiga) o del selector.
2. **Métricas** (`dash-metrics` grid + `dash-metric`): solo datos reales ya
   calculados; nunca inventar. Ícono en cápsula de color + número grande +
   barra de progreso.
3. **Filtros** (`.tpage-filters`): buscador (`tpage-search`) + pestañas
   (`tpage-tab`, la activa con `.on`). Client-side con el mini-script de las
   otras páginas; para listas server-side, links `?t=&tab=` (Estadísticas).
4. **Listado**: cards en filas (`.tcard`) con escudo/ícono, título + badge de
   estado, meta con íconos y acciones a la derecha (`btn-primary` = acción
   principal, `btn-ghost` = secundarias, `.tcard-ghost` = ✕ destructivas).
5. **Tablas**: siempre dentro de `dash-card` + `table-wrap` (scroll móvil).
   Encabezados de sección con `h3.zone-title` (los tests los parsean: no
   meter nada entre `Fecha N` y el `<`).
6. **Formularios**: en `dash-card`, agrupados con `.dash-sub` (subtítulos
   internos); alta en línea con `.padd`; selectores de torneo con `.pselect`.

## 4. Componentes clave

- `dash-card` + `dash-card-head` (título con ícono `icon('...', 16)` + link a la derecha).
- `dash-sub`: subtítulo interno de una card (resultado/datos/autores...).
- `crest()`: escudo de equipo (siempre tamaño `sm` en cards, 34px via `.pcrest`).
- Badges de estado: `.badge green/amber/ghost/red` — semántica consistente (En curso verde, Borrador ámbar, Finalizado/inactivo gris, peligro rojo).
- `.fgen` (borde verde) y `.fmakeup`/`.entmatch` (borde ámbar): cards destacadas por propósito.
- `.pnum` (dorsal), `.pchip` (posición), `.susp-ico` (avatar de suspensión).
- Estado vacío: `emptyNote('Texto')`, siempre con tono amable.

## 5. Contratos que no se pueden romper

- `adminLayout()` como único punto de renderizado; nav activa por `active`.
- Selectores/fórmulas de tests: `name="tournament_id"`, filas
  `<tr draggable="true" data-match>` + `.drag-handle`, `h3.zone-title` exactos,
  `name="home_goals" ... value=`, `name="hg1"`, `<textarea name="notes"`,
  `/admin/ajustes/:id/borrar`, `/admin/entregas/:id/aprobar`, y la estructura
  `<strong>Nombre</strong>…Editar` que parsean los seeds.
- Fechas: los names `d_/t_/v_{id}` y el script de swap atado a
  `form[action="/admin/fechas/guardar"]`.
- Los POSTs y confirmaciones existentes no cambian de texto ni de campos.

## 6. Al crear una pantalla nueva, checklist

1. ¿Usa `adminLayout()` con `active` correcto?
2. ¿Hero con kicker de su sección + descripción + acción principal?
3. ¿Métricas solo con datos reales? ¿Filtros solo con lógica existente?
4. ¿Cards/tablas según el tipo de contenido, con `table-wrap`?
5. ¿Claro y oscuro verificados (fondo, card, borde, texto, acento)?
6. ¿Responsive 1280/1024/900/768/390/360 sin overflow?
7. ¿Respeta los contratos de tests si toca pantallas vigiladas?
8. ¿Actualizó versión, changelog y `ASSET_VERSION`?
