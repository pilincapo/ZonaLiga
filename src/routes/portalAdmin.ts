// Acceso separado para administrar el portal informativo.
//
// Fase 18.2: además del shell, cada sección tiene su contenido real
// (noticias, fotos, complejo e información del torneo). El guardia de abajo
// valida permiso POR SECCIÓN en el servidor antes de cualquier GET o POST:
// una URL directa sin permiso responde 403, sin depender de que la opción
// esté oculta en la interfaz.

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { clearSessionCookieHeader, getSessionCookie, getSessionPrincipal, sessionSecret } from '../lib/auth.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';
import { getPanelUserById, userPortalPermissions } from '../lib/users.ts';
import { portalAdminPage } from '../ui/portalAdmin.ts';
import { noticiasListPage, noticiaFormPage } from '../ui/portalNoticias.ts';
import { fotosListPage, galeriaFormPage } from '../ui/portalFotos.ts';
import { complejoFormPage, torneoFormPage } from '../ui/portalPaginas.ts';
import {
  agregarImagen,
  alternarDestacada,
  actualizarGaleria,
  actualizarImagen,
  actualizarNoticia,
  cambiarEstadoGaleria,
  cambiarEstadoNoticia,
  crearGaleria,
  crearNoticia,
  eliminarGaleria,
  eliminarNoticia,
  estadoPagina,
  guardarPagina,
  leerComplejoForm,
  leerTorneoForm,
  listarGalerias,
  listarImagenes,
  listarNoticias,
  moverImagen,
  obtenerGaleria,
  obtenerNoticia,
  obtenerPagina,
  quitarImagen,
  validarGaleria,
  validarImagenGaleria,
  validarNoticia,
  type EstadoContenido,
} from '../lib/portalContent.ts';
import { galeriaBody, complejoBody, informacionBody, noticiaBody } from '../ui/portalPublic.ts';
import { portalFormImagen } from '../ui/portalFormImagen.ts';
import { obtenerArchivoPorPadreYTipo, subirArchivo, eliminarArchivoPorTipoYTipo } from '../lib/portalArchivos.ts';
import { validarUrlImagen } from '../lib/portalContent.ts';

type PortalEnv = {
  Bindings: Env;
  Variables: { portalPermissions: ReadonlySet<PortalPermission> };
};

export const portalAdminRoutes = new Hono<PortalEnv>();

/**
 * Qué sección (y qué permiso) toca cada ruta. La búsqueda es por PREFIJO:
 * `/portal-admin/noticias/12/eliminar` cae en la sección `noticias`, así que
 * todas las subrutas comparten el mismo permiso.
 */
const SECTIONS: Record<string, { section: Parameters<typeof portalAdminPage>[0]; permission?: PortalPermission }> = {
  '/portal-admin': { section: 'inicio' },
  '/portal-admin/noticias': { section: 'noticias', permission: 'PORTAL_NOTICIAS' },
  '/portal-admin/fotos': { section: 'fotos', permission: 'PORTAL_FOTOS' },
  '/portal-admin/destacados': { section: 'destacados', permission: 'PORTAL_DESTACADOS' },
  '/portal-admin/complejo': { section: 'complejo', permission: 'PORTAL_COMPLEJO' },
  '/portal-admin/torneo': { section: 'torneo', permission: 'PORTAL_TORNEO' },
  '/portal-admin/configuracion': { section: 'configuracion', permission: 'PORTAL_CONFIGURACION' },
};

/** Rutas que renderizan el shell de una sección sin contenido propio. */
const SHELL_ROUTES: { path: string; route: string }[] = [
  { path: '/portal-admin', route: '/' },
  { path: '/portal-admin/destacados', route: '/destacados' },
  { path: '/portal-admin/configuracion', route: '/configuracion' },
];

function portalPath(path: string): string {
  const normalized = path.replace(/\/$/, '') || '/';
  if (normalized === '/portal-admin' || normalized.startsWith('/portal-admin/')) return normalized;
  return normalized === '/' ? '/portal-admin' : `/portal-admin${normalized}`;
}

/** Sección de una ruta: la clave más larga que sea prefijo de `path`. */
function sectionAt(path: string): (typeof SECTIONS)[string] | undefined {
  let best: { key: string; entry: (typeof SECTIONS)[string] } | undefined;
  for (const [key, entry] of Object.entries(SECTIONS)) {
    if (path === key || path.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, entry };
    }
  }
  return best?.entry;
}

