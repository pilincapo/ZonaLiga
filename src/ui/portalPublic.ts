// Páginas públicas del portal informativo: Noticias, Fotos, El Complejo y
// Información del Torneo. Solo muestran contenido PUBLICADO (la capa de datos
// ya filtra); usan el layout común del sitio con su navegación.
//
// Estética: navy y blanco con acentos verde y azul, y fotografía grande en las
// cabeceras. Es la misma identidad de la portada, para que pasar de una página a
// otra no parezca otro sitio.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort, formatDateLong } from '../lib/format.ts';
import { layout, emptyNote, shareBar } from './components.ts';
import { PUBLIC_NAV, PUBLIC_NAV_MAS } from './public.ts';
import { icon } from './icons.ts';
import { parrafos, type ComplejoData, type Galeria, type ImagenGaleria, type Noticia, type PaginaContenido, type TorneoData } from '../lib/portalContent.ts';

/** Cabecera común de las páginas del portal, con foto de fondo si la hay. */
function cabecera(kicker: string, titulo: string, sub: string, foto?: string): string {
  const estilo = foto ? ` style="--px-foto:url('${escUrl(foto)}')"` : '';
  return `<section class="px-hero"${estilo}>
  <div class="px-hero__inner">
    <p class="px-hero__kicker">${esc(kicker)}</p>
    <h1>${esc(titulo)}</h1>
    ${sub ? `<p class="px-hero__sub">${esc(sub)}</p>` : ''}
  </div>
</section>`;
}

/** Tarjeta de dato (dirección, horarios, teléfono…) con icono. */
function dato(label: string, valor: string, ico: Parameters<typeof icon>[0]): string {
  if (!valor.trim()) return '';
  return `<div class="px-dato">
  <span class="px-dato__ico" aria-hidden="true">${icon(ico, 17)}</span>
  <div><strong>${esc(label)}</strong><div class="px-dato__valor">${parrafos(valor)}</div></div>
</div>`;
}

/* ------------------------------ Noticias ------------------------------ */

function noticiaCard(n: Noticia): string {
  const media = n.imagen
    ? `<a class="pn-media" href="/noticias/${n.id}"><img src="${escUrl(n.imagen)}" alt="" loading="lazy"></a>`
    : '<span class="pn-media pn-media-empty" aria-hidden="true"></span>';
  return `<article class="pn-card${n.destacada ? ' destacada' : ''}">
  ${media}
  <div class="pn-body">
    <div class="pn-meta">
      ${n.destacada ? '<span class="badge amber">Destacada</span>' : ''}
      <time>${esc(formatDateShort(n.published_at ?? ''))}</time>
      ${n.autor ? `<span>Por ${esc(n.autor)}</span>` : ''}
    </div>
    <h2><a href="/noticias/${n.id}">${esc(n.titulo)}</a></h2>
    ${n.resumen ? `<p>${esc(n.resumen)}</p>` : ''}
    <a class="pn-more" href="/noticias/${n.id}">Leer más →</a>
  </div>
</article>`;
}

/** Listado público de noticias publicadas: listado editorial + destacadas. */
export function noticiasListBody(noticias: Noticia[]): string {
  const head = cabecera('Portal informativo', 'Noticias', 'Todo lo que pasa en la liga, contado al día.');
  if (noticias.length === 0) {
    return `${head}<section class="block">${emptyNote('Todavía no hay noticias publicadas')}</section>`;
  }
  // "Destacadas" sale de las mismas noticias que ya trae la lista (las
  // marcadas como destacadas): no es una consulta nueva.
  const destacadas = noticias.filter((n) => n.destacada).slice(0, 4);
  const aside = destacadas.length > 0
    ? `<aside class="pn-aside">
  <h2 class="pn-aside__title">Noticias destacadas</h2>
  <ul class="pn-aside__list">${destacadas
    .map(
      (n) => `<li><a href="/noticias/${n.id}">
    ${n.imagen ? `<span class="pn-aside__thumb"><img src="${escUrl(n.imagen)}" alt="" loading="lazy"></span>` : ''}
    <span class="pn-aside__txt"><strong>${esc(n.titulo)}</strong><time>${esc(formatDateShort(n.published_at ?? ''))}</time></span>
  </a></li>`
    )
    .join('')}</ul>
</aside>`
    : '';
  return `${head}<div class="pn-layout">
  <section class="pn-grid">${noticias.map(noticiaCard).join('')}</section>
  ${aside}
</div>`;
}

