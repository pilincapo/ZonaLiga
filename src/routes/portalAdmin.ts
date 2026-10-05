// Acceso separado para administrar el portal informativo.
//
// Fase 18.2: además del shell, cada sección tiene su contenido real
// (noticias, fotos, complejo e información del torneo). El guardia de abajo
// valida permiso POR SECCIÓN en el servidor antes de cualquier GET o POST:
// una URL directa sin permiso responde 403, sin depender de que la opción
// esté oculta en la interfaz.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types.ts';
import { clearSessionCookieHeader, getSessionCookie, getSessionPrincipal, sessionSecret } from '../lib/auth.ts';
import type { PortalPermission } from '../lib/portalAccess.ts';
import { getPanelUserById, userPortalPermissions } from '../lib/users.ts';
import { portalAdminPage } from '../ui/portalAdmin.ts';
import { dashboardPage } from '../ui/portalDashboard.ts';
import { destacadosPage } from '../ui/portalDestacados.ts';
import { configuracionPage } from '../ui/portalConfiguracion.ts';
import { noticiasListPage, noticiaFormPage } from '../ui/portalNoticias.ts';
import { fotosListPage, galeriaFormPage } from '../ui/portalFotos.ts';
import { complejoFormPage, torneoFormPage } from '../ui/portalPaginas.ts';
import {
  agregarImagen,
  alternarDestacada,
  actualizarGaleria,
  actualizarImagen,
  actualizarNoticia,
  actualizarPortadaGaleria,
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
  setImagenComplejo,
  validarGaleria,
  validarImagenGaleria,
  validarNoticia,
  type EstadoContenido,
} from '../lib/portalContent.ts';
import { galeriaBody, complejoBody, informacionBody, noticiaBody } from '../ui/portalPublic.ts';
import { portalFormImagen } from '../ui/portalFormImagen.ts';
import { ASSET_VERSION } from '../ui/components.ts';
import {
  CONFIG_ID,
  PAGINA_COMPLEJO_ID,
  cargarImagen,
  eliminarArchivo,
  eliminarArchivoPorTipoYPadre,
  esArchivoTipo,
  obtenerArchivoPorPadreYTipo,
  subirArchivo,
  type ArchivoTipo,
} from '../lib/portalArchivos.ts';
import { guardarConfig, guardarPortada, leerConfig, leerIds, leerPortada, validarConfig } from '../lib/portalConfig.ts';
import { resumenPortal } from '../lib/portalResumen.ts';

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
const IMAGENES_SIN_BUCKET =
  'Las imágenes subidas todavía no están disponibles en este sitio. Usá un enlace externo por mientras.';

