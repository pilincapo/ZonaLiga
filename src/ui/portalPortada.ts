// Bloques del portal en la portada pública (`/`).
//
// La portada es la página que más se visita del sitio: por eso no muestra
// "todo", muestra lo que el hincha mira primero. En este orden:
//
//   1. Hero con la foto del complejo e identidad ZonaLiga.
//   2. Noticias destacadas (la principal y las elegidas en Destacados).
//   3. Próximos partidos, últimos resultados y posiciones (los arma public.ts).
//   4. Últimas fotos.
//   5. El complejo.
//   6. Información del torneo.
//
// Cada bloque sólo aparece si hay contenido publicado: no hay secciones vacías
// ni textos de relleno. Lo que el usuario elige en /portal-admin/destacados es
// lo que manda; si no eligió nada, se muestran las últimas noticias y fotos.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import { icon } from './icons.ts';
import type { DatosPortada } from '../lib/portalPortada.ts';
import type { ComplejoData, TorneoData } from '../lib/portalContent.ts';
import type { Tournament } from '../lib/types.ts';

const FORMATOS: Record<string, string> = {
  round_robin: 'Todos contra todos',
  zonas_playoffs: 'Zonas + playoffs',
  copa: 'Copa por eliminación',
};

/* --------------------------------- Hero --------------------------------- */

/**
 * Cabecera de la portada. Usa la imagen configurada para el portal; si no hay,
 * la foto del complejo; si tampoco, el fondo oscuro de marca. Encima va el
 * nombre del portal, su descripción y el torneo que se está jugando.
 */
export function heroPortada(datos: DatosPortada, t: Tournament | null): string {
  const cfg = datos.config;
  const nombre = cfg?.nombre?.trim() || 'ZonaLiga';
  const descripcion =
    cfg?.descripcion?.trim() ||
    (t
      ? `Fixture, resultados, posiciones y fotos de ${t.name}, siempre al día.`
      : 'Fixture, resultados, posiciones y fotos de la liga amateur, siempre al día.');
  // Fondo: primero la imagen principal del portal, si está habilitada; si no,
  // la foto del complejo; si tampoco hay, el fondo navy de marca.
  const foto = (datos.identidad.hero || datos.complejo?.imagen || '').trim();
  const estilo = foto ? ` style="--ph-foto:url('${escUrl(foto)}')"` : '';
  const torneo = t
    ? `<div class="ph-hero__torneo">
  <span class="ph-hero__torneo-label">Torneo actual</span>
  <strong>${esc(t.name)}</strong>
  <span>${[t.season ? `Temporada ${esc(t.season)}` : '', FORMATOS[t.format] ? esc(FORMATOS[t.format]!) : '']
    .filter(Boolean)
    .join(' · ')}</span>
</div>`
    : '';

  return `<section class="ph-hero${foto ? ' ph-hero--foto' : ''}"${estilo}>
  <div class="ph-hero__inner">
    <p class="ph-hero__kicker">Liga amateur · fútbol de barrio</p>
    <h1>${datos.identidad.logo ? `<img class="ph-hero__logo" src="${escUrl(datos.identidad.logo)}" alt="">` : ''}${esc(nombre)}</h1>
    <p class="ph-hero__sub">${esc(descripcion)}</p>
    ${torneo}
    <form class="search-bar ph-hero__search" action="/buscar" method="get" role="search">
      <span class="search-icon">${icon('search', 20)}</span>
      <input type="search" name="q" placeholder="Buscar equipo, jugador o torneo…" aria-label="Buscar" required>
      <button class="btn btn-primary" type="submit">Buscar</button>
    </form>
  </div>
</section>`;
}

/* ------------------------------ Noticias ------------------------------ */

function noticiaMini(n: { id: number; titulo: string; resumen: string; imagen: string; published_at: string | null }): string {
  const imagen = n.imagen
    ? `<span class="ph-news__media"><img src="${escUrl(n.imagen)}" alt="" loading="lazy"></span>`
    : '';
  return `<a class="ph-news ph-news--mini" href="/noticias/${n.id}">
  ${imagen}
  <span class="ph-news__body">
    <time>${esc(formatDateShort(n.published_at ?? ''))}</time>
    <strong>${esc(n.titulo)}</strong>
    ${n.resumen ? `<span class="ph-news__resumen">${esc(n.resumen)}</span>` : ''}
  </span>
</a>`;
}

