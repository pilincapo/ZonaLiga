// Pantalla de accesos: alta de usuarios propios del panel (Community Manager)
// y asignación de permisos, una por uno. Solo ve el ADMIN; un Community Manager
// no llega acá (la ruta no está en el mapa de permisos deportivos).

import { esc } from '../lib/html.ts';
import {
  PORTAL_PERMISSIONS,
  SPORTS_PERMISSIONS,
  SPORTS_PERMISSION_LABELS,
  type PanelPermission,
  type PortalPermission,
} from '../lib/portalAccess.ts';
import type { PanelUserView } from '../lib/users.ts';
import { adminLayout } from './admin.ts';

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

const PORTAL_LABELS: Record<PortalPermission, string> = {
  PORTAL_NOTICIAS: 'Noticias',
  PORTAL_FOTOS: 'Fotos',
  PORTAL_COMPLEJO: 'El complejo',
  PORTAL_TORNEO: 'Información del torneo',
  PORTAL_DESTACADOS: 'Destacados',
  PORTAL_CONFIGURACION: 'Configuración',
};

function checkboxes(checked: ReadonlySet<string>, name: string): string {
  const portal = PORTAL_PERMISSIONS.map(
    (p) => `<label class="accesos-check"><input type="checkbox" name="${name}" value="${p}"${checked.has(p) ? ' checked' : ''}> ${esc(PORTAL_LABELS[p])}</label>`
  ).join('');
  const sports = SPORTS_PERMISSIONS.map(
    (p) => `<label class="accesos-check"><input type="checkbox" name="${name}" value="${p}"${checked.has(p) ? ' checked' : ''}> ${esc(SPORTS_PERMISSION_LABELS[p])}</label>`
  ).join('');
  return `<div class="accesos-cols">
    <div><span class="accesos-col-t">Permisos del portal</span>${portal}</div>
    <div><span class="accesos-col-t">Permisos deportivos</span>${sports}</div>
  </div>`;
}

function chips(permissions: readonly PanelPermission[]): string {
  if (permissions.length === 0) return '<span class="muted small">Sin permisos asignados</span>';
  return permissions
    .map((p) => `<span class="badge ${p.startsWith('PORTAL_') ? 'green' : 'blue'}">${esc(p.startsWith('PORTAL_') ? `Portal ${PORTAL_LABELS[p as PortalPermission]}` : SPORTS_PERMISSION_LABELS[p as (typeof SPORTS_PERMISSIONS)[number]])}</span>`)
    .join(' ');
}

export async function accesosAdminPage(users: PanelUserView[], msg?: string, errMsg?: string): Promise<string> {
  const cards = users
    .map((u) => {
      const active = new Set<string>(u.permissions);
      return `<article class="card" data-usuario="${esc(u.username.toLowerCase())}" style="margin-bottom:14px">
  <div class="card-body">
    <div class="row-between" style="align-items:flex-start">
      <div>
        <strong>${esc(u.name || u.username)}</strong>
        <span class="muted small">@${esc(u.username)}</span>
        ${u.active ? '<span class="badge green">Activo</span>' : '<span class="badge ghost">Suspendido</span>'}
        <div style="margin-top:6px">${chips(u.permissions)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <form method="post" action="/admin/accesos/${u.id}/${u.active ? 'suspender' : 'activar'}">
          <button class="btn btn-ghost btn-sm" type="submit">${u.active ? 'Suspender' : 'Activar'}</button>
        </form>
        <form method="post" action="/admin/accesos/${u.id}/eliminar" onsubmit="return confirm('¿Eliminar el usuario? Sus permisos se borran también.')">
          <button class="btn btn-ghost btn-sm" type="submit">Eliminar</button>
        </form>
      </div>
    </div>
    <form method="post" action="/admin/accesos/${u.id}/permisos" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
      <p class="hint" style="margin-bottom:8px">Permisos actuales. Guardá sin tocar nada si no cambiás nada.</p>
      ${checkboxes(active, 'permission')}
      <button class="btn btn-primary btn-sm" type="submit" style="margin-top:10px">Guardar permisos</button>
    </form>
  </div>
</article>`;
    })
    .join('');

  const body = `
${flash('success', msg)}${flash('error', errMsg)}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Administración</span>
    <h1>Accesos del panel</h1>
    <p>Usuarios propios del panel. Cada persona ingresa con su usuario y contraseña, y ve solo lo que le asignaste.</p>
  </div>
</div>
<section class="block"><div class="card form-card"><div class="card-body">
  <h2 style="font-size:1rem;margin-bottom:10px">Crear usuario</h2>
  <form method="post" action="/admin/accesos">
    <div class="form-row">
      <div class="field">
        <label for="username">Usuario</label>
        <input type="text" id="username" name="username" required minlength="3" autocomplete="username" placeholder="Ej: maria.comunicacion">
        <p class="hint">Con esto ingresa. No es el correo: es el nombre que va a escribir.</p>
      </div>
      <div class="field">
        <label for="name">Nombre</label>
        <input type="text" id="name" name="name" placeholder="Ej: María Pérez">
      </div>
    </div>
    <div class="field">
      <label for="password">Contraseña</label>
      <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
      <p class="hint">Se guarda cifrada. Se puede suspender el usuario si se pierde.</p>
    </div>
    ${checkboxes(new Set(), 'permission')}
    <p class="hint">Sin permisos deportivos, este usuario solo llega a /portal-admin. Con un permiso deportivo, entra solo a esa sección de /admin.</p>
    <button class="btn btn-primary" type="submit" style="margin-top:12px">Crear usuario</button>
  </form>
</div></div></section>
<section class="block">
  <h2 style="font-size:1rem;margin-bottom:10px">Usuarios creados</h2>
  ${cards || '<div class="empty-note">Todavía no hay usuarios con cuenta propia. El administrador ingresa con la clave del panel, sin cuenta.</div>'}
</section>`;

  return adminLayout(null, { title: 'Accesos', active: 'accesos', body, help: 'ayuda' });
}
