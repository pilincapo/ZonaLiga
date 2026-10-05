// Pantalla de Destacados: qué noticia es la principal de la portada y qué
// noticias y galerías salen destacadas en ella.
//
// Sólo se puede destacar contenido que exista; la publicación se sigue
// decidiendo en cada sección (Noticias / Fotos), y despublicar algo lo saca de
// la portada automáticamente.

import { esc } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import type { Noticia, Galeria } from '../lib/portalContent.ts';
import type { Portada } from '../lib/portalConfig.ts';
import { portalAdminPage } from './portalAdmin.ts';
import { portalFormImagen } from './portalFormImagen.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

type Perms = ReadonlySet<PortalPermission>;

function estado(estadoTexto: 'draft' | 'published'): string {
  return estadoTexto === 'published'
    ? '<span class="badge green">Publicada</span>'
    : '<span class="badge amber">Borrador</span>';
}

/** Resumen de lo que quedó elegido, para verlo sin salir de la pantalla. */
function vistaPrevia(portada: Portada, hero: Noticia | null): string {
  return `<div class="destacados-preview">
  <div class="destacados-preview__hero">
    <span class="destacados-preview__label">Noticia principal</span>
    <strong>${hero ? esc(hero.titulo) : 'Ninguna (se muestra el Complejo)'}</strong>
  </div>
  <div class="destacados-preview__listas">
    <div><span class="destacados-preview__label">Noticias destacadas</span><strong>${portada.noticias_destacadas.length}</strong></div>
    <div><span class="destacados-preview__label">Galerías destacadas</span><strong>${portada.galerias_destacadas.length}</strong></div>
  </div>
  <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">Ver portada ↗</a>
</div>`;
}

export function destacadosPage(opts: {
  permisos: Perms;
  noticias: Noticia[];
  galerias: Galeria[];
  portada: Portada;
  msg?: string;
  err?: string;
}): string {
  const { permisos, noticias, galerias, portada } = opts;

  const noticiasPublicadas = noticias.filter((n) => n.status === 'published');
  const heroActual = noticiasPublicadas.find((n) => n.id === portada.noticia_hero_id) ?? null;

  const heroFila = noticiasPublicadas
    .map((n) => {
      const marcado = portada.noticia_hero_id === n.id;
      return `<label class="accesos-check">
  <input type="radio" name="noticia_hero_id" value="${n.id}"${marcado ? ' checked' : ''}>
  <span><strong>${esc(n.titulo)}</strong> <span class="muted small">${esc(formatDateShort(n.published_at ?? ''))}</span></span>
</label>`;
    })
    .join('');

  const checksNoticias = noticias
    .map((n) => {
      const marcado = portada.noticias_destacadas.includes(n.id);
      return `<label class="accesos-check">
  <input type="checkbox" name="destacadas" value="${n.id}"${marcado ? ' checked' : ''}${n.status === 'published' ? '' : ' disabled'}>
  <span>${esc(n.titulo)} ${estado(n.status)}</span>
</label>`;
    })
    .join('');

  const checksGalerias = galerias
    .map((g) => {
      const marcado = portada.galerias_destacadas.includes(g.id);
      return `<label class="accesos-check">
  <input type="checkbox" name="galerias" value="${g.id}"${marcado ? ' checked' : ''}${g.status === 'published' ? '' : ' disabled'}>
  <span>${esc(g.titulo)} ${estado(g.status)}</span>
</label>`;
    })
    .join('');

  const bloque = `
<div class="card form-card" style="max-width:820px"><div class="card-body">
  <form method="post" action="/portal-admin/destacados">
    <h2 class="form-title">Noticia principal</h2>
    <p class="hint">Es la que aparece más grande en la portada. Si no elegís ninguna, se muestra el Complejo.</p>
    <label class="accesos-check"><input type="radio" name="noticia_hero_id" value=""${portada.noticia_hero_id == null ? ' checked' : ''}> <span>Ninguna (portada con el Complejo)</span></label>
    ${heroFila || '<p class="hint">Todavía no hay noticias publicadas para destacar. Publicá una desde Noticias.</p>'}

    <h2 class="form-title" style="margin-top:22px">Noticias destacadas</h2>
    ${checksNoticias || '<p class="hint">Todavía no hay noticias.</p>'}

    <h2 class="form-title" style="margin-top:22px">Galerías destacadas</h2>
    ${checksGalerias || '<p class="hint">Todavía no hay galerías.</p>'}

    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
      <button class="btn btn-primary" type="submit">Guardar destacados</button>
      <a class="btn btn-ghost" href="/portal-admin">Volver al inicio</a>
    </div>
  </form>
</div></div>

<div class="card form-card" style="max-width:820px;margin-top:16px"><div class="card-body">
  <h2 class="form-title">Cómo queda la portada</h2>
  ${vistaPrevia(portada, heroActual)}
  <p class="hint">Lo que está en borrador no aparece en la portada, aunque quede tildado acá.</p>
</div></div>`;

  return portalAdminPage('destacados', permisos, {
    title: 'Destacados de la portada',
    detail: 'Elegí la noticia principal y lo que sale destacado en la portada del sitio.',
    content: bloque,
    msg: opts.msg,
    err: opts.err,
  });
}

/** Bloque de imagen de la configuración (imagen principal y logo). */
export function bloqueImagenConfig(
  tipo: 'config.hero' | 'config.logo',
  accionUrl: string,
  actual: { url: string; id: number } | null,
  titulo: string,
  ayuda: string
): string {
  return portalFormImagen({
    accionUrl,
    clase: 'portal-img',
    tipoArchivo: tipo,
    archivoId: actual?.id ?? null,
    urlActual: actual?.url || null,
    esExterno: false,
    puedeSubir: true,
    titulo,
    etiquetaQuitar: titulo.toLowerCase(),
    help: ayuda,
  });
}