/** Redirige con un mensaje (exito o error) a la pantalla desde la que se viene. */
function conMensaje(destino: string, mensaje: string, esError = false): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${destino}?${esError ? 'err' : 'msg'}=${encodeURIComponent(mensaje)}` },
  });
}

/**
 * Guarda una imagen del panel (noticia, galería, complejo o configuración).
 * `campoUrl` es el nombre del campo del enlace externo que manda el formulario.
 */
async function postImagen(
  c: Context<PortalEnv>,
  opts: {
    tipo: ArchivoTipo;
    padreId: number;
    campoUrl: string;
    urlActual: string;
    esPublico: boolean;
    destino: string;
    alGuardar: (url: string) => Promise<void>;
  },
): Promise<Response> {
  const form = await c.req.parseBody({ all: true });
  const bruto = form[opts.campoUrl];
  const resultado = await cargarImagen(c.env.DB, {
    tipo: opts.tipo,
    padreId: opts.padreId,
    archivo: form['accion'] === 'quitar' ? 'quitar' : form['archivo'],
    url: typeof bruto === 'string' ? bruto : '',
    urlActual: opts.urlActual,
    esPublico: opts.esPublico,
    bucket: c.env.R2_PUBLIC_BUCKET ?? null,
  });
  await opts.alGuardar(resultado.url);
  return conMensaje(opts.destino, resultado.mensaje, resultado.error === true);
}

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

/* ------------------------------ Inicio (resumen) ------------------------------ */

portalAdminRoutes.get('/', async (c) => {
  const [resumen, portada, config] = await Promise.all([
    resumenPortal(c.env.DB),
    leerPortada(c.env.DB),
    leerConfig(c.env.DB),
  ]);
  const hero = portada.noticia_hero_id != null ? await obtenerNoticia(c.env.DB, portada.noticia_hero_id) : null;
  return c.html(
    dashboardPage({
      permisos: c.get('portalPermissions'),
      resumen,
      hero: hero ? { id: hero.id, titulo: hero.titulo, publicada: hero.status === 'published' } : null,
      config,
    })
  );
});

/* ------------------------------- Destacados ------------------------------- */

portalAdminRoutes.get('/destacados', async (c) => {
  const [noticias, galerias, portada] = await Promise.all([
    listarNoticias(c.env.DB),
    listarGalerias(c.env.DB),
    leerPortada(c.env.DB),
  ]);
  return c.html(
    destacadosPage({
      permisos: c.get('portalPermissions'),
      noticias,
      galerias,
      portada,
      msg: c.req.query('msg'),
      err: c.req.query('err'),
    })
  );
});

portalAdminRoutes.post('/destacados', async (c) => {
  // `all: true`: las listas de destacados son checkboxes repetidos.
  const form = await c.req.parseBody({ all: true });
  const pedidos = { noticias: leerIds(form, 'destacadas'), galerias: leerIds(form, 'galerias') };
  const heroCrudo = form['noticia_hero_id'];
  const guardado = await guardarPortada(c.env.DB, {
    noticia_hero_id: heroCrudo == null || heroCrudo === '' ? null : Number(heroCrudo),
    noticias_destacadas: pedidos.noticias,
    galerias_destacadas: pedidos.galerias,
  });
  const descartados =
    pedidos.noticias.length - guardado.noticias_destacadas.length +
    (pedidos.galerias.length - guardado.galerias_destacadas.length) +
    (portadaHeroPedido(heroCrudo) && guardado.noticia_hero_id == null ? 1 : 0);
  return conMensaje(
    '/portal-admin/destacados',
    descartados > 0
      ? 'Guardado. Se descartaron los destacados que ya no existen.'
      : 'Destacados guardados'
  );
});

/** ¿Se eligió una noticia como principal en el formulario? */
function portadaHeroPedido(bruto: unknown): boolean {
  return bruto != null && bruto !== '' && Number(bruto) > 0;
}

/* ----------------------------- Configuración ----------------------------- */

portalAdminRoutes.get('/configuracion', async (c) => {
  const [config, hero, logo] = await Promise.all([
    leerConfig(c.env.DB),
    obtenerArchivoPorPadreYTipo(c.env.DB, 'config.hero', CONFIG_ID),
    obtenerArchivoPorPadreYTipo(c.env.DB, 'config.logo', CONFIG_ID),
  ]);
  const url = (a: typeof hero) => (a ? { url: a.url_publico, id: a.archivo_id } : null);
  return c.html(
    configuracionPage({
      permisos: c.get('portalPermissions'),
      config,
      hero: url(hero),
      logo: url(logo),
      bucketDisponible: c.env.R2_PUBLIC_BUCKET != null,
      msg: c.req.query('msg'),
      err: c.req.query('err'),
    })
  );
});

portalAdminRoutes.post('/configuracion', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const v = validarConfig(form);
  if (!v.ok || !v.value) {
    const [config, hero, logo] = await Promise.all([
      leerConfig(c.env.DB),
      obtenerArchivoPorPadreYTipo(c.env.DB, 'config.hero', CONFIG_ID),
      obtenerArchivoPorPadreYTipo(c.env.DB, 'config.logo', CONFIG_ID),
    ]);
    const url = (a: typeof hero) => (a ? { url: a.url_publico, id: a.archivo_id } : null);
    return c.html(
      configuracionPage({
        permisos: c.get('portalPermissions'),
        config,
        hero: url(hero),
        logo: url(logo),
        bucketDisponible: c.env.R2_PUBLIC_BUCKET != null,
        err: v.error ?? 'Revisá los datos del formulario',
      }),
      400
    );
  }
  await guardarConfig(c.env.DB, v.value);
  return conMensaje(
    '/portal-admin/configuracion',
    v.value.status === 'published' ? 'Configuración publicada' : 'Configuración guardada como borrador'
  );
});

portalAdminRoutes.post('/configuracion/imagen', async (c) => {
  const tipo = c.req.query('tipo');
  if (!esArchivoTipo(tipo) || (tipo !== 'config.hero' && tipo !== 'config.logo')) {
    return conMensaje('/portal-admin/configuracion', 'Esa imagen no existe en la configuración', true);
  }
  const config = await leerConfig(c.env.DB);
  const actual = await obtenerArchivoPorPadreYTipo(c.env.DB, tipo, CONFIG_ID);
  return postImagen(c, {
    tipo,
    padreId: CONFIG_ID,
    campoUrl: `${tipo}__url_externo`,
    urlActual: actual?.url_publico ?? '',
    esPublico: config.status === 'published',
    destino: '/portal-admin/configuracion',
    // La imagen del portal no vive en una columna: se lee por tipo y padre.
    alGuardar: async () => {},
  });
});

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
  // La imagen se sube en su propio formulario: nunca viene en este.
  const id = await crearNoticia(c.env.DB, { ...v.value, imagen: '' });
  return conMensaje(
    '/portal-admin/noticias',
    v.value.status === 'published' ? 'Noticia publicada' : 'Noticia guardada como borrador'
  );
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
    puedeSubir: c.env.R2_PUBLIC_BUCKET != null,
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
  if (!noticia) return conMensaje('/portal-admin/noticias', 'Esa noticia no existe', true);
  return postImagen(c, {
    tipo: 'noticia.imagen_principal',
    padreId: id,
    campoUrl: 'noticia.imagen_principal__url_externo',
    urlActual: noticia.imagen,
    esPublico: noticia.status === 'published',
    destino: `/portal-admin/noticias/${id}`,
    alGuardar: async (url) => {
      await c.env.DB.prepare('UPDATE portal_noticias SET imagen = ?1 WHERE id = ?2').bind(url, id).run();
    },
  });
});

portalAdminRoutes.post('/noticias/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const noticia = await obtenerNoticia(c.env.DB, id);
  if (!noticia) return conMensaje('/portal-admin/noticias', 'Esa noticia no existe', true);
  const form = await c.req.parseBody();
  const v = validarNoticia(form);
  if (!v.ok) return c.html(noticiaFormPage(noticia, c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  const estado: EstadoContenido = estadoDeForm(form);
  // La imagen se sube en su propio formulario: acá se conserva la que hay.
  await actualizarNoticia(c.env.DB, id, { ...v.value, imagen: noticia.imagen, status: estado });
  return conMensaje(
    '/portal-admin/noticias',
    estado === 'published' ? 'Noticia publicada' : 'Noticia guardada como borrador'
  );
});

/** Estado que salió del botón que se apretó (publicar o guardar borrador). */
function estadoDeForm(form: Record<string, unknown>): EstadoContenido {
  return form['status'] === 'published' ? 'published' : 'draft';
}

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
  if (!galeria) return conMensaje('/portal-admin/fotos', 'Esa galería no existe', true);
  const [imagenes, portada] = await Promise.all([
    listarImagenes(c.env.DB, id),
    obtenerArchivoPorPadreYTipo(c.env.DB, 'galeria.portada', id),
  ]);
  const imagenField = galeria
    ? portalFormImagen({
        accionUrl: `/portal-admin/fotos/${id}/portada`,
        clase: 'portal-img',
        tipoArchivo: 'galeria.portada',
        archivoId: portada?.archivo_id ?? null,
        urlActual: portada ? portada.url_publico : galeria.portada || null,
        esExterno: portada ? portada.url_externo != null : galeria.portada !== '',
        puedeSubir: c.env.R2_PUBLIC_BUCKET != null,
        etiquetaQuitar: 'portada de la galería',
        help: 'Si no ponés ninguna, se usa la primera foto de la galería.',
      })
    : '';
  return c.html(
    galeriaFormPage(galeria, imagenes, c.get('portalPermissions'), {
      msg: c.req.query('msg'),
      err: c.req.query('err'),
      contentExtra: imagenField,
      bucketDisponible: c.env.R2_PUBLIC_BUCKET != null,
    })
  );
});

/** Imagen de portada de la galería (subida a R2 o enlace externo). */
portalAdminRoutes.post('/fotos/:id/portada', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return conMensaje('/portal-admin/fotos', 'Esa galería no existe', true);
  return postImagen(c, {
    tipo: 'galeria.portada',
    padreId: id,
    campoUrl: 'galeria.portada__url_externo',
    urlActual: galeria.portada,
    esPublico: galeria.status === 'published',
    destino: `/portal-admin/fotos/${id}`,
    alGuardar: (url) => actualizarPortadaGaleria(c.env.DB, id, url),
  });
});

portalAdminRoutes.post('/fotos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return conMensaje('/portal-admin/fotos', 'Esa galería no existe', true);
  const form = await c.req.parseBody();
  const v = validarGaleria(form);
  if (!v.ok) {
    const imagenes = await listarImagenes(c.env.DB, id);
    return c.html(galeriaFormPage(galeria, imagenes, c.get('portalPermissions'), { valores: form, err: v.error }), 400);
  }
  const estado = estadoDeForm(form);
  // La portada se sube en su propio formulario: acá se conserva la que hay.
  await actualizarGaleria(c.env.DB, id, { ...v.value, portada: galeria.portada, status: estado });
  return conMensaje(
    `/portal-admin/fotos/${id}`,
    estado === 'published' ? 'Galería publicada' : 'Galería guardada como borrador'
  );
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
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return conMensaje('/portal-admin/fotos', 'Esa galería no existe', true);
  // Primero se borran los archivos de R2: después ya no queda registro de ellos.
  const bucket = c.env.R2_PUBLIC_BUCKET ?? null;
  const imagenes = await listarImagenes(c.env.DB, id);
  for (const img of imagenes) {
    if (img.archivo_id != null) await eliminarArchivo(c.env.DB, bucket, img.archivo_id);
  }
  await eliminarArchivoPorTipoYPadre(c.env.DB, bucket, 'galeria.portada', id);
  await eliminarGaleria(c.env.DB, id);
  return conMensaje('/portal-admin/fotos', 'Galería eliminada');
});

portalAdminRoutes.get('/fotos/:id/vista-previa', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return c.notFound();
  const imagenes = await listarImagenes(c.env.DB, id);
  return c.html(previewHtml('fotos', galeriaBody(galeria, imagenes), galeria.status));
});

/**
 * Agrega una foto a la galería: un archivo del dispositivo (que va a R2) o un
 * enlace de internet. La foto se crea primero para tener su id (que es el padre
 * del archivo en R2) y se completa la URL después; si la subida falla, la fila
 * se borra y no queda nada a medio hacer.
 */
portalAdminRoutes.post('/fotos/:id/imagenes', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await obtenerGaleria(c.env.DB, id);
  if (!galeria) return conMensaje('/portal-admin/fotos', 'Esa galería no existe', true);
  const destino = `/portal-admin/fotos/${id}`;
  const form = await c.req.parseBody({ all: true });
  const archivo = form['archivo'];
  const caption = typeof form['caption'] === 'string' ? form['caption'] : '';

  if (archivo instanceof File && archivo.size > 0) {
    const bucket = c.env.R2_PUBLIC_BUCKET;
    if (!bucket) return conMensaje(destino, IMAGENES_SIN_BUCKET, true);
    const fotoId = await agregarImagen(c.env.DB, id, '', caption);
    try {
      const buffer = await archivo.arrayBuffer();
      const guardado = await subirArchivo(
        c.env.DB,
        bucket,
        'galeria.foto',
        fotoId,
        buffer,
        archivo.type || undefined,
        galeria.status === 'published' ? 1 : 0
      );
      await c.env.DB
        .prepare('UPDATE portal_gallery_images SET url = ?1, archivo_id = ?2 WHERE id = ?3')
        .bind(guardado.url_publico, guardado.archivo_id, fotoId)
        .run();
      return conMensaje(destino, 'Foto cargada');
    } catch (e) {
      console.error('No se pudo subir la foto:', e);
      await quitarImagen(c.env.DB, fotoId);
      return conMensaje(destino, e instanceof Error ? e.message : 'No se pudo subir la foto', true);
    }
  }

  const v = validarImagenGaleria(form);
  if (!v.ok) return conMensaje(destino, v.error, true);
  await agregarImagen(c.env.DB, id, v.value.url, v.value.caption);
  return conMensaje(destino, 'Foto agregada');
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const v = validarImagenGaleria(form);
  if (!v.ok) return conMensaje(`/portal-admin/fotos/${id}`, v.error, true);
  // Permite corregir el enlace y el pie de una foto existente.
  await actualizarImagen(c.env.DB, Number(c.req.param('imgId')), v.value.url, v.value.caption);
  return conMensaje(`/portal-admin/fotos/${id}`, 'Foto actualizada');
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId/mover', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.parseBody();
  const dir = form['dir'] === 'up' ? 'up' : 'down';
  await moverImagen(c.env.DB, id, Number(c.req.param('imgId')), dir);
  return conMensaje(`/portal-admin/fotos/${id}`, 'Orden actualizado');
});

portalAdminRoutes.post('/fotos/:id/imagenes/:imgId/eliminar', async (c) => {
  const id = Number(c.req.param('id'));
  // Si la foto estaba subida, se borra también el archivo de R2.
  const archivoId = await quitarImagen(c.env.DB, Number(c.req.param('imgId')));
  if (archivoId != null) await eliminarArchivo(c.env.DB, c.env.R2_PUBLIC_BUCKET ?? null, archivoId);
  return conMensaje(`/portal-admin/fotos/${id}`, 'Foto quitada');
});

/* ------------------------------ Páginas ------------------------------ */

portalAdminRoutes.get('/complejo', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'complejo');
  const imagen = await obtenerArchivoPorPadreYTipo(c.env.DB, 'complejo.imagen', PAGINA_COMPLEJO_ID);
  const imagenField = portalFormImagen({
    accionUrl: '/portal-admin/complejo/imagen',
    clase: 'portal-img',
    tipoArchivo: 'complejo.imagen',
    archivoId: imagen?.archivo_id ?? null,
    urlActual: imagen ? imagen.url_publico : (pagina ? ((pagina.data as { imagen?: string }).imagen ?? '') || null : null),
    esExterno: imagen ? imagen.url_externo != null : Boolean((pagina?.data as { imagen?: string } | undefined)?.imagen),
    puedeSubir: c.env.R2_PUBLIC_BUCKET != null,
    etiquetaQuitar: 'imagen del complejo',
    help: 'Es la foto de cabecera de la página pública del complejo.',
  });
  return c.html(
    complejoFormPage(pagina, c.get('portalPermissions'), {
      msg: c.req.query('msg'),
      err: c.req.query('err'),
      contentExtra: imagenField,
    })
  );
});

/** Imagen de cabecera del complejo (subida a R2 o enlace externo). */
portalAdminRoutes.post('/complejo/imagen', async (c) => {
  const pagina = await obtenerPagina(c.env.DB, 'complejo');
  const actual = (pagina ? ((pagina.data as { imagen?: string }).imagen ?? '') : '');
  return postImagen(c, {
    tipo: 'complejo.imagen',
    padreId: PAGINA_COMPLEJO_ID,
    campoUrl: 'complejo.imagen__url_externo',
    urlActual: actual,
    esPublico: pagina?.status === 'published',
    destino: '/portal-admin/complejo',
    alGuardar: async (url) => {
      await setImagenComplejo(c.env.DB, url);
    },
  });
});

portalAdminRoutes.post('/complejo', async (c) => {
  // `all: true`: las instalaciones se envían como campos repetidos
  // (inst_nombre, inst_detalle) y sin esto Hono se queda solo con el último.
  const form = await c.req.parseBody({ all: true });
  const data = leerComplejoForm(form);
  // La imagen se sube en su propio formulario: acá se conserva la que hay.
  const actual = await obtenerPagina(c.env.DB, 'complejo');
  data.imagen = actual ? ((actual.data as { imagen?: string }).imagen ?? '') : '';
  const status = estadoPagina(form);
  await guardarPagina(c.env.DB, 'complejo', data, status);
  return conMensaje(
    '/portal-admin/complejo',
    status === 'published' ? 'Página publicada' : 'Página guardada como borrador'
  );
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
  return conMensaje(
    '/portal-admin/torneo',
    status === 'published' ? 'Página publicada' : 'Página guardada como borrador'
  );
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
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
</head>
<body>
<div class="portal-preview-bar">
  <strong>${aviso}</strong>
  <span><a href="${volver[section]}">← Volver a la administración</a></span>
</div>
<main class="container">${body}</main>  </body>
</html>`;
}
