#!/usr/bin/env node
// Medición local de carga para la Fase 13 follow-up (suspensiones + fixture/new).
//
// Levanta un `wrangler dev --local` efímero con D1 ephemera (como test-e2e.mjs),
// crea varios torneos para amplificar el N+1, y cronometra varias navegaciones
// autenticadas de admin. Sirve para comparar ANTES (git stash de las optimizaciones)
// vs DESPUÉS (0.3.8). No toca producción.
//
// Uso: node scripts/measure-perf.mjs [tournamentCount]

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const nTournaments = Number(process.argv[2] ?? 20);

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}
function waitFor(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const tick = async () => {
      if (Date.now() >= deadline) return rej(new Error(`Timeout ${url}`));
      try {
        const r = await fetch(url);
        if (r.status < 500) return res(undefined);
      } catch {}
      setTimeout(tick, 400);
    };
    tick();
  });
}
function killTree(pid) {
  if (isWin) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
}

function formatResult(r) {
  return `p50=${r.p50.toFixed(1)}ms  min=${r.min.toFixed(1)}ms  max=${r.max.toFixed(1)}ms`;
}
function formatWT(wt) {
  if (!wt) return 'n/a';
  return `Worker p50=${wt.p50.toFixed(1)}ms  min=${wt.min.toFixed(1)}ms  max=${wt.max.toFixed(1)}ms`;
}

async function median(xs) { const s=[...xs].sort((a,b)=>a-b); return s[Math.floor(s.length/2)] ?? 0; }
async function measure(url, cookie, iters=6, warmup=2) {
  // warmup
  for (let i = 0; i < warmup; i++) await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const samples = [];
  const workerTimings = [];
  for (let i = 0; i < iters; i++) {
    const t0 = process.hrtime.bigint();
    const res = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    // Captura Server-Timing del Worker (timing interno, excluye latencia de red)
    const st = res.headers.get('server-timing');
    if (st) { const m = /dur=([\d.]+)/.exec(st); if (m) workerTimings.push(Number(m[1])); }
    if (res.status !== 200) console.log('  !! status', res.status);
  }
  return { min: Math.min(...samples), p50: await median(samples), max: Math.max(...samples), iters, workerTiming: workerTimings.length ? { min: Math.min(...workerTimings), p50: await median(workerTimings), max: Math.max(...workerTimings) } : null };
}

const port = await getFreePort();
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zlg-perf-'));
const adminPassword = `perf-${Date.now().toString(36)}`;
const base = `http://127.0.0.1:${port}`;
const logPath = path.join(persistDir, 'wrangler-dev.log');
const logStream = fs.openSync(logPath, 'a');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };

let child;
try {
  const mig = spawnSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistDir], {
    cwd: root, env, encoding: 'utf8',
  });
  if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); throw new Error('migraciones'); }

  child = spawn(process.execPath, [WRANGLER_JS, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--local', '--persist-to', persistDir, '--var', `ADMIN_PASSWORD:${adminPassword}`], {
    cwd: root, env, stdio: ['ignore', logStream, logStream],
  });

  await waitFor(`${base}/changelog`);

  const cookie = () => fetch(`${base}/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: adminPassword, next: '/admin' }), redirect: 'manual',
  }).then((r) => (r.headers.get('set-cookie') ?? '').split(';')[0]);

  const adminCookie = await cookie();
  console.log(`\n== creando ${nTournaments} torneos (==); admin logueado: ${Boolean(adminCookie)}`);
  const headers = { 'content-type': 'application/x-www-form-urlencoded', cookie: adminCookie };
  for (let i = 0; i < nTournaments; i++) {
    await fetch(`${base}/admin/torneos`, {
      method: 'POST', headers, redirect: 'manual',
      body: new URLSearchParams({ name: `T ${i}`, season: '2026', format: 'round_robin', status: 'active', venues: 'Cancha Norte\nCancha Sur', kickoffs: '10:00, 12:00', start_date: '2026-10-05', round_gap: '7', play_weekday: '6' }),
    });
  }
  console.log('torneos creados.');

  // /changelog: endpoint público, sin DB. Mide el overhead del Worker (parsing,
  // import del changelog, render del template). No requiere auth ni datos.
  console.log('\n== /changelog (endpoint público — baseline de overhead del Worker) ==');
  const cl = await measure(`${base}/changelog`, null, 6, 2);
  console.log('  HTTP round-trip:', formatResult(cl));
  if (cl.workerTiming) console.log('  Worker timing  :', formatWT(cl.workerTiming));

  console.log('\n== /admin/fixture/nuevo (elige partido → dropdown de equipos por torneo) ==');
  const fx = await measure(`${base}/admin/fixture/nuevo`, adminCookie, 6, 2);
  console.log('  HTTP round-trip:', formatResult(fx));

  // También probamos suspender: sin jugadores suspendidos, el N+1 de nombres no se ejerce;
  // pero la carga del historial + tabla sigue ahí. Se mide igual para warm cache.
  console.log('\n== /admin/suspensiones (primer torneo) ==');
  const sus = await measure(`${base}/admin/suspensiones`, adminCookie, 6, 2);
  console.log('  HTTP round-trip:', formatResult(sus));

  // Extrae líneas de log que puedan contener timing del Worker.
  const logText = fs.readFileSync(logPath, 'utf8');
  const logLines = logText.split('\n');
  const timingRe = /(\d+(?:\.\d+)?)\s*ms/i;
  const timingLines = logLines.filter((l) => timingRe.test(l) && (l.toLowerCase().includes('conn') || l.toLowerCase().includes('get') || l.toLowerCase().includes('post')));
  console.log(`\n[log worker] timing del Worker (peticiones con ms):`);
  (timingLines.length ? timingLines : logLines.slice(-8)).slice(-10).forEach((l) => console.log('  ' + l.trim()));
} catch (e) {
  console.error('ERROR', e);
  process.exitCode = 1;
} finally {
  if (child) killTree(child.pid);
  fs.closeSync(logStream);
  try { fs.rmSync(persistDir, { recursive: true, force: true }); } catch {}
}