portalAdminRoutes.use('*', async (c, next) => {
  const path = portalPath(c.req.path);
  if (path === '/portal-admin/login') return c.redirect('/admin/login?next=%2Fportal-admin');
  if (path === '/portal-admin/logout') return next();
  const principal = await getSessionPrincipal(getSessionCookie(c.req.raw), sessionSecret(c.env));
  if (!principal) return c.redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  // El administrador gestiona el deporte: el portal es de los usuarios con
  // cuenta propia, así que se lo devolvemos a su panel.
  if (principal.role !== 'COMMUNITY_MANAGER' || principal.userId == null) {
    if (principal.role === 'ADMIN') return c.redirect('/admin');
    return c.redirect('/admin/login?next=%2Fportal-admin');
  }
  // Usuario real: carga sus permisos de portal desde la base.
  const user = await getPanelUserById(c.env.DB, principal.userId);
  if (!user || user.active !== 1) {
    c.header('Set-Cookie', clearSessionCookieHeader());
    return c.redirect('/admin/login?next=%2Fportal-admin');
  }
  const permissions = await userPortalPermissions(c.env.DB, user.id);
  const entry = sectionAt(path);
  if (!entry) return c.notFound();
  // Sección sin permiso: 403 aunque se conozca la URL (validación server-side).
  if (entry.permission && !permissions.has(entry.permission)) {
    return c.text('No tenés permiso para esta sección.', 403);
  }
  c.set('portalPermissions', permissions);
  return next();
});

/* ------------------------------ Shell base ------------------------------ */

for (const { path, route } of SHELL_ROUTES) {
  portalAdminRoutes.get(route, async (c) => {
    const entry = SECTIONS[path]!;
    return c.html(portalAdminPage(entry.section, c.get('portalPermissions')));
  });
}

/* ------------------------------- Noticias ------------------------------- */

portalAdminRoutes.get('/noticias', async (c) => {
  const noticias = await listarNoticias(c.env.DB);
  return c.html(noticiasListPage(noticias, c.get('portalPermissions'), { msg: c.req.query('msg'), err: c.req.query('err') }));
});

portalAdminRoutes.get('/noticias/nueva', (c) =>
  c.html(noticiaFormPage(null, c.get('portalPermissions'), { err: c.req.query('err') }))
);

