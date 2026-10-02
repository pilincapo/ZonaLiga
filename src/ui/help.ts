// Renderizado de la ayuda del panel.
//
// Solo dibuja: el contenido vive entero en `src/lib/help.ts`. Este módulo NO
// importa `admin.ts` (para no crear un ciclo), así que la página se arma en
// `admin.ts` con `adminLayout` y acá están los bloques sueltos.

import { esc, escUrl } from '../lib/html.ts';
import { icon } from './components.ts';
import {
  HELP_CATEGORIES,
  helpTopic,
  searchHelp,
  type HelpBlock,
  type HelpCategory,
  type HelpSection,
  type HelpTopic,
} from '../lib/help.ts';

/** Convierte **negrita** a <strong> y escapa el resto. El contenido está escrito
 * en Markdown mínimo a propósito para poder editarlo sin tocar HTML. */
function rich(text: string): string {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function listHtml(items: string[], cls: string): string {
  return `<ul class="${cls}">${items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`;
}

/** Un bloque de contenido → HTML. */
export function helpBlockHtml(b: HelpBlock): string {
  switch (b.kind) {
    case 'p':
      return `<p>${rich(b.d)}</p>`;
    case 'ul':
      return listHtml(b.items, 'h-list');
    case 'ol':
      return listHtml(b.items, 'h-list h-num');
    case 'steps':
      return `<ol class="h-steps">${b.items
        .map(
          (s, i) =>
            `<li class="h-step"><span class="h-step-n">${i + 1}</span><div><strong>${rich(s.t)}</strong><p>${rich(s.d)}</p></div></li>`
        )
        .join('')}</ol>`;
    case 'warn':
      return `<div class="h-warn"><strong>${rich(b.t ?? 'Ojo')}</strong><p>${rich(b.d)}</p></div>`;
    case 'note':
      return `<div class="h-note"><p>${rich(b.d)}</p></div>`;
    case 'keys':
      return `<dl class="h-keys">${b.rows
        .map(([k, v]) => `<div><dt>${rich(k)}</dt><dd>${rich(v)}</dd></div>`)
        .join('')}</dl>`;
    case 'links':
      return `<ul class="h-list">${b.items
        .map((i) => `<li><a href="${escUrl(i.href)}">${rich(i.label)}</a></li>`)
        .join('')}</ul>`;
  }
}

/** Una sección con su ancla, para enlazar directo. */
export function helpSectionHtml(section: HelpSection): string {
  return `<section class="h-sec" id="${esc(section.id)}">
  <h3>${rich(section.title)}</h3>
  ${section.blocks.map(helpBlockHtml).join('\n  ')}
</section>`;
}

function categoryHtml(category: HelpCategory): string {
  return `<section class="h-cat" id="${esc(category.id)}">
  <div class="h-cat-head">
    <h2>${icon(category.icon as 'list', 20)} ${rich(category.title)}</h2>
    <p class="h-cat-sum">${rich(category.summary)}</p>
  </div>
  ${category.sections.map(helpSectionHtml).join('\n  ')}
</section>`;
}

/** Índice con las categorías y sus secciones. */
function helpIndexHtml(): string {
  return `<nav class="h-index" aria-label="Índice de la ayuda">
  <div class="h-index-head">Índice</div>
  ${HELP_CATEGORIES.map(
    (c) => `<div class="h-index-cat">
    <a class="h-index-cat-link" href="#${esc(c.id)}">${icon(c.icon as 'list', 14)} ${rich(c.title)}</a>
    <ul>${c.sections.map((s) => `<li><a href="#${esc(s.id)}">${rich(s.title)}</a></li>`).join('')}</ul>
  </div>`
  ).join('\n  ')}
</nav>`;
}

/** Atajos por categoría (las mismas pestañas que usa el resto del panel). */
function helpTabsHtml(): string {
  return `<div class="tpage-tabs" role="group" aria-label="Ir a una sección">
  ${HELP_CATEGORIES.map(
    (c) => `<a class="tpage-tab" href="#${esc(c.id)}">${icon(c.icon as 'list', 13)} ${rich(c.title)}</a>`
  ).join('\n  ')}
</div>`;
}

/** Formulario de búsqueda: GET a la misma página, sin JavaScript. */
function helpSearchHtml(query: string): string {
  return `<form class="h-search" method="get" action="/admin/ayuda">
  <div class="tpage-search">${icon('search', 15)}<input type="search" name="q" value="${esc(query)}" placeholder="Buscar en la ayuda: dorsal, walkover, reprogramar, fair play…" aria-label="Buscar en la ayuda"${query ? '' : ' autofocus'}></div>
  <button class="btn btn-primary btn-sm" type="submit">Buscar</button>
  ${query ? '<a class="btn btn-ghost btn-sm" href="/admin/ayuda">Limpiar</a>' : ''}
</form>`;
}

/** Resultados de la búsqueda. */
function helpResultsHtml(query: string): string {
  const hits = searchHelp(query);
  if (hits.length === 0) {
    return `<div class="error-box">No encontré nada para “${esc(query)}”. Probá con una palabra más corta (por ejemplo: dorsal,Goals, walkover, torneo).</div>`;
  }
  return `<div class="h-results">
  <p class="hint">${hits.length} resultado${hits.length === 1 ? '' : 's'} para “${esc(query)}”.</p>
  ${hits
    .map(
      (h) => `<article class="h-hit">
    <a class="h-hit-link" href="#${esc(h.sectionId)}"><strong>${rich(h.sectionTitle)}</strong></a>
    <span class="badge ghost">${rich(h.categoryTitle)}</span>
    <p>${rich(h.snippet)}</p>
  </article>`
    )
    .join('\n  ')}
</div>`;
}

/** Cuerpo completo de /admin/ayuda (sin el layout: lo agrega admin.ts). */
export function helpPageBody(query: string): string {
  const q = query.trim();
  return `<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Documentación</span>
    <h1>Ayuda</h1>
    <p>Guía completa del panel: cómo armar un torneo, cargar resultados y revisar la competencia. Todo lo que el sistema hace, paso a paso.</p>
  </div>
</div>
<section class="block"><div class="card" style="padding:14px">
  ${helpSearchHtml(q)}
  <p class="hint">¿Preferís leer de corrido? Usá el índice de abajo. En cada pantalla del panel hay además un <strong>? Ayuda</strong> con lo puntual de esa pantalla.</p>
</div></section>
${
  q
    ? `<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('search', 16)} Resultados</h2></div>
  ${helpResultsHtml(q)}
</div></section>
<section class="block"><div class="card" style="padding:14px">${helpSearchHtml(q)}</div></section>`
    : ''
}
${
  q
    ? ''
    : `<section class="block"><div class="card" style="padding:14px">
  ${helpTabsHtml()}
</div></section>
<div class="h-layout">
  ${helpIndexHtml()}
  <div class="h-content">
    ${HELP_CATEGORIES.map(categoryHtml).join('\n    ')}
  </div>
</div>`
}
<p class="hint">Esta guía describe exactamente lo que el sistema hace hoy. Si algo cambia, se actualiza acá; no hay textos sueltos repetidos en cada pantalla.</p>`;
}

