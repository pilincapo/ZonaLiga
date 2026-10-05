// Bloque de imagen para los formularios del panel del portal.
//
// Es un formulario propio (no un campo más del formulario principal): así la
// imagen se sube o se quita sin arriesgar que se pierda el texto que el
// usuario estaba escribiendo.
//
// Permite las dos cosas que conviven hoy en el portal:
//   · un enlace externo (compatibilidad con lo ya cargado en 18.2), y
//   · un archivo desde el dispositivo (Fase 18.3, guardado en R2).
//
// La validación real (tipo de imagen, tamaño, bytes) la hace el servidor.

import { esc, escUrl } from '../lib/html.ts';

export interface PortalFormImagenOpts {
  /** A dónde se envía este formulario (endpoint de imagen del recurso). */
  accionUrl: string;
  /** Clase CSS extra para diferenciar el bloque. */
  clase?: string;
  /** Tipo de archivo: nombra el campo del enlace externo. */
  tipoArchivo: string;
  /** Id del archivo ya subido, si hay (para mostrar el estado actual). */
  archivoId?: number | null;
  /** URL que hoy se está mostrando (enlace externo o URL del bucket). */
  urlActual: string | null;
  /** Si la imagen actual viene de un enlace externo. */
  esExterno?: boolean;
  /** Si se puede subir un archivo desde el dispositivo. */
  puedeSubir?: boolean;
  /** Texto del botón de carga. */
  labelCargar?: string;
  /** Ayuda bajo el campo de enlace. */
  help?: string;
}

export function portalFormImagen(opts: PortalFormImagenOpts): string {
  const clase = opts.clase ?? 'portal-img';
  const url = opts.urlActual ?? '';
  const badge = opts.esExterno ? 'enlace externo' : opts.archivoId ? 'subida al sitio' : '';

  const preview = url
    ? `<div class="${clase}__preview"><img src="${escUrl(url)}" alt="Imagen actual" loading="lazy">
         ${badge ? `<span class="${clase}__badge">${esc(badge)}</span>` : ''}</div>`
    : `<div class="${clase}__preview ${clase}__preview--empty" aria-hidden="true">
         <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2.4"/><circle cx="8.6" cy="8.6" r="1.7"/><path d="M20.5 18.5l-4.4-4.4" stroke-linecap="round"/></svg>
         <span>Sin imagen</span></div>`;

  return `
<form class="${clase}" method="post" action="${escUrl(opts.accionUrl)}" enctype="multipart/form-data">
  <h2 class="${clase}__title">Imagen</h2>
  ${preview}
  <div class="${clase}__campo">
    <label for="${clase}-url">Enlace de la imagen</label>
    <input type="url" id="${clase}-url" name="${esc(opts.tipoArchivo)}__url_externo" value="${escUrl(url)}" maxlength="2000" placeholder="https://…">
    <p class="hint">${esc(opts.help ?? 'Pegá el enlace de una imagen, o subí un archivo desde tu dispositivo.')}</p>
  </div>
  ${
    opts.puedeSubir
      ? `<div class="${clase}__campo">
    <label for="${clase}-file">Subir un archivo</label>
    <input type="file" id="${clase}-file" name="archivo" accept="image/jpeg,image/png,image/webp,image/gif">
    <p class="hint">JPG, PNG, WebP o GIF, hasta 8 MB.</p>
  </div>
  <div class="${clase}__acciones">
    <button class="btn btn-primary btn-sm" type="submit">Guardar imagen</button>
    <button class="btn btn-ghost btn-sm" type="submit" name="accion" value="quitar" onclick="return confirm('¿Quitar la imagen de esta noticia?')">Quitar imagen</button>
  </div>`
      : `<div class="${clase}__acciones">
    <button class="btn btn-primary btn-sm" type="submit">Guardar enlace</button>
  </div>`
  }
</form>`;
}