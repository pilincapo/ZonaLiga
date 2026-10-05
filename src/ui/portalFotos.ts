// Pantallas administrativas de Fotos: listado de galerías, formulario de la
// galería y gestión de sus imágenes (agregar, ordenar, quitar).

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import type { Galeria, ImagenGaleria } from '../lib/portalContent.ts';
import { portalAdminPage } from './portalAdmin.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

type Perms = ReadonlySet<PortalPermission>;

function badge(estado: 'draft' | 'published'): string {
  return estado === 'published'
    ? '<span class="badge green">Publicada</span>'
    : '<span class="badge amber">Borrador</span>';
}

/** Listado de galerías. */
export function fotosListPage(
  galerias: (Galeria & { total?: number })[],
  permissions: Perms,
  opts: { msg?: string; err?: string } = {}
): string {
  const items = galerias
    .map((g) => {
      const acciones: string[] = [];
      acciones.push(`<a class="btn btn-ghost btn-sm" href="/portal-admin/fotos/${g.id}">Editar</a>`);
      acciones.push(
        g.status === 'published'
          ? `<form method="post" action="/portal-admin/fotos/${g.id}/despublicar"><button class="btn btn-ghost btn-sm" type="submit">Despublicar</button></form>`
          : `<form method="post" action="/portal-admin/fotos/${g.id}/publicar"><button class="btn btn-ghost btn-sm" type="submit">Publicar</button></form>`
      );
      acciones.push(`<a class="btn btn-ghost btn-sm" href="/portal-admin/fotos/${g.id}/vista-previa" target="_blank" rel="noopener">Vista previa</a>`);
      if (g.status === 'published') {
        acciones.push(`<a class="btn btn-ghost btn-sm" href="/fotos/${g.id}" target="_blank" rel="noopener">Ver en el sitio ↗</a>`);
      }
      acciones.push(
        `<form method="post" action="/portal-admin/fotos/${g.id}/eliminar" onsubmit="return confirm('¿Eliminar la galería y todas sus fotos? No se puede deshacer.')"><button class="btn btn-ghost btn-sm" type="submit">Eliminar</button></form>`
      );
      const miniatura = g.portada
        ? `<img class="portal-thumb" src="${escUrl(g.portada)}" alt="">`
        : '<span class="portal-thumb portal-thumb-empty" aria-hidden="true">▣</span>';
      return `<article class="portal-item">
  <div class="portal-item-main" style="display:flex;gap:12px;align-items:flex-start">
    ${miniatura}
    <div>
      <div class="portal-item-title">${esc(g.titulo)} ${badge(g.status)}</div>
      <div class="portal-item-meta">
        <span>${g.total ?? 0} foto${(g.total ?? 0) === 1 ? '' : 's'}</span>
        ${g.fecha ? `<span>${esc(formatDateShort(g.fecha))}</span>` : '<span class="muted">Sin fecha</span>'}
      </div>
      ${g.descripcion ? `<p class="portal-item-resume">${esc(g.descripcion)}</p>` : ''}
    </div>
  </div>
  <div class="portal-item-actions">${acciones.join('')}</div>
</article>`;
    })
    .join('');

  const contenido = `
<div class="portal-toolbar">
  <a class="btn btn-primary" href="/portal-admin/fotos/nueva">+ Nueva galería</a>
  <a class="btn btn-ghost" href="/fotos" target="_blank" rel="noopener">Ver en el sitio ↗</a>
</div>
${items || '<div class="portal-placeholder"><span class="portal-placeholder-mark" aria-hidden="true">▣</span><div><strong>Todavía no hay galerías</strong><p>Creá la primera con el botón de arriba.</p></div></div>'}`;

  return portalAdminPage('fotos', permissions, { content: contenido, msg: opts.msg, err: opts.err });
}