portalAdminRoutes.post('/noticias', async (c) => {
  const form = await c.req.parseBody();
  const v = validarNoticia(form);
  if (!v.ok) return c.html(noticiaFormPage(null, c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  const id = await crearNoticia(c.env.DB, v.value);
  return c.redirect(`/portal-admin/noticias?msg=${encodeURIComponent(v.value.status === 'published' ? 'Noticia publicada' : 'Noticia guardada como borrador')}`);
});

portalAdminRoutes.get('/noticias/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const noticia = await obtenerNoticia(c.env.DB, id);
  if (!noticia) return c.redirect('/portal-admin/noticias?err=' + encodeURIComponent('Esa noticia no existe'));
  // Bloque de imagen: archivo propio en R2 si lo hay, o el enlace externo actual.
  const archivo = await obtenerArchivoPorPadreYTipo(c.env.DB, 'noticia.imagen_principal', id);
  const imagenField = portalFormImagen({
    accionUrl: `/portal-admin/noticias/${id}/imagen`,
    clase: 'portal-img',
    tipoArchivo: 'noticia.imagen_principal',
    archivoId: archivo?.archivo_id ?? null,
    urlActual: archivo ? archivo.url_publico : noticia.imagen || null,
    esExterno: archivo ? archivo.url_externo != null : noticia.imagen !== '',
    puedeSubir: true,
    help: 'Pegá el enlace de una imagen que ya está en internet, o subí un archivo desde tu dispositivo.',
  });
  return c.html(noticiaFormPage(noticia, c.get('portalPermissions'), { err: c.req.query('err'), contentExtra: imagenField }));
});

/**
 * Imagen principal de la noticia (Fase 18.3). Acepta las dos cosas:
 *   · un archivo del dispositivo (multipart) → se sube a R2;
 *   · un enlace externo → se guarda como referencia, sin tocar R2.
 * El permiso lo exige el guardia de sección (/portal-admin/noticias → PORTAL_NOTICIAS).
 */
portalAdminRoutes.post('/noticias/:id/imagen', async (c) => {
  const id = Number(c.req.param('id'));
  const noticia = await obtenerNoticia(c.env.DB, id);
  if (!noticia) return c.redirect('/portal-admin/noticias?err=' + encodeURIComponent('Esa noticia no existe'));

  const form = await c.req.parseBody({ all: true });
  const volver = (msg: string, esError = false) =>
    c.redirect(`/portal-admin/noticias/${id}?${esError ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);

  const archivo = form['archivo'];
  const urlCruda = form['noticia.imagen_principal__url_externo'];
  const url = typeof urlCruda === 'string' ? urlCruda.trim() : '';

  // 1) Quitar la imagen (sube el botón "Quitar imagen" del bloque).
  if (form['accion'] === 'quitar') {
    await eliminarArchivoPorTipoYTipo(c.env.DB, c.env.R2_PUBLIC_BUCKET ?? null, 'noticia.imagen_principal', id);
    await c.env.DB.prepare('UPDATE portal_noticias SET imagen = ?1 WHERE id = ?2').bind('', id).run();
    return volver('Imagen quitada');
  }

  // 2) Archivo del dispositivo → R2.
  if (archivo instanceof File && archivo.size > 0) {
    if (!c.env.R2_PUBLIC_BUCKET || !c.env.R2_PUBLIC_BUCKET_DOMAIN) {
      return volver('Las imágenes subidas todavía no están disponibles en este sitio. Usá un enlace externo por ahora.', true);
    }
    try {
      const buffer = await archivo.arrayBuffer();
      await subirArchivo(
        c.env.DB,
        c.env.R2_PUBLIC_BUCKET,
        c.env.R2_PUBLIC_BUCKET_DOMAIN,
        'noticia.imagen_principal',
        id,
        buffer,
        archivo.type || undefined,
        noticia.status === 'published' ? 1 : 0
      );
    } catch (e) {
      console.error('No se pudo subir la imagen:', e);
      return volver(e instanceof Error ? e.message : 'No se pudo subir la imagen', true);
    }
    // El campo imagen guarda la URL que se sirve (la del bucket).
    const nuevo = await obtenerArchivoPorPadreYTipo(c.env.DB, 'noticia.imagen_principal', id);
    await c.env.DB.prepare('UPDATE portal_noticias SET imagen = ?1 WHERE id = ?2').bind(nuevo?.url_publico ?? '', id).run();
    return volver('Imagen cargada');
  }

  // 3) Enlace externo (o el que ya estaba, si el campo vino vacío).
  if (url !== '') {
    const v = validarUrlImagen(url);
    if (!v.ok) return volver(v.error, true);
    await c.env.DB.prepare('DELETE FROM portal_archivos WHERE tipo = ?1 AND padre_id = ?2')
      .bind('noticia.imagen_principal', id).run();
    await c.env.DB.prepare('UPDATE portal_noticias SET imagen = ?1 WHERE id = ?2').bind(v.value, id).run();
    return volver('Imagen actualizada con el enlace externo');
  }

  return volver('No se recibió una imagen nueva');
});

portalAdminRoutes.post('/noticias/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const noticia = await obtenerNoticia(c.env.DB, id);
  if (!noticia) return c.redirect('/portal-admin/noticias?err=' + encodeURIComponent('Esa noticia no existe'));
  const form = await c.req.parseBody();
  const v = validarNoticia(form);
  if (!v.ok) return c.html(noticiaFormPage(noticia, c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  const estado: EstadoContenido = typeof form['status'] === 'string' && form['status'] === 'published' ? 'published' : 'draft';
  await actualizarNoticia(c.env.DB, id, { ...v.value, status: estado });
  return c.redirect(`/portal-admin/noticias?msg=${encodeURIComponent(estado === 'published' ? 'Noticia publicada' : 'Noticia guardada como borrador')}`);
});

portalAdminRoutes.post('/noticias/:id/publicar', async (c) => {
  await cambiarEstadoNoticia(c.env.DB, Number(c.req.param('id')), 'published');
  return c.redirect('/portal-admin/noticias?msg=' + encodeURIComponent('Noticia publicada'));
});

portalAdminRoutes.post('/noticias/:id/despublicar', async (c) => {
  await cambiarEstadoNoticia(c.env.DB, Number(c.req.param('id')), 'draft');
  return c.redirect('/portal-admin/noticias?msg=' + encodeURIComponent('Noticia despublicada'));
});

portalAdminRoutes.post('/noticias/:id/destacar', async (c) => {
  await alternarDestacada(c.env.DB, Number(c.req.param('id')));
  return c.redirect('/portal-admin/noticias?msg=' + encodeURIComponent('Destacada actualizada'));
});

portalAdminRoutes.post('/noticias/:id/eliminar', async (c) => {
  await eliminarNoticia(c.env.DB, Number(c.req.param('id')));
  return c.redirect('/portal-admin/noticias?msg=' + encodeURIComponent('Noticia eliminada'));
});

/** Vista previa: renderiza la noticia aunque sea borrador, en otra pestaña. */
portalAdminRoutes.get('/noticias/:id/vista-previa', async (c) => {
  const noticia = await obtenerNoticia(c.env.DB, Number(c.req.param('id')));
  if (!noticia) return c.notFound();
  return c.html(previewHtml('noticias', noticiaBody(noticia), noticia.status));
});

/* -------------------------------- Fotos -------------------------------- */

portalAdminRoutes.get('/fotos', async (c) => {
  const galerias = await listarGalerias(c.env.DB);
  return c.html(fotosListPage(galerias, c.get('portalPermissions'), { msg: c.req.query('msg'), err: c.req.query('err') }));
});

portalAdminRoutes.get('/fotos/nueva', (c) =>
  c.html(galeriaFormPage(null, [], c.get('portalPermissions'), { err: c.req.query('err') }))
);

portalAdminRoutes.post('/fotos', async (c) => {
  const form = await c.req.parseBody();
  const v = validarGaleria(form);
  if (!v.ok) return c.html(galeriaFormPage(null, [], c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  const id = await crearGaleria(c.env.DB, v.value);
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent('Galería creada. Agregale las fotos.')}`);
});

portalAdminRoutes.get('/fotos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return c.redirect('/portal-admin/fotos?err=' + encodeURIComponent('Esa galería no existe'));
  const imagenes = await listarImagenes(c.env.DB, id);
  return c.html(galeriaFormPage(galeria, imagenes, c.get('portalPermissions'), { msg: c.req.query('msg'), err: c.req.query('err') }));
});