function topicBlockHtml(topic: HelpTopic): string {
  const col = (title: string, items: string[], tone: string): string =>
    items.length === 0
      ? ''
      : `<div class="h-c-${tone}"><strong>${esc(title)}</strong>${listHtml(items, 'h-list')}</div>`;
  const more =
    topic.more.length === 0
      ? ''
      : `<p class="h-hint">Ver en la guía: ${topic.more
          .map((m) => `<a href="${escUrl(m.href)}">${esc(m.label)}</a>`)
          .join(' · ')}</p>`;
  return `<details class="hhelp">
  <summary><span class="hhelp-q">?</span> Qué puedo hacer aquí</summary>
  <div class="hhelp-in">
    <p class="hhelp-para">${esc(topic.para)}</p>
    <div class="hhelp-cols">
      ${col('Podés hacer', topic.actions, 'do')}
      ${col('Cuidado', topic.cautions, 'warn')}
      ${col('Bloqueos', topic.restrictions, 'lock')}
    </div>
    ${more}
  </div>
</details>`;
}

/**
 * Ayuda contextual de una pantalla. Se resuelve desde la sección activa, así
 * que cada pantalla tiene su propio texto sin repetirlo en el código.
 */
export function helpContextBlock(active: string): string {
  if (active === 'ayuda' || active === 'login') return '';
  const topic = helpTopic(active);
  return topic ? topicBlockHtml(topic) : '';
}