// Panel: ajustes manuales de puntos por torneo (penalizaciones y correcciones).
// El motivo queda documentado: se muestra acá, en el historial, y se publica
// junto a la tabla de posiciones del sitio público.

import { esc, escUrl } from '../lib/html.ts';
import { formatDateShort } from '../lib/format.ts';
import { adjustmentsForTournament, type AdjustmentRow } from '../lib/adjustments.ts';
import { listTournaments } from '../lib/queries.ts';
import { participantsOrAllTeams } from '../lib/participation.ts';
import { adminLayout } from './admin.ts';
import { emptyNote, icon } from './components.ts';

function flash(kind: 'error' | 'success', message: string | undefined): string {
  if (!message) return '';
  return `<div class="${kind === 'error' ? 'error-box' : 'success-box'}">${esc(message)}</div>`;
}

function historyRow(r: AdjustmentRow, slug: string): string {
  const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
  return `<tr>
  <td>${esc(r.team_name)}</td>
  <td class="num"><strong class="${r.delta > 0 ? 'adj-pos' : 'adj-neg'}">${esc(sign)}</strong></td>
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
      body: `<div class="dash-hero"><div class="dash-hero-tx"><span class="dash-kicker">Administración</span><h1>Ajustes de puntos</h1></div></div><div class="card"><div class="card-body">Primero creá un torneo.</div></div>`,
    });
  }
  const t = (slugParam ? tournaments.find((x) => x.slug === slugParam) : undefined) ?? tournaments[0]!;
  // El select de equipo lista SOLO participantes del torneo seleccionado
  // (con retrocompatibilidad: torneo sin filas de participación → todos).
  // El historial muestra los ajustes ya guardados tal cual, aunque su equipo
  // hoy no participe.
  const [{ teams }, rows] = await Promise.all([participantsOrAllTeams(db, t.id), adjustmentsForTournament(db, t.id)]);

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
      ? `<form method="get" action="/admin/ajustes" class="pselect"><label for="adjPick">Torneo</label><div class="tpage-search pselect-box">${icon('trophy', 15)}<select id="adjPick" name="t" onchange="this.form.submit()">${tournaments
          .map(
            (x) =>
              `<option value="${escUrl(x.slug)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`
          )
          .join('')}</select></div></form>`
      : '';

  const body = `
${flashMsg ? flash(flashMsg.kind, flashMsg.text) : ''}
<div class="dash-hero">
  <div class="dash-hero-tx">
    <span class="dash-kicker">Administración</span>
    <h1>Ajustes de puntos</h1>
    <p>Penalizaciones y correcciones: el motivo queda documentado y se publica junto a la tabla del sitio público.</p>
  </div>
  ${selector}
</div>
<section class="block"><div class="dash-card fgen">
  <div class="dash-card-head"><h2>${icon('bolt', 16)} Aplicar ajuste · ${esc(t.name)}</h2></div>
  <form method="post" action="/admin/ajustes" class="padd">
    <input type="hidden" name="t" value="${escUrl(t.slug)}">
    <div class="field grow">
      <label for="adj-team">Equipo</label>
      <select id="adj-team" name="team_id" required>${teamOptions}</select>
    </div>
    <div class="field" style="max-width:150px">
      <label for="adj-delta">Puntos (negativo penaliza)</label>
      <input id="adj-delta" name="delta" type="number" step="1" min="-100" max="100" placeholder="Ej: -3" required>
    </div>
    <div class="field grow">
      <label for="adj-reason">Motivo</label>
      <input id="adj-reason" name="reason" maxlength="200" placeholder="Ej: Inclusión de jugador no habilitado" required>
    </div>
    <button class="btn btn-primary" type="submit">Aplicar ajuste</button>
  </form>
  <p class="hint" style="margin-bottom:0">El ajuste se acumula sobre los puntos de los partidos: no cambia PJ, goles ni diferencia. Queda asentado con fecha y motivo.</p>
</div></section>
<section class="block"><div class="dash-card">
  <div class="dash-card-head"><h2>${icon('list', 16)} Historial de ajustes</h2><span class="badge ghost">${rows.length}</span></div>
  ${history}
</div></section>`;
  return await adminLayout(db, { title: 'Ajustes de puntos', active: 'ajustes', body });
}