/** Formulario de la galería + sus imágenes. */
export function galeriaFormPage(
  galeria: Galeria | null,
  imagenes: ImagenGaleria[],
  permissions: Perms,
  opts: { valores?: Record<string, unknown>; err?: string; msg?: string } = {}
): string {
  const v = opts.valores;
  const val = (campo: string, actual: string): string =>
    v && typeof v[campo] === 'string' ? esc(String(v[campo])) : esc(actual);

  const meta = `
<section class="card form-card" style="max-width:760px"><div class="card-body">
  <h2 style="font-size:1rem;margin-bottom:10px">${galeria ? 'Datos de la galería' : 'Nueva galería'}</h2>
  <form method="post" action="${galeria ? `/portal-admin/fotos/${galeria.id}` : '/portal-admin/fotos'}">
    <div class="field">
      <label for="titulo">Título</label>
      <input type="text" id="titulo" name="titulo" required maxlength="160" value="${val('titulo', galeria?.titulo ?? '')}" placeholder="Ej: Fecha 6 en el Complejo">
    </div>
    <div class="field">
      <label for="descripcion">Descripción</label>
      <textarea id="descripcion" name="descripcion" rows="2" maxlength="600" placeholder="Qué se ve en esta galería">${val('descripcion', galeria?.descripcion ?? '')}</textarea>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="portada">Imagen de portada</label>
        <input type="url" id="portada" name="portada" maxlength="2000" value="${val('portada', galeria?.portada ?? '')}" placeholder="https://…">
        <p class="hint">Si no se carga, se usa la primera foto de la galería.</p>
      </div>
      <div class="field">
        <label for="fecha">Fecha</label>
        <input type="date" id="fecha" name="fecha" value="${val('fecha', galeria?.fecha ?? '')}">
      </div>
    </div>
    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit" name="status" value="published">${galeria?.status === 'published' ? 'Guardar y publicar' : 'Publicar'}</button>
      <button class="btn btn-ghost" type="submit" name="status" value="draft">Guardar borrador</button>
      <a class="btn btn-ghost" href="/portal-admin/fotos">Cancelar</a>
      ${galeria ? `<a class="btn btn-ghost" href="/portal-admin/fotos/${galeria.id}/vista-previa" target="_blank" rel="noopener">Vista previa</a>` : ''}
    </div>
  </form>
</div></section>`;

  // Las fotos se gestionan recién cuando la galería tiene id.
  let imagenesHtml = '';
  if (galeria) {
    const filas = imagenes
      .map(
        (img, i) => `<div class="portal-img-row">
  <img class="portal-thumb" src="${escUrl(img.url)}" alt="">
  <form class="portal-img-caption" method="post" action="/portal-admin/fotos/${galeria.id}/imagenes/${img.id}">
    <input type="url" name="url" value="${escUrl(img.url)}" required hidden>
    <input type="text" name="caption" maxlength="200" value="${esc(img.caption)}" placeholder="Pie de foto (opcional)" aria-label="Pie de foto">
    <button class="btn btn-ghost btn-sm" type="submit">Guardar pie</button>
  </form>
  <div class="portal-img-moves">
    <form method="post" action="/portal-admin/fotos/${galeria.id}/imagenes/${img.id}/mover" ${i === 0 ? 'hidden' : ''}>
      <input type="hidden" name="dir" value="up"><button class="btn btn-ghost btn-sm" type="submit" aria-label="Subir">↑</button>
    </form>
    <form method="post" action="/portal-admin/fotos/${galeria.id}/imagenes/${img.id}/mover" ${i === imagenes.length - 1 ? 'hidden' : ''}>
      <input type="hidden" name="dir" value="down"><button class="btn btn-ghost btn-sm" type="submit" aria-label="Bajar">↓</button>
    </form>
    <form method="post" action="/portal-admin/fotos/${galeria.id}/imagenes/${img.id}/eliminar" onsubmit="return confirm('¿Quitar esta foto de la galería?')">
      <button class="btn btn-ghost btn-sm" type="submit">Quitar</button>
    </form>
  </div>
</div>`
      )
      .join('');

    imagenesHtml = `
<section class="card" style="max-width:760px;margin-top:16px"><div class="card-body">
  <h2 style="font-size:1rem;margin-bottom:10px">Fotos (${imagenes.length})</h2>
  <form method="post" action="/portal-admin/fotos/${galeria.id}/imagenes" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
    <div class="field" style="flex:2;min-width:220px;margin:0">
      <label for="img-url">Nueva foto (enlace)</label>
      <input type="url" id="img-url" name="url" required maxlength="2000" placeholder="https://…">
    </div>
    <div class="field" style="flex:1;min-width:160px;margin:0">
      <label for="img-caption">Pie (opcional)</label>
      <input type="text" id="img-caption" name="caption" maxlength="200" placeholder="Ej: Gol del segundo tiempo">
    </div>
    <button class="btn btn-primary" type="submit">Agregar</button>
  </form>
  ${filas || '<p class="hint">Esta galería todavía no tiene fotos. Pegá el enlace de una imagen arriba para empezar.</p>'}
</div></section>`;
  }

  return portalAdminPage('fotos', permissions, {
    title: galeria ? 'Editar galería' : 'Nueva galería',
    detail: galeria
      ? 'Cargá las fotos, ordenalas con las flechas y publicá cuando esté lista.'
      : 'Creá la galería primero: después le agregás las fotos.',
    content: meta + imagenesHtml,
    msg: opts.msg,
    err: opts.err,
  });
}
