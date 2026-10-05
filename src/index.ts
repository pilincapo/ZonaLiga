// Entrypoint de la app: rutas públicas + panel admin.

import { Hono } from 'hono';
import type { Env } from './types.ts';
import { adminRoutes } from './routes/admin.ts';
import { delegateRoutes } from './routes/delegate.ts';
import { portalAdminRoutes } from './routes/portalAdmin.ts';
import { responderCacheado, ttlSegundos } from './lib/cache.ts';
import * as pub from './ui/public.ts';
import * as live from './ui/live.ts';
import * as portal from './ui/portalPublic.ts';
import * as portalContenido from './lib/portalContent.ts';
import { completarGaleriasPublicas } from './lib/portalGalerias.ts';

const app = new Hono<{ Bindings: Env }>();

app.route('/admin', adminRoutes);
app.route('/delegado', delegateRoutes);
app.route('/portal-admin', portalAdminRoutes);

/* ---------- Público ----------
 *
 * Las páginas públicas se sirven desde la caché de Cloudflare: es la diferencia
 * entre 380 y miles de visitas por día con el mismo presupuesto de base de
 * datos. El TTL sale de CACHE_PUBLICA_TTL (0 = apagada, que es lo que usan los
 * tests). Ver src/lib/cache.ts para qué rutas quedan afuera y por qué.
 *
 * Va DESPUÉS de registrar /admin y /delegado a propósito: en Hono los handlers
 * se ejecutan en orden de registro, así que el panel nunca pasa por la caché.
 */
app.use('*', async (c, next) => {
  const ttl = ttlSegundos(c.env.CACHE_PUBLICA_TTL);
  await responderCacheado(c, next, ttl);
});

app.get('/', async (c) => c.html(await pub.homePage(c.env.DB, new URL(c.req.url).origin, c.req.query('t'))));

app.get('/posiciones', async (c) => c.html(await pub.standingsPage(c.env.DB, c.req.query('t'), new URL(c.req.url).origin)));

app.get('/fixture', async (c) =>
  c.html(await pub.fixturePage(c.env.DB, c.req.query('t'), c.req.query('f'), new URL(c.req.url).origin))
);

app.get('/goleadores', async (c) =>
  c.html(await pub.scorersPage(c.env.DB, new URL(c.req.url).origin, c.req.query('t')))
);

app.get('/equipos', async (c) => c.html(await pub.teamsPage(c.env.DB)));

app.get('/equipos/:slug', async (c) => c.html(await pub.teamPage(c.env.DB, c.req.param('slug'))));

app.get('/jugador/:id', async (c) => c.html(await pub.playerPage(c.env.DB, Number(c.req.param('id')))));

app.get('/partido/:id', async (c) =>
  c.html(await pub.matchPage(c.env.DB, Number(c.req.param('id')), new URL(c.req.url).origin))
);

app.get('/historial', async (c) => c.html(await pub.historyPage(c.env.DB)));

app.get('/suspensiones', async (c) => c.html(await pub.suspensionsPage(c.env.DB, c.req.query('t'))));

app.get('/buscar', async (c) => c.html(await pub.searchPage(c.env.DB, c.req.query('q'))));

/* ---------- Portal informativo (Fase 18.2) ----------
 *
 * Contenido editorial administrado desde /portal-admin. Solo se listan y
 * muestran items PUBLICADOS: la consulta filtra en la base. Van después del
 * middleware de caché, igual que el resto del sitio público.
 */
app.get('/noticias', async (c) => c.html(portal.noticiasListPage(await portalContenido.listarNoticiasPublicadas(c.env.DB))));

app.get('/noticias/:id', async (c) => {
  const noticia = await portalContenido.obtenerNoticiaPublica(c.env.DB, Number(c.req.param('id')));
  if (!noticia) return c.notFound();
  return c.html(portal.noticiaPage(noticia));
});

app.get('/fotos', async (c) => c.html(portal.fotosListPage(await completarGaleriasPublicas(c.env.DB))));

app.get('/fotos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const galeria = await portalContenido.obtenerGaleriaPublica(c.env.DB, id);
  if (!galeria) return c.notFound();
  const imagenes = await portalContenido.listarImagenes(c.env.DB, id);
  return c.html(portal.galeriaPage(galeria, imagenes));
});

app.get('/el-complejo', async (c) => c.html(portal.complejoPage(await portalContenido.obtenerPaginaPublica(c.env.DB, 'complejo'))));

app.get('/informacion', async (c) => c.html(portal.informacionPage(await portalContenido.obtenerPaginaPublica(c.env.DB, 'torneo'))));

/** Novedades: qué cambió en cada versión (no usa base de datos). */
app.get('/changelog', (c) => {
  const t0 = Date.now();
  const html = pub.changelogPage();
  c.header('Server-Timing', `generate;dur=${Date.now() - t0}`);
  return c.html(html);
});

/** Fecha en vivo: la página y el JSON que refresca solo. */
app.get('/en-vivo', async (c) => c.html(await live.livePage(c.env.DB, c.req.query('t'))));

app.get('/api/vivo', async (c) => {
  const data = await live.liveData(c.env.DB, c.req.query('t'));
  if (!data) return c.json({ error: 'sin torneo activo' }, 404);
  return c.json(
    { ...data.payload, tournament: { name: data.tournament.name, slug: data.tournament.slug } },
    200,
    { 'cache-control': 'no-store' }
  );
});

app.notFound((c) => c.html(pub.notFoundPage(), 404));

export default app;
