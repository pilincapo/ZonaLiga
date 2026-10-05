// Resumen del portal: la pantalla de entrada de /portal-admin.
//
// No es una lista de todo: es lo que hay que saber para arrancar el día. Cuántas
// noticias y galerías están publicadas y cuántas quedaron en borrador, qué está
// puesto como destacado en la portada, si la configuración del portal se publicó
// y cuántas imágenes hay subidas. Cada número lleva al lugar donde se arregla.

import { esc, escUrl } from '../lib/html.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';
import type { PortalConfig } from '../lib/portalConfig.ts';
import type { ResumenPortal } from '../lib/portalResumen.ts';
import { portalAdminPage } from './portalAdmin.ts';

type Perms = ReadonlySet<PortalPermission>;

interface Tile {
  label: string;
  valor: string;
  nota: string;
  href: string;
  permiso: PortalPermission;
  tono: 'green' | 'amber' | 'blue' | 'navy';
}

function tiles(r: ResumenPortal): Tile[] {
  return [
    {
      label: 'Noticias publicadas',
      valor: String(r.noticias.publicadas),
      nota: r.noticias.borradores > 0 ? `${r.noticias.borradores} en borrador` : 'No hay borradores',
      href: '/portal-admin/noticias',
      permiso: 'PORTAL_NOTICIAS',
      tono: 'green',
    },
    {
      label: 'Galerías publicadas',
      valor: String(r.galerias.publicadas),
      nota: `${r.galerias.fotos} foto${r.galerias.fotos === 1 ? '' : 's'} en total`,
      href: '/portal-admin/fotos',
      permiso: 'PORTAL_FOTOS',
      tono: 'blue',
    },
    {
      label: 'Imágenes del sitio',
      valor: String(r.archivos),
      nota: r.archivos > 0 ? 'Guardadas de forma privada' : 'Todavía no subiste ninguna',
      href: '/portal-admin/configuracion',
      permiso: 'PORTAL_CONFIGURACION',
      tono: 'navy',
    },
  ];
}

/** Atajos a las acciones más usadas, sólo de las secciones permitidas. */
function accesosRapidos(permisos: Perms): Array<{ href: string; label: string }> {
  const candidatos: Array<[PortalPermission, string, string]> = [
    ['PORTAL_NOTICIAS', '/portal-admin/noticias', 'Escribir una noticia'],
    ['PORTAL_FOTOS', '/portal-admin/fotos/nueva', 'Crear una galería'],
    ['PORTAL_COMPLEJO', '/portal-admin/complejo', 'Actualizar el complejo'],
    ['PORTAL_TORNEO', '/portal-admin/torneo', 'Información del torneo'],
    ['PORTAL_CONFIGURACION', '/portal-admin/configuracion', 'Configurar el portal'],
  ];
  return candidatos.filter(([p]) => permisos.has(p)).map(([, href, label]) => ({ href, label }));
}

/** Avisos concretos: qué está a medias y qué hay que mirar hoy. */
function pendientes(r: ResumenPortal, hero: { id: number; titulo: string; publicada: boolean } | null): string[] {
  const out: string[] = [];
  if (!r.config.publicada) {
    out.push('La configuración del portal está en borrador: el sitio sigue con los textos por defecto.');
  }
  if (!hero) {
    out.push('No hay noticia principal en la portada: se muestra la imagen del complejo.');
  } else if (!hero.publicada) {
    out.push(`La noticia principal (“${hero.titulo}”) está en borrador, así que no se ve en el sitio.`);
  }
  if (r.noticias.total === 0) out.push('Todavía no hay noticias: creá la primera.');
  if (r.galerias.total === 0) out.push('Todavía no hay galerías de fotos.');
  return out;
}

export function dashboardPage(opts: {
  permisos: Perms;
  resumen: ResumenPortal;
  hero: { id: number; titulo: string; publicada: boolean } | null;
  config: PortalConfig;
}): string {
  const { permisos, resumen, hero } = opts;
  const visibles = tiles(resumen).filter((t) => permisos.has(t.permiso));
  const avisos = pendientes(resumen, hero);

  const accesos = visibles
    .map(
      (t) => `<a class="portal-tile portal-tile--${t.tono}" href="${escUrl(t.href)}">
  <span class="portal-tile__label">${esc(t.label)}</span>
  <span class="portal-tile__valor">${esc(t.valor)}</span>
  <span class="portal-tile__nota">${esc(t.nota)}</span>
</a>`
    )
    .join('');

  const bloqueAvisos = avisos.length
    ? `<div class="portal-dash-notes"><h2 class="form-title">Para tener en cuenta</h2><ul>${avisos
        .map((a) => `<li>${esc(a)}</li>`)
        .join('')}</ul></div>`
    : `<div class="portal-dash-notes"><h2 class="form-title">Para tener en cuenta</h2><p class="hint">Todo lo del portal está publicado y en su lugar.</p></div>`;

  const bloquePortada = `<div class="portal-dash-portada">
  <h2 class="form-title">La portada del sitio</h2>
  <dl class="portal-dash-list">
    <div><dt>Noticia principal</dt><dd>${
      hero
        ? `<a href="/portal-admin/noticias/${hero.id}">${esc(hero.titulo)}</a> ${hero.publicada ? '' : '<span class="badge amber">Borrador</span>'}`
        : 'No hay ninguna elegida'
    }</dd></div>
    <div><dt>Noticias destacadas</dt><dd>${resumen.portada.noticias}</dd></div>
    <div><dt>Galerías destacadas</dt><dd>${resumen.portada.galerias}</dd></div>
    <div><dt>Configuración</dt><dd>${
      resumen.config.publicada
        ? `Publicada${resumen.config.nombre ? ` · ${esc(resumen.config.nombre)}` : ''}`
        : '<span class="badge amber">Borrador</span>'
    }</dd></div>
  </dl>
  ${
    permisos.has('PORTAL_DESTACADOS')
      ? '<a class="btn btn-primary btn-sm" href="/portal-admin/destacados">Elegir destacados</a>'
      : ''
  }
</div>`;

  const content = `
${accesos ? `<section class="portal-dash-tiles">${accesos}</section>` : ''}
<div class="portal-dash-cols">
  ${bloquePortada}
  ${bloqueAvisos}
</div>
<section class="portal-cards">
  ${accesosRapidos(permisos)
    .map(
      (r) =>
        `<a class="portal-card" href="${escUrl(r.href)}"><span class="portal-card-ico" aria-hidden="true">●</span><strong>${esc(r.label)}</strong><span>Ir →</span></a>`
    )
    .join('')}
</section>`;

  return portalAdminPage('inicio', permisos, {
    title: 'Resumen del portal',
    detail:
      'Desde acá ves qué está publicado y qué falta. Todo lo del portal se maneja acá, separado de la administración deportiva del torneo.',
    content,
  });
}