// Páginas públicas del portal informativo: Noticias, Fotos, El Complejo y
// Información del Torneo. Solo muestran contenido PUBLICADO (la capa de datos
// ya filtra); usan el layout común del sitio con su navegación.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort, formatDateLong } from '../lib/format.ts';
import { layout, emptyNote, shareBar } from './components.ts';
import { PUBLIC_NAV, PUBLIC_NAV_MAS } from './public.ts';
import { parrafos, type ComplejoData, type Galeria, type ImagenGaleria, type Noticia, type PaginaContenido, type TorneoData } from '../lib/portalContent.ts';

/* ------------------------------ Noticias ------------------------------ */

function noticiaCard(n: Noticia): string {
  const media = n.imagen
    ? `<a class="pn-media" href="/noticias/${n.id}"><img src="${escUrl(n.imagen)}" alt="" loading="lazy"></a>`
    : '<span class="pn-media pn-media-empty" aria-hidden="true">●</span>';
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

/** Listado público de noticias publicadas. */
export function noticiasListBody(noticias: Noticia[]): string {
  const head = `<section class="hero"><div class="hero-kicker">Portal informativo</div><h1>Noticias</h1><p class="hero-sub">Todo lo que pasa en la liga, contado al día.</p></section>`;
  if (noticias.length === 0) {
    return `${head}<section class="block">${emptyNote('Todavía no hay noticias publicadas')}</section>`;
  }
  return `${head}<section class="pn-grid">${noticias.map(noticiaCard).join('')}</section>`;
}

/** Página pública de una noticia (solo publicada). */
export function noticiaBody(n: Noticia): string {
  const media = n.imagen ? `<img class="pn-hero-img" src="${escUrl(n.imagen)}" alt="" loading="eager">` : '';
  const meta = [
    `<time>${esc(formatDateLong(n.published_at ?? ''))}</time>`,
    n.autor ? `<span>Por ${esc(n.autor)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<article class="pn-article">
  <header class="pn-article-head">
    <div class="pn-meta">${n.destacada ? '<span class="badge amber">Destacada</span>' : ''}<span>${meta}</span></div>
    <h1>${esc(n.titulo)}</h1>
    ${n.resumen ? `<p class="pn-article-lead">${esc(n.resumen)}</p>` : ''}
  </header>
  ${media}
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
  const head = `<section class="hero"><div class="hero-kicker">Portal informativo</div><h1>Fotos</h1><p class="hero-sub">Las mejores imágenes de cada fecha.</p></section>`;
  if (galerias.length === 0) {
    return `${head}<section class="block">${emptyNote('Todavía no hay galerías publicadas')}</section>`;
  }
  const cards = galerias
    .map((g) => {
      const portada = g.portada || g.portadaEfectiva || '';
      const media = portada
        ? `<span class="pf-media"><img src="${escUrl(portada)}" alt="" loading="lazy"></span>`
        : '<span class="pf-media pf-media-empty" aria-hidden="true">▣</span>';
      return `<a class="pf-card" href="/fotos/${g.id}">
  ${media}
  <div class="pf-body">
    <strong>${esc(g.titulo)}</strong>
    <span>${g.total ?? 0} foto${(g.total ?? 0) === 1 ? '' : 's'}${g.fecha ? ` · ${esc(formatDateShort(g.fecha))}` : ''}</span>
    ${g.descripcion ? `<p>${esc(g.descripcion)}</p>` : ''}
  </div>
</a>`;
    })
    .join('');
  return `${head}<section class="pf-grid">${cards}</section>`;
}

/** Página pública de una galería (solo publicada). */
export function galeriaBody(g: Galeria, imagenes: ImagenGaleria[]): string {
  const head = `<section class="hero">
  <div class="hero-kicker">Fotos</div>
  <h1>${esc(g.titulo)}</h1>
  <p class="hero-sub">${[g.fecha ? esc(formatDateLong(g.fecha)) : '', g.descripcion ? esc(g.descripcion) : ''].filter(Boolean).join(' · ')}</p>
</section>`;
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

function dato(label: string, valor: string, icono?: string): string {
  if (!valor.trim()) return '';
  return `<div class="pp-field"><dt>${icono ? `<span aria-hidden="true">${icono}</span>` : ''}${esc(label)}</dt><dd>${parrafos(valor)}</dd></div>`;
}

/** Cuerpo público de la página del complejo. */
export function complejoBody(pagina: PaginaContenido | null): string {
  const head = `<section class="hero"><div class="hero-kicker">Portal informativo</div><h1>El complejo</h1><p class="hero-sub">Dónde jugamos, cómo llegar y todo lo que necesitás saber.</p></section>`;
  if (!pagina || pagina.status !== 'published') {
    return `${head}<section class="block">${emptyNote('La información del complejo está en preparación')}</section>`;
  }
  const d = pagina.data as ComplejoData;
  const hero = d.imagen ? `<img class="pp-hero-img" src="${escUrl(d.imagen)}" alt="">` : '';
  const instalaciones = (d.instalaciones ?? [])
    .filter((i) => i.nombre.trim())
    .map(
      (i) => `<div class="pp-inst"><strong>${esc(i.nombre)}</strong>${i.detalle ? `<span>${esc(i.detalle)}</span>` : ''}</div>`
    )
    .join('');
  return `<section class="pp">
  ${hero}
  ${d.nombre || d.descripcion ? `<header class="pp-head">${d.nombre ? `<h2>${esc(d.nombre)}</h2>` : ''}${d.descripcion ? `<div class="pn-prose">${parrafos(d.descripcion)}</div>` : ''}</header>` : ''}
  <dl class="pp-fields">
    ${dato('Dirección', d.direccion, '📍')}
    ${dato('Teléfono', d.telefono, '☎')}
    ${dato('Horarios', d.horarios, '🕒')}
    ${dato('Cómo llegar', d.como_llegar, '🚌')}
    ${dato('Información útil', d.info_util, 'ℹ')}
  </dl>
  ${d.whatsapp.trim() ? `<p class="pp-cta"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/${esc(d.whatsapp.replace(/[^0-9]/g, ''))}">Escribir por WhatsApp</a></p>` : ''}
  ${instalaciones ? `<section class="pp-block"><h3>Instalaciones</h3><div class="pp-inst-grid">${instalaciones}</div></section>` : ''}
</section>`;
}

/** Cuerpo público de la página de información del torneo. */
export function informacionBody(pagina: PaginaContenido | null): string {
  const head = `<section class="hero"><div class="hero-kicker">Portal informativo</div><h1>Información del torneo</h1><p class="hero-sub">Todo lo que necesitás saber para jugar y para acompañar.</p></section>`;
  if (!pagina || pagina.status !== 'published') {
    return `${head}<section class="block">${emptyNote('La información del torneo está en preparación')}</section>`;
  }
  const d = pagina.data as TorneoData;
  const documentos = (d.documentos ?? [])
    .filter((doc) => doc.titulo.trim() && doc.url.trim())
    .map((doc) => `<li><a href="${escUrl(doc.url)}" target="_blank" rel="noopener">${esc(doc.titulo)} ↗</a></li>`)
    .join('');
  return `<section class="pp">
  ${d.presentacion || d.descripcion ? `<header class="pp-head">${d.presentacion ? `<p class="pp-lead">${esc(d.presentacion)}</p>` : ''}${d.descripcion ? `<div class="pn-prose">${parrafos(d.descripcion)}</div>` : ''}</header>` : ''}
  <dl class="pp-fields">
    ${dato('Días de juego', d.dias_juego, '📅')}
    ${dato('Horarios habituales', d.horarios, '🕒')}
    ${dato('Contacto', d.contacto, '☎')}
  </dl>
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