portalAdminRoutes.post('/fotos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return c.redirect('/portal-admin/fotos?err=' + encodeURIComponent('Esa galería no existe'));
  const form = await c.req.parseBody();
  const v = validarGaleria(form);
  if (!v.ok) {
    const imagenes = await listarImagenes(c.env.DB, id);
    return c.html(galeriaFormPage(galeria, imagenes, c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  }
  const estado: EstadoContenido = typeof form['status'] === 'string' && form['status'] === 'published' ? 'published' : 'draft';
  await actualizarGaleria(c.env.DB, id, { ...v.value, status: estado });
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent(estado === 'published' ? 'Galería publicada' : 'Galería guardada como borrador')}`);
});

portalAdminRoutes.post('/fotos/:id/publicar', async (c) => {
  await cambiarEstadoGaleria(c.env.DB, Number(c.req.param('id')), 'published');
  return c.redirect('/portal-admin/fotos?msg=' + encodeURIComponent('Galería publicada'));
});

portalAdminRoutes.post('/fotos/:id/despublicar', async (c) => {
  await cambiarEstadoGaleria(c.env.DB, Number(c.req.param('id')), 'draft');
  return c.redirect('/portal-admin/fotos?msg=' + encodeURIComponent('Galería despublicada'));
});

portalAdminRoutes.post('/fotos/:id/eliminar', async (c) => {
  await eliminarGaleria(c.env.DB, Number(c.req.param('id')));
  return c.redirect('/portal-admin/fotos?msg=' + encodeURIComponent('Galería eliminada'));
});

portalAdminRoutes.get('/fotos/:id/vista-previa', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return c.notFound();
  const imagenes = await listarImagenes(c.env.DB, id);
  return c.html(previewHtml('fotos', galeriaBody(galeria, imagenes), galeria.status));
});

portalAdminRoutes.post('/fotos/:id/imagenes', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return c.redirect('/portal-admin/fotos?err=' + encodeURIComponent('Esa galería no existe'));
  const form = await c.req.parseBody();
  const v = validarImagenGaleria(form);
  if (!v.ok) return c.redirect(`/portal-admin/fotos/${id}?err=${encodeURIComponent(v.error)}`);
  await agregarImagen(c.env.DB, id, v.value.url, v.value.caption);
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent('Foto agregada')}`);
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const v = validarImagenGaleria(form);
  if (!v.ok) return c.redirect(`/portal-admin/fotos/${id}?err=${encodeURIComponent(v.error)}`);
  // Permite corregir el enlace y el pie de una foto existente.
  await actualizarImagen(c.env.DB, Number(c.req.param('imgId')), v.value.url, v.value.caption);
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent('Foto actualizada')}`);
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId/mover', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const dir = form['dir'] === 'up' ? 'up' : 'down';
  await moverImagen(c.env.DB, id, Number(c.req.param('imgId')), dir);
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent('Orden actualizado')}`);
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  await quitarImagen(c.env.DB, Number(c.req.param('imgId')));
  return c.redirect(`/portal-admin/fotos/${id}?msg=${encodeURIComponent('Foto quitada')}`);
});

