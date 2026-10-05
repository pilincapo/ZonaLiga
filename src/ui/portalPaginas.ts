// Pantallas administrativas de las páginas editoriales: El Complejo y
// Información del Torneo. Formularios simples (campos + filas repetibles),
// sin convertirlo en un CMS complejo.

import { esc, escUrl } from '../lib/html.ts';
import type { ComplejoData, PaginaContenido, TorneoData } from '../lib/portalContent.ts';
import { portalAdminPage } from './portalAdmin.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';

type Perms = ReadonlySet<PortalPermission>;

/** Formulario de El Complejo. */
export function complejoFormPage(
  pagina: PaginaContenido | null,
  permissions: Perms,
  opts: { err?: string; msg?: string; contentExtra?: string } = {}
): string {
  const data = (pagina?.data ?? { instalaciones: [] }) as ComplejoData;
  const instalaciones = (data.instalaciones ?? [])
    .map(
      (inst, i) => `<div class="portal-repeat-row" data-fila>
  <div class="field" style="margin:0"><label${i === 0 ? ' for="inst-nombre"' : ''}>Nombre</label><input type="text" name="inst_nombre" maxlength="120" value="${esc(inst.nombre)}" placeholder="Ej: Cancha 5"></div>
  <div class="field" style="margin:0"><label${i === 0 ? ' for="inst-detalle"' : ''}>Detalle</label><input type="text" name="inst_detalle" maxlength="300" value="${esc(inst.detalle)}" placeholder="Ej: césped sintético, iluminada"></div>
  <button class="btn btn-ghost btn-sm" type="button" data-quitar>Quitar</button>
</div>`
    )
    .join('');

  const content = `
<section class="card form-card" style="max-width:760px"><div class="card-body">
  <form method="post" action="/portal-admin/complejo">
    <div class="field">
      <label for="nombre">Nombre</label>
      <input type="text" id="nombre" name="nombre" maxlength="160" value="${esc(data.nombre)}" placeholder="Ej: Complejo Deportivo ZonaLiga">
    </div>
    <div class="field">
      <label for="descripcion">Descripción</label>
      <textarea id="descripcion" name="descripcion" rows="3" maxlength="4000" placeholder="Qué es el complejo, para qué sirve…">${esc(data.descripcion)}</textarea>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="direccion">Dirección</label>
        <input type="text" id="direccion" name="direccion" maxlength="300" value="${esc(data.direccion)}" placeholder="Ej: Av. Siempreviva 742">
      </div>
      <div class="field">
        <label for="telefono">Teléfono</label>
        <input type="text" id="telefono" name="telefono" maxlength="60" value="${esc(data.telefono)}" placeholder="Ej: 11 4444-5555">
      </div>
      <div class="field">
        <label for="whatsapp">WhatsApp</label>
        <input type="text" id="whatsapp" name="whatsapp" maxlength="60" value="${esc(data.whatsapp)}" placeholder="Ej: 5491144445555">
        <p class="hint">Solo números con código de país, para armar el enlace de WhatsApp.</p>
      </div>
    </div>
    <div class="field">
      <label for="horarios">Horarios</label>
      <textarea id="horarios" name="horarios" rows="2" maxlength="1000" placeholder="Ej: Lunes a viernes de 9 a 23, sábados de 8 a 20">${esc(data.horarios)}</textarea>
    </div>
    <div class="field">
      <label for="como_llegar">Cómo llegar</label>
      <textarea id="como_llegar" name="como_llegar" rows="2" maxlength="2000" placeholder="Referencias, líneas de colectivo, estacionamiento…">${esc(data.como_llegar)}</textarea>
    </div>
    <div class="field">
      <label for="info_util">Información útil</label>
      <textarea id="info_util" name="info_util" rows="3" maxlength="4000" placeholder="Reglas del complejo, qué llevar, contacto de emergencias…">${esc(data.info_util)}</textarea>
    </div>

    <h2 style="font-size:1rem;margin:18px 0 6px">Instalaciones</h2>
    <p class="hint" style="margin-bottom:8px">Canchas y espacios del complejo. Podés sumar las que necesites.</p>
    <div data-filas>
      ${instalaciones}
      <div class="portal-repeat-row" data-fila hidden data-plantilla>
        <div class="field" style="margin:0"><label>Nombre</label><input type="text" name="inst_nombre" maxlength="120" placeholder="Ej: Cancha 5"></div>
        <div class="field" style="margin:0"><label>Detalle</label><input type="text" name="inst_detalle" maxlength="300" placeholder="Ej: césped sintético, iluminada"></div>
        <button class="btn btn-ghost btn-sm" type="button" data-quitar>Quitar</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" type="button" data-agregar style="margin-top:8px">+ Agregar instalación</button>

    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
      <button class="btn btn-primary" type="submit" name="status" value="published">${pagina?.status === 'published' ? 'Guardar y publicar' : 'Publicar'}</button>
      <button class="btn btn-ghost" type="submit" name="status" value="draft">Guardar borrador</button>
      <a class="btn btn-ghost" href="/portal-admin">Volver</a>
      <a class="btn btn-ghost" href="/portal-admin/complejo/vista-previa" target="_blank" rel="noopener">Vista previa</a>
    </div>
    <p class="hint" style="margin-top:10px">${pagina?.status === 'published' ? 'La página está publicada: los cambios se ven en el sitio en unos segundos.' : 'Mientras sea borrador, la página pública muestra un aviso de que la información está en preparación.'}</p>
  </form>
</div></section>
${opts.contentExtra ? `<div class="card form-card" style="max-width:760px;margin-top:16px"><div class="card-body">${opts.contentExtra}</div></div>` : ''}
${REPEAT_SCRIPT}`;

  return portalAdminPage('complejo', permissions, { content, msg: opts.msg, err: opts.err });
}