/** Página pública de una noticia (solo publicada). */
export function noticiaBody(n: Noticia): string {
  const meta = [
    `<time>${esc(formatDateLong(n.published_at ?? ''))}</time>`,
    n.autor ? `<span>Por ${esc(n.autor)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<article class="pn-article">
  <header class="pn-article-head">
    ${n.destacada ? '<span class="badge amber">Noticia destacada</span>' : ''}
    <h1>${esc(n.titulo)}</h1>
    ${n.resumen ? `<p class="pn-article-lead">${esc(n.resumen)}</p>` : ''}
    <p class="pn-article-meta">${meta}</p>
  </header>
  ${n.imagen ? `<img class="pn-hero-img" src="${escUrl(n.imagen)}" alt="">` : ''}
  <div class="pn-prose">${parrafos(n.contenido)}</div>
  <div class="pn-article-foot">
    <a class="btn btn-ghost btn-sm" href="/noticias">← Todas las noticias</a>
    ${shareBar([{ label: 'Compartir', href: `/noticias/${n.id}` }])}
  </div>
</article>`;
}

/* ------------------------------- Fotos ------------------------------- */

/** Listado público de galerías publicadas. */
export function fotosListBody(galerias: (Galeria & { portadaEfectiva?: string; total?: number })[]): string {
  const head = cabecera('Portal informativo', 'Fotos', 'Las mejores imágenes de cada fecha.');
  if (galerias.length === 0) {
    return `${head}<section class="block">${emptyNote('Todavía no hay galerías publicadas')}</section>`;
  }
  const cards = galerias
    .map((g) => {
      const portada = g.portada || g.portadaEfectiva || '';
      const media = portada
        ? `<span class="pf-media"><img src="${escUrl(portada)}" alt="" loading="lazy"></span>`
        : '<span class="pf-media pf-media-empty" aria-hidden="true"></span>';
      return `<a class="pf-card" href="/fotos/${g.id}">
  ${media}
  <div class="pf-body">
    <strong>${esc(g.titulo)}</strong>
    <span>${g.total ?? 0} foto${(g.total ?? 0) === 1 ? '' : 's'}${g.fecha ? ` · ${esc(formatDateShort(g.fecha))}` : ''}</span>
    ${g.descripcion ? `<p>${esc(g.descripcion)}</p>` : ''}
    <span class="pf-more">Ver la galería →</span>
  </div>
</a>`;
    })
    .join('');
  return `${head}<section class="pf-grid">${cards}</section>`;
}

/** Página pública de una galería (solo publicada). */
export function galeriaBody(g: Galeria, imagenes: ImagenGaleria[]): string {
  const sub = [g.fecha ? esc(formatDateLong(g.fecha)) : '', g.descripcion ? esc(g.descripcion) : ''].filter(Boolean).join(' · ');
  const head = cabecera('Fotos', g.titulo, sub, g.portada);
  if (imagenes.length === 0) {
    return `${head}<section class="block">${emptyNote('Esta galería todavía no tiene fotos')}</section>`;
  }
  const figs = imagenes
    .map(
      (img) => `<figure class="pf-fig">
  <a href="${escUrl(img.url)}" target="_blank" rel="noopener"><img src="${escUrl(img.url)}" alt="${esc(img.caption || '')}" loading="lazy"></a>
  ${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}
</figure>`
    )
    .join('');
  return `${head}<section class="pf-figs">${figs}</section>
<div class="pn-article-foot"><a class="btn btn-ghost btn-sm" href="/fotos">← Todas las galerías</a></div>`;
}

/* ---------------------- Páginas: complejo / torneo ---------------------- */

/** Cuerpo público de la página del complejo. */
export function complejoBody(pagina: PaginaContenido | null): string {
  const sinDatos = cabecera('Portal informativo', 'El complejo', 'Dónde jugamos, cómo llegar y todo lo que necesitás saber.');
  if (!pagina || pagina.status !== 'published') {
    return `${sinDatos}<section class="block">${emptyNote('La información del complejo está en preparación')}</section>`;
  }
  const d = pagina.data as ComplejoData;
  // La foto del complejo es el fondo de la cabecera: una sola imagen, no dos.
  const head = cabecera('Portal informativo', 'El complejo', d.nombre || 'Dónde jugamos, cómo llegar y todo lo que necesitás saber.', d.imagen);
  const instalaciones = (d.instalaciones ?? [])
    .filter((i) => i.nombre.trim())
    .map(
      (i) => `<div class="pp-inst"><strong>${esc(i.nombre)}</strong>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ''}</div>`
    )
    .join('');
  return `${head}
<section class="pp">
  ${d.nombre ? `<header class="pp-head"><h2>${esc(d.nombre)}</h2></header>` : ''}
  ${d.descripcion ? `<div class="pn-prose">${parrafos(d.descripcion)}</div>` : ''}
  <div class="px-datos">
    ${dato('Dirección', d.direccion, 'pin')}
    ${dato('Horarios', d.horarios, 'clock')}
    ${dato('Teléfono', d.telefono, 'phone')}
    ${dato('Cómo llegar', d.como_llegar, 'search')}
    ${dato('Información útil', d.info_util, 'list')}
  </div>
  ${d.whatsapp.trim() ? `<p class="pp-cta"><a class="btn btn-primary" href="https://wa.me/${esc(d.whatsapp.replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">Escribir por WhatsApp</a></p>` : ''}
  ${instalaciones ? `<section class="pp-block"><h3>Instalaciones</h3><div class="pp-inst-grid">${instalaciones}</div></section>` : ''}
</section>`;
}

/** Cuerpo público de la página de información del torneo. */
export function informacionBody(pagina: PaginaContenido | null): string {
  const sinDatos = cabecera('Portal informativo', 'Información del torneo', 'Todo lo que necesitás saber para jugar y para acompañar.');
  if (!pagina || pagina.status !== 'published') {
    return `${sinDatos}<section class="block">${emptyNote('La información del torneo está en preparación')}</section>`;
  }
  const d = pagina.data as TorneoData;
  const head = cabecera('Portal informativo', 'Información del torneo', d.presentacion || 'Todo lo que necesitás saber para jugar y para acompañar.');
  const documentos = (d.documentos ?? [])
    .filter((doc) => doc.titulo.trim() && doc.url.trim())
    .map((doc) => `<li><a href="${escUrl(doc.url)}" target="_blank" rel="noopener">${esc(doc.titulo)} ↗</a></li>`)
    .join('');
  return `${head}
<section class="pp">
  ${d.descripcion ? `<div class="pn-prose">${parrafos(d.descripcion)}</div>` : ''}
  <div class="px-datos">
    ${dato('Días de juego', d.dias_juego, 'calendar')}
    ${dato('Horarios habituales', d.horarios, 'clock')}
    ${dato('Contacto', d.contacto, 'users')}
  </div>
  ${d.info_equipos.trim() ? `<section class="pp-block"><h3>Información para equipos</h3><div class="pn-prose">${parrafos(d.info_equipos)}</div></section>` : ''}
  ${documentos ? `<section class="pp-block"><h3>Reglamento y documentos</h3><ul class="pp-docs">${documentos}</ul></section>` : ''}
  ${d.adicional.trim() ? `<section class="pp-block"><h3>Información adicional</h3><div class="pn-prose">${parrafos(d.adicional)}</div></section>` : ''}
</section>`;
}

/* --------------------------- Envíos con layout --------------------------- */

function page(title: string, active: string, body: string): string {
  return layout({ title, active, nav: PUBLIC_NAV, mas: PUBLIC_NAV_MAS, body });
}

export function noticiasListPage(noticias: Noticia[]): string {
  return page('Noticias — ZonaLiga', 'noticias', noticiasListBody(noticias));
}

export function noticiaPage(n: Noticia): string {
  return page(`${n.titulo} — ZonaLiga`, 'noticias', noticiaBody(n));
}

export function fotosListPage(galerias: (Galeria & { portadaEfectiva?: string; total?: number })[]): string {
  return page('Fotos — ZonaLiga', 'fotos', fotosListBody(galerias));
}

export function galeriaPage(g: Galeria, imagenes: ImagenGaleria[]): string {
  return page(`${g.titulo} — ZonaLiga`, 'fotos', galeriaBody(g, imagenes));
}

export function complejoPage(pagina: PaginaContenido | null): string {
  return page('El complejo — ZonaLiga', 'complejo', complejoBody(pagina));
}

export function informacionPage(pagina: PaginaContenido | null): string {
  return page('Información del torneo — ZonaLiga', 'informacion', informacionBody(pagina));
}