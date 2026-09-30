#!/usr/bin/env node
// Orquestador del test E2E de login (flujo admin + delegado contra D1 local real).
//
// Uso: npm run test:e2e   (o node scripts/test-e2e.mjs)
//
// 1. Crea un directorio temporal aislado (--persist-to), aplica las
//    migraciones en esa D1 vacía y levanta `wrangler dev` en un puerto libre
//    con ADMIN_PASSWORD propio.
// 2. Corre el suite de Vitest (test/e2e-login.test.ts) con la URL y la
//    contraseña en variables de entorno.
// 3. Mata el árbol de procesos del server y borra el directorio, siempre,
//    incluso si los tests fallan.
//
// Los binarios se invocan con `node <bin>` directamente (sin `npm exec` ni
// shell): evita el lío de flags de npm exec y los problemas de .cmd en Windows.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WRANGLER_JS = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const VITEST_MJS = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitFor(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* todavía no está listo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout esperando ${url}`);
}

function killTree(pid) {
  if (isWin) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ya murió */
      }
    }
  }
}

const port = await getFreePort();
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonaliga-e2e-'));
const adminPassword = `e2e-pass-${Date.now().toString(36)}`;
const base = `http://127.0.0.1:${port}`;
const logPath = path.join(persistDir, 'wrangler-dev.log');
const logStream = fs.openSync(logPath, 'a');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };

let failed = false;
try {
  // 1) Migraciones contra la D1 aislada (queda vacía: el test crea todo por HTTP).
  const mig = spawnSync(process.execPath, [WRANGLER_JS, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistDir], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (mig.status !== 0) {
    console.error(mig.stdout, mig.stderr);
    throw new Error('fallaron las migraciones');
  }

  // 2) Server con ADMIN_PASSWORD propio (binding via --var; wrangler dev no
  //    propaga variables de proceso al worker, y así no tocamos .dev.vars).
  const child = spawn(
    process.execPath,
    [
      WRANGLER_JS, 'dev',
      '--port', String(port),
      '--ip', '127.0.0.1',
      '--local',
      '--persist-to', persistDir,
      '--var', `ADMIN_PASSWORD:${adminPassword}`,
    ],
    {
      cwd: root,
      env,
      stdio: ['ignore', logStream, logStream],
    }
  );

  try {
    // /changelog no toca la base: sonda de "server arriba".
    await waitFor(`${base}/changelog`);
  } catch (err) {
    console.error(err);
    console.error(fs.readFileSync(logPath, 'utf8').slice(-2000));
    throw err;
  }

  // 3) Tests; la limpieza corre en finally pase lo que pase.
  try {
    const run = spawnSync(process.execPath, [VITEST_MJS, 'run', 'test/e2e-login.test.ts'], {
      cwd: root,
      env: { ...env, ZONALIGA_E2E_BASE: base, ZONALIGA_E2E_PASS: adminPassword },
      stdio: 'inherit',
    });
    failed = run.status !== 0;
    if (process.env.E2E_KEEP_LOG) {
      try { fs.copyFileSync(logPath, path.join(root, 'e2e-debug.log')); } catch {}
    }
  } finally {
    killTree(child.pid);
    fs.closeSync(logStream);
  }
} catch {
  failed = true;
} finally {
  // En Windows workerd suelta los archivos del --persist-to un instante
  // después de morir: reintentamos el borrado unos segundos.
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(persistDir, { recursive: true, force: true });
      break;
    } catch (err) {
      if (i === 19) console.error(`aviso: no se pudo borrar ${persistDir}: ${err?.code ?? err}`);
      else await new Promise((r) => setTimeout(r, 500));
    }
  }
}
process.exit(failed ? 1 : 0);
