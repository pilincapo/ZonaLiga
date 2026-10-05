// Pantallas administrativas de Noticias: listado y formulario (alta/edición).

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import type { Noticia } from '../lib/portalContent.ts';
import { portalAdminPage } from './portalAdmin.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

type Perms = ReadonlySet<PortalPermission>;

function badge(estado: 'draft' | 'published'): string {
  return estado === 'published'
    ? '<span class="badge green">Publicada</span>'
    : '<span class="badge amber">Borrador</span>';
}

/** Listado: una tarjeta por noticia con sus acciones. */
export function noticiasListPage(noticias: Noticia[], permissions: Perms, opts: { msg?: string; err?: string } = {}): string {
  const items = noticias
    .map((n) => {
      const acciones: string[] = [];
      acciones.push(`<a class="btn btn-ghost btn-sm" href="/portal-admin/noticias/${n.id}">Editar</a>`);
      acciones.push(
        n.status === 'published'
          ? `<form method="post" action="/portal-admin/noticias/${n.id}/despublicar"><button class="btn btn-ghost btn-sm" type="submit">Despublicar</button></form>`
          : `<form method="post" action="/portal-admin/noticias/${n.id}/publicar"><button class="btn btn-ghost btn-sm" type="submit">Publicar</button></form>`
      );
      acciones.push(
        `<form method="post" action="/portal-admin/noticias/${n.id}/destacar"><button class="btn btn-ghost btn-sm" type="submit">${n.destacada ? 'Quitar destacada' : 'Destacar'}</button></form>`
      );
      acciones.push(`<a class="btn btn-ghost btn-sm" href="/portal-admin/noticias/${n.id}/vista-previa" target="_blank" rel="noopener">Vista previa</a>`);
      if (n.status === 'published') {
        acciones.push(`<a class="btn btn-ghost btn-sm" href="/noticias/${n.id}" target="_blank" rel="noopener">Ver en el sitio ↗</a>`);
      }
      acciones.push(
        `<form method="post" action="/portal-admin/noticias/${n.id}/eliminar" onsubmit="return confirm('¿Eliminar la noticia? No se puede deshacer.')"><button class="btn btn-ghost btn-sm" type="submit">Eliminar</button></form>`
      );
      return `<article class="portal-item">
  <div class="portal-item-main">
    <div class="portal-item-title">${esc(n.titulo)} ${badge(n.status)}${n.destacada ? ' <span class="badge blue">Destacada</span>' : ''}</div>
    <div class="portal-item-meta">
      ${n.published_at ? `<span>${esc(formatDateShort(n.published_at))}</span>` : '<span>Sin publicar</span>'}
      ${n.autor ? `<span>Por ${esc(n.autor)}</span>` : ''}
      ${n.imagen ? '<span>Con imagen</span>' : '<span class="muted">Sin imagen</span>'}
    </div>
    ${n.resumen ? `<p class="portal-item-resume">${esc(n.resumen)}</p>` : ''}
  </div>
  <div class="portal-item-actions">${acciones.join('')}</div>
</article>`;
    })
    .join('');

  const contenido = `
<div class="portal-toolbar">
  <a class="btn btn-primary" href="/portal-admin/noticias/nueva">+ Nueva noticia</a>
  <a class="btn btn-ghost" href="/noticias" target="_blank" rel="noopener">Ver en el sitio ↗</a>
</div>
${items || '<div class="portal-placeholder"><span class="portal-placeholder-mark" aria-hidden="true">✎</span><div><strong>Todavía no hay noticias</strong><p>Creá la primera con el botón de arriba.</p></div></div>'}`;

  return portalAdminPage('noticias', permissions, { content: contenido, msg: opts.msg, err: opts.err });
}

/** Formulario de alta o edición de una noticia. */
export function noticiaFormPage(
  noticia: Noticia | null,
  permissions: Perms,
  opts: { valores?: Record<string, unknown>; err?: string; contentExtra?: string } = {}
): string {
  const v = opts.valores;
  const val = (campo: string, actual: string): string =>
    v && typeof v[campo] === 'string' ? esc(String(v[campo])) : esc(actual);
  const contenido = v && typeof v['contenido'] === 'string' ? String(v['contenido']) : noticia?.contenido ?? '';
  const destacada = v
    ? v['destacada'] === 'on' || v['destacada'] === '1'
    : noticia?.destacada ?? false;

  const form = `
<section class="card form-card" style="max-width:760px"><div class="card-body">
  <form method="post" action="${noticia ? `/portal-admin/noticias/${noticia.id}` : '/portal-admin/noticias'}">
    <div class="field">
      <label for="titulo">Título</label>
      <input type="text" id="titulo" name="titulo" required maxlength="160" value="${val('titulo', noticia?.titulo ?? '')}" placeholder="Ej: Arranca la fecha 7 del Ascenso">
    </div>
    <div class="field">
      <label for="resumen">Resumen</label>
      <textarea id="resumen" name="resumen" rows="2" maxlength="300" placeholder="Una o dos líneas que se ven en el listado">${val('resumen', noticia?.resumen ?? '')}</textarea>
    </div>
    <div class="field">
      <label for="contenido">Contenido</label>
      <textarea id="contenido" name="contenido" rows="12" placeholder="El texto completo de la noticia">${esc(contenido)}</textarea>
      <p class="hint">Texto simple. Separá los párrafos con una línea en blanco; no se admite código HTML.</p>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="autor">Autor</label>
        <input type="text" id="autor" name="autor" maxlength="120" value="${val('autor', noticia?.autor ?? '')}" placeholder="Ej: Comunicación">
      </div>
      <div class="field">
        <label for="published_at">Fecha de publicación</label>
        <input type="date" id="published_at" name="published_at" value="${val('published_at', noticia?.published_at ?? '')}">
        <p class="hint">Si se publica hoy y queda vacía, se usa el día de hoy.</p>
      </div>
    </div>
    <label class="accesos-check" style="margin:6px 0 14px"><input type="checkbox" name="destacada"${destacada ? ' checked' : ''}> Marcar como destacada</label>
    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit" name="status" value="published">${noticia?.status === 'published' ? 'Guardar y publicar' : 'Publicar'}</button>
      <button class="btn btn-ghost" type="submit" name="status" value="draft">Guardar borrador</button>
      <a class="btn btn-ghost" href="/portal-admin/noticias">Cancelar</a>
      ${noticia ? `<a class="btn btn-ghost" href="/portal-admin/noticias/${noticia.id}/vista-previa" target="_blank" rel="noopener">Vista previa</a>` : ''}
    </div>
    <p class="hint" style="margin-top:10px">${noticia?.status === 'published' ? 'Esta noticia está publicada: los cambios se ven en el sitio en unos segundos.' : 'Mientras sea borrador, no se ve en el sitio público.'}</p>
  </form>
</div></section>
${opts.contentExtra ? `<div class="card form-card" style="max-width:760px;margin-top:16px"><div class="card-body">${opts.contentExtra}</div></div>` : ''}`;

  return portalAdminPage('noticias', permissions, {
    title: noticia ? 'Editar noticia' : 'Nueva noticia',
    detail: noticia ? 'Modificá el contenido y elegí si queda publicada o como borrador.' : 'Escribí la noticia: podés guardarla como borrador y publicarla cuando esté lista.',
    content: form,
    err: opts.err,
  });
}