/* ------------------------------ Páginas ------------------------------ */

portalAdminRoutes.get('/complejo', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'complejo');
  return c.html(complejoFormPage(pagina, c.get('portalPermissions'), { msg: c.req.query('msg'), err: c.req.query('err') }));
});

portalAdminRoutes.post('/complejo', async (c) => {
  // `all: true`: las instalaciones se envían como campos repetidos
  // (inst_nombre, inst_detalle) y sin esto Hono se queda solo con el último.
  const form = await c.req.parseBody({ all: true });
  const data = leerComplejoForm(form);
  const status = estadoPagina(form);
  await guardarPagina(c.env.DB, 'complejo', data, status);
  return c.redirect(`/portal-admin/complejo?msg=${encodeURIComponent(status === 'published' ? 'Página publicada' : 'Página guardada como borrador')}`);
});

portalAdminRoutes.get('/complejo/vista-previa', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'complejo');
  return c.html(previewHtml('complejo', complejoBody(pagina), pagina?.status ?? 'draft'));
});

portalAdminRoutes.get('/torneo', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'torneo');
  return c.html(torneoFormPage(pagina, c.get('portalPermissions'), { msg: c.req.query('msg'), err: c.req.query('err') }));
});

portalAdminRoutes.post('/torneo', async (c) => {
  // Igual que el complejo: los documentos vienen en campos repetidos.
  const form = await c.req.parseBody({ all: true });
  const data = leerTorneoForm(form);
  const status = estadoPagina(form);
  await guardarPagina(c.env.DB, 'torneo', data, status);
  return c.redirect(`/portal-admin/torneo?msg=${encodeURIComponent(status === 'published' ? 'Página publicada' : 'Página guardada como borrador')}`);
});

portalAdminRoutes.get('/torneo/vista-previa', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'torneo');
  return c.html(previewHtml('torneo', informacionBody(pagina), pagina?.status ?? 'draft'));
});

/* -------------------------------- Extras -------------------------------- */

portalAdminRoutes.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookieHeader());
  return c.redirect('/admin/login');
});

/**
 * Envuelve un cuerpo público en una barra de vista previa: el editor ve la
 * página exacta como el público (aunque sea borrador) y sabe que no está
 * publicada. Ruta de sesión: nunca se cachea ni se expone sin permiso.
 */
function previewHtml(section: 'noticias' | 'fotos' | 'complejo' | 'torneo', body: string, status: EstadoContenido): string {
  const volver: Record<string, string> = {
    noticias: '/portal-admin/noticias',
    fotos: '/portal-admin/fotos',
    complejo: '/portal-admin/complejo',
    torneo: '/portal-admin/torneo',
  };
  const aviso =
    status === 'published'
      ? 'Vista previa: esta página está publicada.'
      : 'Vista previa: esta página es un borrador y NO se ve en el sitio.';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista previa — ZonaLiga</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0d1b2a">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/css/app.css?v=67">
</head>
<body>
<div class="portal-preview-bar">
  <strong>${aviso}</strong>
  <span><a href="${volver[section]}">← Volver a la administración</a></span>
</div>
<main class="container">${body}</main>  </body>
</html>`;
}