function noticiaPrincipal(n: { id: number; titulo: string; resumen: string; contenido: string; imagen: string; published_at: string | null; autor: string }): string {
  return `<article class="ph-news ph-news--hero">
  ${
    n.imagen
      ? `<a class="ph-news__media" href="/noticias/${n.id}"><img src="${escUrl(n.imagen)}" alt="" loading="eager"></a>`
      : ''
  }
  <div class="ph-news__body">
    <p class="ph-news__kicker">${icon('bolt', 14)} Noticia principal</p>
    <h2><a href="/noticias/${n.id}">${esc(n.titulo)}</a></h2>
    ${n.resumen ? `<p class="ph-news__resumen">${esc(n.resumen)}</p>` : ''}
    <p class="ph-news__meta">
      <time>${esc(formatDateShort(n.published_at ?? ''))}</time>${n.autor ? `<span>Por ${esc(n.autor)}</span>` : ''}
    </p>
    <a class="ph-news__leer" href="/noticias/${n.id}">Leer la nota →</a>
  </div>
</article>`;
}

/** Noticias destacadas: la principal de la portada y las elegidas. */
export function bloqueNoticias(datos: DatosPortada): string {
  const hero = datos.hero;
  const resto = datos.noticias.filter((n) => n.id !== hero?.id).slice(0, 3);
  if (!hero && resto.length === 0) return '';

  const principal = hero ? noticiaPrincipal(hero) : '';
  const secundarias = resto.map(noticiaMini).join('');

  return `<section class="block">
  <div class="ph-head">
    <div>
      <h2>Noticias</h2>
      <p class="ph-head__sub">Lo último de la liga, contado al día.</p>
    </div>
    <a class="ph-head__more" href="/noticias">Todas las noticias →</a>
  </div>
  <div class="ph-news-grid${principal ? '' : ' ph-news-grid--only'}">
    ${principal}
    <div class="ph-news__list">${secundarias}</div>
  </div>
</section>`;
}

/* -------------------------------- Fotos -------------------------------- */

/**
 * Una celda de "Últimas fotos": miniatura apaisada con el epígrafe y la fecha
 * debajo. La fecha sale de las galerías que la portada ya trajo (no es una
 * consulta nueva); si la foto viene de una galería que no está en esa lista,
 * simplemente no se muestra la fecha en lugar de inventar una.
 */
function fotoCelda(
  f: { id: number; gallery_id: number; url: string; caption: string },
  fechas: ReadonlyMap<number, string>
): string {
  const titulo = f.caption.trim();
  const fecha = fechas.get(f.gallery_id) ?? '';
  return `<a class="ph-foto" href="/fotos/${f.gallery_id}" title="${esc(titulo || 'Ver la galería')}">
  <span class="ph-foto__media"><img src="${escUrl(f.url)}" alt="${esc(titulo)}" loading="lazy"></span>
  ${titulo ? `<strong class="ph-foto__cap">${esc(titulo)}</strong>` : ''}
  ${fecha ? `<span class="ph-foto__date">${esc(fecha)}</span>` : ''}
</a>`;
}

/** Últimas fotos de las galerías publicadas. */
export function bloqueFotos(datos: DatosPortada): string {
  if (datos.config && !datos.config.mostrar_fotos) return '';
  if (datos.fotos.length === 0) return '';
  const fechas = new Map(
    datos.galerias.map((g) => [g.id, g.fecha ? formatDateShort(g.fecha) : ''] as const)
  );
  const celdas = datos.fotos.map((f) => fotoCelda(f, fechas)).join('');
  return `<section class="block">
  <div class="ph-head">
    <div>
      <h2>Últimas fotos</h2>
      <p class="ph-head__sub">Las imágenes de las últimas fechas.</p>
    </div>
    <a class="ph-head__more" href="/fotos">Ver todas las galerías →</a>
  </div>
  <div class="ph-fotos">${celdas}</div>
</section>`;
}

/* ------------------------------ Complejo ------------------------------ */

function resumen(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length <= max ? limpio : `${limpio.slice(0, max - 1).trimEnd()}…`;
}

