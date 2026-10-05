// Pantalla de Configuración del portal: identidad (nombre, descripción, imagen
// principal y logo), contacto (WhatsApp, teléfono), redes, texto del pie y qué
// secciones se muestran en la portada.
//
// Todo se valida en el servidor (src/lib/portalConfig.ts). Acá sólo el formulario.

import { esc } from '../lib/html.ts';
import type { PortalConfig } from '../lib/portalConfig.ts';
import { portalAdminPage } from './portalAdmin.ts';
import { bloqueImagenConfig } from './portalDestacados.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

type Perms = ReadonlySet<PortalPermission>;

function campo(
  id: string,
  label: string,
  valor: string,
  opts: { tipo?: string; ayuda?: string; placeholder?: string; maxlength?: number; required?: boolean } = {}
): string {
  const tipo = opts.tipo ?? 'text';
  if (tipo === 'textarea') {
    return `<div class="field">
  <label for="${id}">${esc(label)}</label>
  <textarea id="${id}" name="${id}" rows="2" maxlength="${opts.maxlength ?? 300}" placeholder="${esc(opts.placeholder ?? '')}">${esc(valor)}</textarea>
  ${opts.ayuda ? `<p class="hint">${esc(opts.ayuda)}</p>` : ''}
</div>`;
  }
  return `<div class="field">
  <label for="${id}">${esc(label)}</label>
  <input type="${tipo}" id="${id}" name="${id}" value="${esc(valor)}" maxlength="${opts.maxlength ?? 200}" placeholder="${esc(opts.placeholder ?? '')}"${opts.required ? ' required' : ''}>
  ${opts.ayuda ? `<p class="hint">${esc(opts.ayuda)}</p>` : ''}
</div>`;
}

export function configuracionPage(opts: {
  permisos: Perms;
  config: PortalConfig;
  hero: { url: string; id: number } | null;
  logo: { url: string; id: number } | null;
  bucketDisponible: boolean;
  msg?: string;
  err?: string;
}): string {
  const { config, bucketDisponible } = opts;

  const bloque = `
<div class="card form-card" style="max-width:820px"><div class="card-body">
  <form method="post" action="/portal-admin/configuracion">
    <h2 class="form-title">Identidad del portal</h2>
    ${campo('nombre', 'Nombre público', config.nombre, { required: true, maxlength: 80, placeholder: 'ZonaLiga' })}
    ${campo('descripcion', 'Descripción breve', config.descripcion, {
      tipo: 'textarea',
      maxlength: 300,
      placeholder: 'Una línea que se ve al compartir el sitio',
    })}

    <h2 class="form-title" style="margin-top:22px">Contacto</h2>
    ${campo('whatsapp', 'WhatsApp', config.whatsapp, { placeholder: '5491112345678', ayuda: 'Sólo números, con código de país y sin signos.' })}
    ${campo('telefono', 'Teléfono', config.telefono, { placeholder: '011 1234-5678' })}

    <h2 class="form-title" style="margin-top:22px">Redes sociales</h2>
    ${campo('facebook', 'Facebook', config.facebook, { tipo: 'url', placeholder: 'https://facebook.com/…' })}
    ${campo('instagram', 'Instagram', config.instagram, { tipo: 'url', placeholder: 'https://instagram.com/…' })}
    ${campo('youtube', 'YouTube', config.youtube, { tipo: 'url', placeholder: 'https://youtube.com/@…' })}
    ${campo('twitter', 'X (Twitter)', config.twitter, { tipo: 'url', placeholder: 'https://x.com/…' })}
    <p class="hint">Los enlaces tienen que empezar con https://. Si los dejás vacíos, no se muestran.</p>

    <h2 class="form-title" style="margin-top:22px">Pie de página</h2>
    ${campo('pie', 'Texto del pie', config.pie, { tipo: 'textarea', placeholder: 'Ej: Liga barrial del barrio Norte' })}

    <h2 class="form-title" style="margin-top:22px">Qué se muestra</h2>
    <label class="accesos-check"><input type="checkbox" name="mostrar_hero"${config.mostrar_hero ? ' checked' : ''}> <span>Mostrar la imagen principal en la portada</span></label>
    <label class="accesos-check"><input type="checkbox" name="mostrar_fotos"${config.mostrar_fotos ? ' checked' : ''}> <span>Mostrar las últimas fotos en la portada</span></label>

    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
      <button class="btn btn-primary" type="submit" name="status" value="published">Guardar y publicar</button>
      <button class="btn btn-ghost" type="submit" name="status" value="draft">Guardar como borrador</button>
      <a class="btn btn-ghost" href="/" target="_blank" rel="noopener">Ver el sitio ↗</a>
    </div>
    <p class="hint" style="margin-top:10px">${
      config.status === 'published'
        ? 'La configuración está publicada: los cambios se ven en el sitio enseguida.'
        : 'Mientras sea borrador, el sitio sigue usando los textos que ya tenía.'
    }</p>
  </form>
</div></div>

<div style="display:grid;gap:16px;max-width:820px;margin-top:16px">
  ${
    bucketDisponible
      ? `${bloqueImagenConfig(
          'config.hero',
          '/portal-admin/configuracion/imagen?tipo=config.hero',
          opts.hero,
          'Imagen principal (portada)',
          'Se ve como fondo de la portada. Sin imagen, la portada usa la foto del complejo.'
        )}
        ${bloqueImagenConfig(
          'config.logo',
          '/portal-admin/configuracion/imagen?tipo=config.logo',
          opts.logo,
          'Logo del portal',
          'Aparece junto al nombre del portal en la portada. Si no lo subís, se muestra solo el nombre.'
        )}`
      : `<div class="card form-card"><div class="card-body">
    <h2 class="form-title">Imágenes del portal</h2>
    <p class="hint">Este sitio todavía no tiene habilitado el almacenamiento de archivos: la imagen principal y el logo se pueden dejar vacíos y el portal funciona igual con la foto del complejo.</p>
  </div></div>`
  }
</div>`;

  return portalAdminPage('configuracion', opts.permisos, {
    title: 'Configuración del portal',
    detail: 'Nombre, imágenes, contacto, redes y qué se muestra en la portada.',
    content: bloque,
    msg: opts.msg,
    err: opts.err,
  });
}