/** Formulario de Información del Torneo (solo editorial). */
export function torneoFormPage(
  pagina: PaginaContenido | null,
  permissions: Perms,
  opts: { err?: string; msg?: string } = {}
): string {
  const data = (pagina?.data ?? { documentos: [] }) as TorneoData;
  const documentos = (data.documentos ?? [])
    .map(
      (doc, i) => `<div class="portal-repeat-row" data-fila>
  <div class="field" style="margin:0"><label${i === 0 ? ' for="doc-titulo"' : ''}>Título</label><input type="text" name="doc_titulo" maxlength="160" value="${esc(doc.titulo)}" placeholder="Ej: Reglamento 2026"></div>
  <div class="field" style="margin:0"><label${i === 0 ? ' for="doc-url"' : ''}>Enlace</label><input type="url" name="doc_url" maxlength="2000" value="${escUrl(doc.url)}" placeholder="https://…"></div>
  <button class="btn btn-ghost btn-sm" type="button" data-quitar>Quitar</button>
</div>`
    )
    .join('');

  const content = `
<section class="card form-card" style="max-width:760px"><div class="card-body">
  <div class="warning-box" style="margin-bottom:14px">Esta página es <strong>solo informativa</strong>: los equipos, fechas y resultados salen del fixture y de las tablas, que no se tocan desde acá.</div>
  <form method="post" action="/portal-admin/torneo">
    <div class="field">
      <label for="presentacion">Presentación</label>
      <textarea id="presentacion" name="presentacion" rows="3" maxlength="4000" placeholder="Un párrafo para recibir a los equipos y al público">${esc(data.presentacion)}</textarea>
    </div>
    <div class="field">
      <label for="descripcion">Descripción</label>
      <textarea id="descripcion" name="descripcion" rows="4" maxlength="8000" placeholder="Cómo es el torneo, quién organiza, de qué se trata">${esc(data.descripcion)}</textarea>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="dias_juego">Días de juego</label>
        <input type="text" id="dias_juego" name="dias_juego" maxlength="1000" value="${esc(data.dias_juego)}" placeholder="Ej: sábados y domingos">
      </div>
      <div class="field">
        <label for="horarios">Horarios habituales</label>
        <input type="text" id="horarios" name="horarios" maxlength="1000" value="${esc(data.horarios)}" placeholder="Ej: 9:00, 11:00 y 16:00">
      </div>
    </div>
    <div class="field">
      <label for="info_equipos">Información para equipos</label>
      <textarea id="info_equipos" name="info_equipos" rows="3" maxlength="4000" placeholder="Inscripciones, entregas, permisos, qué llevar el día del partido…">${esc(data.info_equipos)}</textarea>
    </div>
    <div class="field">
      <label for="contacto">Contacto</label>
      <textarea id="contacto" name="contacto" rows="2" maxlength="600" placeholder="Teléfono, correo o WhatsApp de la organización">${esc(data.contacto)}</textarea>
    </div>

    <h2 style="font-size:1rem;margin:18px 0 6px">Reglamento y documentos</h2>
    <p class="hint" style="margin-bottom:8px">Enlaces a reglamentos, formularios o cualquier documento para descargar.</p>
    <div data-filas>
      ${documentos}
      <div class="portal-repeat-row" data-fila hidden data-plantilla>
        <div class="field" style="margin:0"><label>Título</label><input type="text" name="doc_titulo" maxlength="160" placeholder="Ej: Reglamento 2026"></div>
        <div class="field" style="margin:0"><label>Enlace</label><input type="url" name="doc_url" maxlength="2000" placeholder="https://…"></div>
        <button class="btn btn-ghost btn-sm" type="button" data-quitar>Quitar</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" type="button" data-agregar style="margin-top:8px">+ Agregar documento</button>

    <div class="field" style="margin-top:18px">
      <label for="adicional">Información adicional</label>
      <textarea id="adicional" name="adicional" rows="3" maxlength="4000" placeholder="Cualquier otra cosa que quieras contar">${esc(data.adicional)}</textarea>
    </div>

    <div class="btn-row" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit" name="status" value="published">${pagina?.status === 'published' ? 'Guardar y publicar' : 'Publicar'}</button>
      <button class="btn btn-ghost" type="submit" name="status" value="draft">Guardar borrador</button>
      <a class="btn btn-ghost" href="/portal-admin">Volver</a>
      <a class="btn btn-ghost" href="/portal-admin/torneo/vista-previa" target="_blank" rel="noopener">Vista previa</a>
    </div>
    <p class="hint" style="margin-top:10px">${pagina?.status === 'published' ? 'La página está publicada: los cambios se ven en el sitio en unos segundos.' : 'Mientras sea borrador, la página pública muestra un aviso de que la información está en preparación.'}</p>
  </form>
</div></section>
${REPEAT_SCRIPT}`;

  return portalAdminPage('torneo', permissions, { content, msg: opts.msg, err: opts.err });
}

/**
 * JS mínimo de las filas repetibles (instalaciones / documentos): clonar la
 * plantilla vacía y quitar filas. Sin dependencias; si no hay JS, el formulario
 * igual funciona con las filas ya cargadas.
 */
const REPEAT_SCRIPT = `<script>
(function () {
  document.querySelectorAll('[data-filas]').forEach(function (cont) {
    var plantilla = cont.querySelector('[data-plantilla]');
    var agregar = cont.parentElement.querySelector('[data-agregar]');
    if (agregar && plantilla) {
      agregar.addEventListener('click', function () {
        var fila = plantilla.cloneNode(true);
        fila.removeAttribute('hidden');
        fila.removeAttribute('data-plantilla');
        cont.appendChild(fila);
        var primero = fila.querySelector('input');
        if (primero) primero.focus();
      });
    }
    cont.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-quitar]');
      if (!btn) return;
      var fila = btn.closest('[data-fila]');
      if (fila && !fila.hasAttribute('data-plantilla')) fila.remove();
    });
  });
})();
</script>`;
