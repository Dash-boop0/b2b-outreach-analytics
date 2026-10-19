import { STAGES, ORG_TYPES, PRIORITIES } from '../lib/constants.js';
import { filterLeads, sortLeads, ownersOf, EMPTY_FILTERS } from '../lib/leads.js';
import { leadsToCSV } from '../lib/io.js';
import { formatDate } from '../lib/dates.js';
import { isValidEmail } from '../lib/normalize.js';
import { esc } from '../lib/charts.js';
import { emptyStateHTML } from './dashboard.js';
import { openLeadDialog, openProspectDialog } from './dialog.js';

const FOLLOW_LABEL = { overdue: 'Overdue', today: 'Due today', soon: 'Due ≤7d', none: 'No date', later: '', closed: '' };

export function currentRows(ctx) {
  const { rows } = ctx.derived();
  const f = { ...ctx.ui.filters, ids: ctx.ui.idFilter?.ids };
  return sortLeads(filterLeads(rows, f), ctx.ui.sort.key, ctx.ui.sort.dir);
}

function sortHeader(ctx, key, label, cls = '') {
  const active = ctx.ui.sort.key === key;
  const arrow = active ? (ctx.ui.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const aria = active ? (ctx.ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th scope="col" class="${cls}" aria-sort="${aria}"><button class="sort" data-sort="${key}" aria-pressed="${active}">${label}${arrow}</button></th>`;
}

function tableHTML(ctx) {
  const rows = currentRows(ctx);
  const total = ctx.state.opportunities.length;
  const count = `<p class="small muted" id="lead-count" aria-live="polite">Showing <strong>${rows.length}</strong> of ${total} leads.</p>`;
  if (rows.length === 0) {
    return `${count}<div class="card empty"><h2>No leads match these filters</h2><p>Try clearing a filter or searching for a different name.</p><div class="actions"><button class="btn" data-lead-action="clear">Clear filters</button></div></div>`;
  }
  const body = rows.map((r) => {
    const emailBadge = !r.email ? '<span class="badge issue">no email</span>' : !isValidEmail(r.email) ? '<span class="badge issue">invalid email</span>' : '';
    const fu = r.followUpDate ? `<span class="tabular">${esc(formatDate(r.followUpDate) || r.followUpDate)}</span>` : '<span class="muted">—</span>';
    const fuBadge = FOLLOW_LABEL[r.followUp] ? ` <span class="badge ${r.followUp}">${FOLLOW_LABEL[r.followUp]}</span>` : '';
    return `<tr data-id="${esc(r.id)}">
      <td><button class="btn link cell-main" data-edit="${esc(r.id)}">${esc(r.orgName)}</button><div class="cell-sub">${esc(r.orgType)}${r.region ? ` · ${esc(r.region)}` : ''}</div></td>
      <td>${esc(r.contactName) || '<span class="muted">—</span>'}<div class="cell-sub">${esc(r.email)} ${emailBadge}</div></td>
      <td><span class="pill ${esc(r.stage)}">${esc(r.stageLabel)}</span></td>
      <td class="prio-${esc(r.priority)}">${esc(r.priority)}</td>
      <td>${r.owner ? esc(r.owner) : '<span class="badge issue">unassigned</span>'}</td>
      <td>${esc(r.nextAction) || '<span class="muted">—</span>'}</td>
      <td>${fu}${fuBadge}</td>
      <td class="tabular">${r.lastActivity ? esc(formatDate(r.lastActivity)) : '<span class="muted">none</span>'}<div class="cell-sub">${r.activityCount} logged</div></td>
      <td>${r.issues.length ? `<span class="badge issue" title="${esc(r.issues.join('; '))}">${r.issues.length}</span>` : ''}</td>
      <td><button class="btn small" data-edit="${esc(r.id)}" aria-label="Edit ${esc(r.orgName)}">Edit</button></td>
    </tr>`;
  }).join('');
  return `${count}<div class="table-wrap"><table class="data leads"><caption class="sr-only">Leads</caption><thead><tr>
    ${sortHeader(ctx, 'orgName', 'Organisation')}${sortHeader(ctx, 'contactName', 'Contact')}${sortHeader(ctx, 'stage', 'Stage')}
    ${sortHeader(ctx, 'priority', 'Priority')}${sortHeader(ctx, 'owner', 'Owner')}<th scope="col">Next action</th>
    ${sortHeader(ctx, 'followUpDate', 'Follow-up')}${sortHeader(ctx, 'lastActivity', 'Last activity')}<th scope="col">Issues</th><th scope="col"><span class="sr-only">Actions</span></th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderLeads(ctx) {
  if (ctx.state.opportunities.length === 0) {
    return `<div class="page-head"><h1>Leads</h1><button class="btn primary" data-lead-action="add">Add prospect</button></div>${emptyStateHTML()}`;
  }
  const f = ctx.ui.filters;
  const owners = ownersOf(ctx.state.opportunities);
  const sel = (v, cur) => (v === cur ? ' selected' : '');
  const opt = (v, l, cur) => `<option value="${esc(v)}"${sel(v, cur)}>${esc(l)}</option>`;
  const chip = ctx.ui.idFilter
    ? `<span class="chip">Showing: ${esc(ctx.ui.idFilter.label)} <button class="btn link" data-lead-action="clear-ids" aria-label="Remove ${esc(ctx.ui.idFilter.label)} filter">×</button></span>`
    : '';
  return `
  <div class="page-head">
    <div><h1>Leads</h1><p class="muted">Edit status, priority, owner, next action and follow-up date. Overdue = follow-up date before ${formatDate(ctx.today())}.</p></div>
    <div class="actions"><button class="btn" data-lead-action="export">Export these leads (CSV)</button><button class="btn primary" data-lead-action="add">Add prospect</button></div>
  </div>
  <div class="card">
    <form class="filters" role="search" aria-label="Filter leads" onsubmit="return false">
      <div class="field search"><label for="f-q">Search</label><input type="search" id="f-q" data-filter="q" value="${esc(f.q)}" placeholder="Organisation, contact, email, domain…" autocomplete="off"></div>
      <div class="field"><label for="f-stage">Stage</label><select id="f-stage" data-filter="stage">${opt('', 'All stages', f.stage)}${STAGES.map((s) => opt(s.key, s.label, f.stage)).join('')}</select></div>
      <div class="field"><label for="f-owner">Owner</label><select id="f-owner" data-filter="owner">${opt('', 'All owners', f.owner)}${owners.map((o) => opt(o, o, f.owner)).join('')}${opt('__unassigned', 'Unassigned', f.owner)}</select></div>
      <div class="field"><label for="f-priority">Priority</label><select id="f-priority" data-filter="priority">${opt('', 'All', f.priority)}${PRIORITIES.map((p) => opt(p, p, f.priority)).join('')}</select></div>
      <div class="field"><label for="f-type">Type</label><select id="f-type" data-filter="type">${opt('', 'All types', f.type)}${ORG_TYPES.map((t) => opt(t, t, f.type)).join('')}</select></div>
      <div class="field"><label for="f-followUp">Follow-up</label><select id="f-followUp" data-filter="followUp">${opt('', 'Any', f.followUp)}${opt('overdue', 'Overdue', f.followUp)}${opt('due7', 'Due in next 7 days', f.followUp)}${opt('none', 'No date set (open)', f.followUp)}</select></div>
    </form>
    <div class="filter-row">
      <label class="checkbox"><input type="checkbox" data-filter="issuesOnly"${f.issuesOnly ? ' checked' : ''}> Only leads with data-quality issues</label>
      ${chip}
      <button class="btn small" data-lead-action="clear">Clear filters</button>
    </div>
  </div>
  <div class="card" id="leads-table">${tableHTML(ctx)}</div>`;
}

function refreshTable(ctx) {
  const el = document.getElementById('leads-table');
  if (el) el.innerHTML = tableHTML(ctx);
}

export function bindLeads(ctx, root) {
  const onFilter = (e) => {
    const k = e.target.dataset?.filter;
    if (!k || ctx.ui.view !== 'leads') return;
    ctx.ui.filters = { ...ctx.ui.filters, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value };
    refreshTable(ctx);
  };
  root.addEventListener('input', onFilter);
  root.addEventListener('change', (e) => {
    if (e.target.dataset?.filter && e.target.type !== 'search') onFilter(e);
  });
  root.addEventListener('click', (e) => {
    if (ctx.ui.view !== 'leads') return;
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      ctx.ui.sort = { key, dir: ctx.ui.sort.key === key && ctx.ui.sort.dir === 'asc' ? 'desc' : 'asc' };
      refreshTable(ctx);
      document.querySelector(`[data-sort="${key}"]`)?.focus();
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      openLeadDialog(ctx, edit.dataset.edit);
      return;
    }
    const a = e.target.closest('[data-lead-action]');
    if (!a) return;
    const act = a.dataset.leadAction;
    if (act === 'clear') {
      ctx.ui.filters = { ...EMPTY_FILTERS };
      ctx.ui.idFilter = null;
      ctx.render();
    } else if (act === 'clear-ids') {
      ctx.ui.idFilter = null;
      ctx.render();
    } else if (act === 'add') {
      openProspectDialog(ctx);
    } else if (act === 'export') {
      const rows = currentRows(ctx);
      ctx.download(`leads-${ctx.today()}.csv`, leadsToCSV(rows));
    }
  });
}