/** El complejo: datos escuetos para que el hincha sepa dónde y cuándo juega. */
export function bloqueComplejo(datos: DatosPortada): string {
  const c: ComplejoData | null = datos.complejo;
  const cfg = datos.config;
  const nombre = c?.nombre?.trim() || '';
  const direccion = c?.direccion?.trim() || '';
  const horarios = c?.horarios?.trim() || '';
  const whatsapp = (c?.whatsapp || cfg?.whatsapp || '').replace(/[^0-9]/g, '');
  const telefono = c?.telefono?.trim() || cfg?.telefono?.trim() || '';
  const texto = c?.descripcion?.trim() || '';

  if (!nombre && !direccion && !horarios && !texto && !whatsapp && !telefono) return '';

  const dato = (label: string, valor: string, ico: Parameters<typeof icon>[0]) =>
    valor ? `<div class="ph-dato"><span class="ph-dato__ico" aria-hidden="true">${icon(ico, 17)}</span><span><strong>${esc(label)}</strong>${esc(valor)}</span></div>` : '';

  return `<section class="block">
  <div class="ph-complejo">
    <div class="ph-complejo__text">
      <p class="ph-complejo__kicker">${icon('pin', 15)} El complejo</p>
      <h2>${esc(nombre || 'Dónde jugamos')}</h2>
      ${texto ? `<p class="ph-complejo__desc">${esc(resumen(texto, 220))}</p>` : ''}
      <div class="ph-datos">
        ${dato('Dirección', direccion, 'pin')}
        ${dato('Horarios', resumen(horarios, 90), 'clock')}
        ${dato('Teléfono', telefono, 'whistle')}
      </div>
      <div class="ph-complejo__acciones">
        ${whatsapp ? `<a class="btn btn-primary btn-sm" href="https://wa.me/${esc(whatsapp)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}
        <a class="btn btn-outline btn-sm" href="/el-complejo">Ver el complejo →</a>
      </div>
    </div>
    ${
      c?.imagen
        ? `<div class="ph-complejo__foto"><img src="${escUrl(c.imagen)}" alt="" loading="lazy"></div>`
        : ''
    }
  </div>
</section>`;
}

/* ----------------------- Información del torneo ----------------------- */

/** Lo que hay que saber para jugar y para acompañar. */
export function bloqueInformacion(datos: DatosPortada): string {
  const d: TorneoData | null = datos.torneo;
  const presentacion = d?.presentacion?.trim() || '';
  const dias = d?.dias_juego?.trim() || '';
  const horarios = d?.horarios?.trim() || '';
  const contacto = d?.contacto?.trim() || '';
  const descripcion = d?.descripcion?.trim() || '';
  const extra = d?.adicional?.trim() || '';
  const documentos = (d?.documentos ?? []).filter((doc) => doc.titulo && doc.url);

  if (!presentacion && !descripcion && !dias && !horarios && !extra && documentos.length === 0) return '';

  const item = (titulo: string, texto: string, ico: Parameters<typeof icon>[0]) =>
    texto ? `<div class="ph-info-item"><span class="ph-info-item__ico" aria-hidden="true">${icon(ico, 16)}</span><div><strong>${esc(titulo)}</strong><p>${esc(resumen(texto, 200))}</p></div></div>` : '';

  return `<section class="block">
  <div class="ph-head">
    <div>
      <h2>Información del torneo</h2>
      <p class="ph-head__sub">Lo que hay que saber para jugar y para acompañar.</p>
    </div>
    <a class="ph-head__more" href="/informacion">Ver toda la información →</a>
  </div>
  <div class="card"><div class="card-body">
    ${presentacion ? `<p class="ph-info-lead">${esc(resumen(presentacion, 320))}</p>` : ''}
    <div class="ph-info-grid">
      ${item('Días de juego', dias, 'calendar')}
      ${item('Horarios habituales', horarios, 'clock')}
      ${item('Contacto', contacto, 'users')}
      ${item('Además', descripcion || extra, 'ball')}
    </div>
    ${
      documentos.length
        ? `<div class="ph-info-docs"><strong>Reglamento y documentos</strong><ul>${documentos
            .map((doc) => `<li><a href="${escUrl(doc.url)}" target="_blank" rel="noopener">${esc(doc.titulo)} ↗</a></li>`)
            .join('')}</ul></div>`
        : ''
    }
  </div></div>
</section>`;
}

/* -------------------------------- Pie -------------------------------- */

/** Pie del portal: el texto que carga el administrador y sus redes. */
function bloquePie(datos: DatosPortada): string {
  const cfg = datos.config;
  const pie = cfg?.pie?.trim() || '';
  const redes = [
    { href: cfg?.facebook ?? '', label: 'Facebook' },
    { href: cfg?.instagram ?? '', label: 'Instagram' },
    { href: cfg?.youtube ?? '', label: 'YouTube' },
    { href: cfg?.twitter ?? '', label: 'X (Twitter)' },
  ].filter((r) => r.href.trim() !== '');
  if (!pie && redes.length === 0) return '';

  return `<section class="block">
  <div class="card"><div class="card-body ph-pie">
    ${pie ? `<p>${esc(pie)}</p>` : ''}
    ${
      redes.length
        ? `<div class="ph-pie__redes"><span class="ph-pie__label">Seguinos en</span>${redes
            .map((r) => `<a href="${escUrl(r.href)}" target="_blank" rel="noopener">${esc(r.label)}</a>`)
            .join('')}</div>`
        : ''
    }
  </div></div>
</section>`;
}

/** Bloques del portal que van después del cuerpo deportivo (el bloque de
 * noticias se renderiza aparte, en homePage, antes del deportivo). */
export function bloquesPortada(datos: DatosPortada, t: Tournament | null): string {
  return [
    bloqueFotos(datos),
    bloqueComplejo(datos),
    bloqueInformacion(datos),
    bloquePie(datos),
  ]
    .filter(Boolean)
    .join('\n');
}