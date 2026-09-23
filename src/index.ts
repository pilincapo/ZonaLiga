// Entrypoint de la app: rutas públicas + panel admin.

import { Hono } from 'hono';
import type { Env } from './types.ts';
import { adminRoutes } from './routes/admin.ts';
import { delegateRoutes } from './routes/delegate.ts';
import * as pub from './ui/public.ts';

const app = new Hono<{ Bindings: Env }>();

app.route('/admin', adminRoutes);
app.route('/delegado', delegateRoutes);

/* ---------- Público ---------- */

app.get('/', async (c) => c.html(await pub.homePage(c.env.DB, new URL(c.req.url).origin, c.req.query('t'))));

app.get('/posiciones', async (c) => c.html(await pub.standingsPage(c.env.DB, c.req.query('t'))));

app.get('/fixture', async (c) => c.html(await pub.fixturePage(c.env.DB, c.req.query('t'))));

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

app.notFound((c) => c.html(pub.notFoundPage(), 404));

export default app;
