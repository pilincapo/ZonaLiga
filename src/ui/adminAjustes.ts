// Panel: ajustes manuales de puntos por torneo (penalizaciones y correcciones).
// El motivo queda documentado: se muestra acá, en el historial, y se publica
// junto a la tabla de posiciones del sitio público.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import { adjustmentsForTournament, type AdjustmentRow } from '../lib/adjustments.ts';
import { listTeams, listTournaments } from '../lib/queries.ts';
import { adminLayout } from './admin.ts';
import { emptyNote } from './components.ts';

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

function historyRow(r: AdjustmentRow, slug: string): string {
  const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
  return `<tr>
  <td>${esc(r.team_name)}</td>
  <td class="num"><strong>${esc(sign)}</strong></td>
  <td>${esc(r.reason)}</td>
  <td class="muted small">${formatDateShort(r.created_at.slice(0, 10))}</td>
  <td class="num">
    <form method="post" action="/admin/ajustes/${r.id}/borrar">
      <input type="hidden" name="t" value="${escUrl(slug)}">
      <button class="btn btn-ghost btn-sm" type="submit" title="Borrar ajuste">✕</button>
    </form>
  </td>
</tr>`;
}

export interface AdjustmentsFlash {
  kind: 'error' | 'success';
  text: string;
}

export async function adjustmentsAdminPage(
  db: D1Database,
  slugParam: string | undefined,
  flashMsg?: AdjustmentsFlash
): Promise<string> {
  const tournaments = await listTournaments(db);
  if (tournaments.length === 0) {
    return await adminLayout(db, {
      title: 'Ajustes de puntos',
      active: 'ajustes',
      body: `<section class="hero" style="padding-bottom:12px">${pageHeadInner()}</section><div class="card"><div class="card-body">Primero creá un torneo.</div></div>`,
    });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  const [teams, rows] = await Promise.all([listTeams(db, true), adjustmentsForTournament(db, t.id)]);

  const history = rows.length
    ? `<div class="table-wrap"><table class="data">
  <thead><tr><th>Equipo</th><th class="num">Puntos</th><th>Motivo</th><th>Fecha</th><th></th></tr></thead>
  <tbody>${rows.map((r) => historyRow(r, t.slug)).join('')}</tbody>
</table></div>`
    : emptyNote('Todavía no hay ajustes en este torneo.');

  const teamOptions = teams
    .map((tm) => `<option value="${tm.id}">${esc(tm.name)}${tm.active ? '' : ' (inactivo)'}</option>`)
    .join('');

  const selector =
    tournaments.length > 1
      ? `<form method="get" action="/admin/ajustes"><select name="t" onchange="this.form.submit()">${tournaments
          .map(
            (x) =>
              `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`
          )
          .join('')}</select></form>`
      : '';

  const body = `
${flashMsg ? flash(flashMsg.kind, flashMsg.text) : ''}
<section class="hero" style="padding-bottom:12px">
  <div class="row-between">
    <div>
      <div class="hero-kicker">Panel</div>
      <h1>Puntos</h1>
    </div>
    ${selector}
  </div>
  <p class="hero-sub">Penalizaciones y correcciones de puntos. El motivo queda documentado y se publica junto a la tabla.</p>
</section>
<section class="block"><div class="card"><div class="card-body">
  <div class="uppercase mb-2">Sumar o restar puntos — ${esc(t.name)}</div>
  <form method="post" action="/admin/ajustes">
    <input type="hidden" name="t" value="${escUrl(t.slug)}">
    <div class="field">
      <label for="adj-team">Equipo</label>
      <select id="adj-team" name="team_id" required>${teamOptions}</select>
    </div>
    <div class="field">
      <label for="adj-delta">Puntos (negativo para penalizar)</label>
      <input id="adj-delta" name="delta" type="number" step="1" min="-100" max="100" placeholder="Ej: -3" required>
    </div>
    <div class="field">
      <label for="adj-reason">Motivo</label>
      <input id="adj-reason" name="reason" maxlength="200" placeholder="Ej: Inclusión de jugador no habilitado" required>
    </div>
    <button class="btn btn-primary" type="submit">Aplicar ajuste</button>
  </form>
  <p class="hint mb-0">El ajuste se acumula sobre los puntos de los partidos: no cambia PJ, goles ni diferencia. Queda asentado con fecha y motivo.</p>
</div></div></section>
<section class="block"><div class="card">
  <div class="card-head"><h2 style="font-size:1rem">Historial de ajustes</h2><span class="badge ghost">${rows.length}</span></div>
  <div class="card-body">${history}</div>
</div></section>`;
  return await adminLayout(db, { title: 'Ajustes de puntos', active: 'ajustes', body });
}

function pageHeadInner(): string {
  return `<div><div class="hero-kicker">Panel</div><h1>Puntos</h1></div>`;
}
