import { parseProspectsCSV, applyProspects, parseActivitiesCSV, applyActivities, leadsToCSV, activitiesToCSV, funnelToCSV, PROSPECT_COLUMNS, ACTIVITY_COLUMNS } from '../lib/io.js';
import { computeFunnel } from '../lib/funnel.js';
import { buildLeadRows } from '../lib/leads.js';
import { validateState, emptyState } from '../lib/model.js';
import { isValidISODate, formatDate, systemToday } from '../lib/dates.js';
import { esc } from '../lib/charts.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function previewHTML(p) {
  const r = p.result;
  const rejected = r.rejected.slice(0, 50).map((x) => `<li>Row on line ${x.line}: ${esc(x.errors.join('; '))}</li>`).join('');
  const warned = r.valid.filter((v) => v.warnings.length).slice(0, 50).map((x) => `<li>Line ${x.line}: ${esc(x.warnings.join('; '))}</li>`).join('');
  return `<div class="card" id="import-preview" aria-labelledby="h-preview">
    <h2 id="h-preview">Import preview — ${esc(p.fileName)}</h2>
    ${r.fileErrors.length ? `<div class="errors" role="alert"><ul>${r.fileErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <p><strong>${r.valid.length}</strong> row(s) ready to import · <strong>${r.rejected.length}</strong> rejected${p.kind === 'prospects' ? ` · <strong>${r.duplicatesOfExisting}</strong> look like existing organisations` : ''}.</p>
    ${rejected ? `<h3>Rejected rows (not imported)</h3><ul class="checklist small">${rejected}</ul>` : ''}
    ${warned ? `<h3>Warnings (imported, check afterwards)</h3><ul class="checklist small">${warned}</ul>` : ''}
    <div class="actions" style="margin-top:10px">
      <button class="btn primary" data-io="confirm-import" ${r.valid.length ? '' : 'disabled'}>Import ${r.valid.length} row(s)</button>
      <button class="btn" data-io="cancel-import">Cancel</button>
    </div></div>`;
}

export function renderData(ctx) {
  const s = ctx.state;
  const t = s.settings?.today;
  const log = (s.log ?? []).slice(0, 12);
  return `
  <div class="page-head"><div><h1>Import / Export</h1><p class="muted">CSV import with validation preview, CSV exports, JSON backup and the demo “today” date.</p></div></div>
  ${ctx.ui.pendingImport ? previewHTML(ctx.ui.pendingImport) : ''}
  <div class="grid grid-2" style="margin-top:16px">
    <section class="card" aria-labelledby="h-imp">
      <h2 id="h-imp">Import prospects (CSV)</h2>
      <p class="small muted">One row per prospect. Required column: <code>organisation_name</code>. Optional: ${PROSPECT_COLUMNS.slice(1).map((c) => `<code>${c}</code>`).join(', ')}. Dates as YYYY-MM-DD (DD/MM/YYYY is converted). You will see a preview before anything changes.</p>
      <div class="field"><label for="imp-prospects">Choose a prospects CSV file</label><input type="file" id="imp-prospects" accept=".csv,text/csv" data-import="prospects"></div>
      <div class="actions" style="margin-top:10px">
        <button class="btn small" data-io="example-prospects">Try the example file</button>
        <a class="btn small" href="sample-data/prospects-import-template.csv" download>Download template</a>
      </div>
    </section>
    <section class="card" aria-labelledby="h-impa">
      <h2 id="h-impa">Import activities (CSV)</h2>
      <p class="small muted">Adds logged activities to existing leads. Columns: ${ACTIVITY_COLUMNS.map((c) => `<code>${c}</code>`).join(', ')} (<code>opportunity_id</code> must exist, e.g. <code>opp-001</code>).</p>
      <div class="field"><label for="imp-activities">Choose an activities CSV file</label><input type="file" id="imp-activities" accept=".csv,text/csv" data-import="activities"></div>
      <div class="actions" style="margin-top:10px"><button class="btn small" data-io="example-activities">Try the example file</button></div>
    </section>
    <section class="card" aria-labelledby="h-exp">
      <h2 id="h-exp">Export</h2>
      <p class="small muted">CSV files are protected against spreadsheet formula injection (cells starting with = + - @ get a leading apostrophe; re-importing removes it).</p>
      <div class="actions">
        <button class="btn" data-io="export-leads">All leads (CSV)</button>
        <button class="btn" data-io="export-activities">Activities (CSV)</button>
        <button class="btn" data-io="export-funnel">Funnel metrics (CSV)</button>
      </div>
      <p class="small muted" style="margin-top:8px">To export only filtered leads, use “Export these leads” on the Leads page.</p>
    </section>
    <section class="card" aria-labelledby="h-backup">
      <h2 id="h-backup">Backup &amp; restore</h2>
      <p class="small muted">Data lives only in this browser’s localStorage. Back up to a JSON file to move it or keep a copy.</p>
      <div class="actions">
        <button class="btn" data-io="backup">Back up data (JSON)</button>
        <button class="btn" data-io="restore-pick">Restore from backup…</button>
        <input type="file" id="restore-file" accept=".json,application/json" hidden data-import="restore" aria-label="Backup JSON file">
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn" data-io="sample">Load sample data</button>
        <button class="btn danger" data-io="reset">Reset (delete all data)</button>
      </div>
    </section>
    <section class="card" aria-labelledby="h-today">
      <h2 id="h-today">“Today” for overdue calculations</h2>
      <p class="small muted">The sample data is dated around ${formatDate(s.meta?.demoToday || '2026-10-16')}, so the demo pins “today” to that date. Change it to see overdue follow-ups move.</p>
      <div class="form-grid">
        <div class="field"><label for="set-today">As-of date</label><input type="date" id="set-today" value="${esc(isValidISODate(t) ? t : '')}"></div>
        <div class="field" style="align-self:end"><span class="small muted">Currently: <strong>${formatDate(ctx.today())}</strong> ${t ? '(fixed date)' : '(system date)'}</span></div>
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn small" data-io="today-apply">Apply date</button>
        <button class="btn small" data-io="today-system">Use system date (${formatDate(systemToday())})</button>
        ${s.meta?.demoToday ? `<button class="btn small" data-io="today-demo">Use demo date (${formatDate(s.meta.demoToday)})</button>` : ''}
      </div>
    </section>
    <section class="card" aria-labelledby="h-log">
      <h2 id="h-log">Change log</h2>
      <p class="small muted">Local record of actions in this browser (latest first).</p>
      <ul class="timeline">${log.length ? log.map((l) => `<li><span class="cell-sub">${esc(l.at.replace('T', ' ').slice(0, 16))}</span> ${esc(l.message)}</li>`).join('') : '<li class="muted">No changes yet.</li>'}</ul>
    </section>
  </div>`;
}

async function readFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`File is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB.`);
  return file.text();
}

function preview(ctx, kind, fileName, text) {
  const result = kind === 'prospects' ? parseProspectsCSV(text, ctx.state) : parseActivitiesCSV(text, ctx.state);
  ctx.ui.pendingImport = { kind, fileName, result };
  ctx.render();
  document.getElementById('import-preview')?.scrollIntoView({ block: 'start' });
  document.querySelector('[data-io="confirm-import"]:not([disabled])')?.focus();
}

export function bindData(ctx, root) {
  root.addEventListener('change', async (e) => {
    const kind = e.target.dataset?.import;
    if (!kind || ctx.ui.view !== 'data') return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      if (kind === 'restore') {
        let obj;
        try {
          obj = JSON.parse(text);
        } catch {
          throw new Error('The file is not valid JSON.');
        }
        const v = validateState(obj);
        if (!v.ok) throw new Error(`Backup rejected: ${v.errors.join(' ')}`);
        if (!window.confirm(`Replace current data with ${v.state.opportunities.length} leads from ${file.name}?`)) return;
        ctx.ui.idFilter = null;
        ctx.commit(v.state, `Restored backup ${file.name}.`);
      } else {
        preview(ctx, kind, file.name, text);
      }
    } catch (err) {
      ctx.announce(err.message);
      ctx.ui.pendingImport = { kind, fileName: file.name, result: { valid: [], rejected: [], fileErrors: [err.message], duplicatesOfExisting: 0 } };
      ctx.render();
    } finally {
      e.target.value = '';
    }
  });

  root.addEventListener('click', async (e) => {
    if (ctx.ui.view !== 'data') return;
    const b = e.target.closest('[data-io]');
    if (!b) return;
    const act = b.dataset.io;
    const today = ctx.today();
    switch (act) {
      case 'example-prospects':
      case 'example-activities': {
        const kind = act === 'example-prospects' ? 'prospects' : 'activities';
        const name = `${kind}-import-example.csv`;
        try {
          const res = await fetch(`sample-data/${name}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          preview(ctx, kind, name, await res.text());
        } catch (err) {
          ctx.announce(`Could not load ${name}: ${err.message}`);
        }
        break;
      }
      case 'confirm-import': {
        const p = ctx.ui.pendingImport;
        if (!p) break;
        const res = p.kind === 'prospects' ? applyProspects(ctx.state, p.result.valid) : applyActivities(ctx.state, p.result.valid);
        ctx.ui.pendingImport = null;
        ctx.commit(res.state, `Imported ${res.added} ${p.kind === 'prospects' ? 'prospect' : 'activity'} row(s) from ${p.fileName}.`);
        break;
      }
      case 'restore-pick':
        document.getElementById('restore-file').click();
        break;
      case 'cancel-import':
        ctx.ui.pendingImport = null;
        ctx.render();
        break;
      case 'export-leads': {
        const rows = buildLeadRows(ctx.state, today, ctx.derived().quality.byOpp);
        ctx.download(`leads-all-${today}.csv`, leadsToCSV(rows));
        break;
      }
      case 'export-activities':
        ctx.download(`activities-${today}.csv`, activitiesToCSV(ctx.state));
        break;
      case 'export-funnel':
        ctx.download(`funnel-${today}.csv`, funnelToCSV(computeFunnel(ctx.state.opportunities)));
        break;
      case 'backup':
        ctx.download(`outreach-backup-${today}.json`, `${JSON.stringify(ctx.state, null, 2)}\n`, 'application/json');
        break;
      case 'sample':
        if (ctx.state.opportunities.length && !window.confirm('Replace current data with the synthetic sample? Back up first if you want to keep it.')) break;
        await ctx.loadSample();
        break;
      case 'reset':
        if (!window.confirm('Delete all data stored in this browser for this app? This cannot be undone.')) break;
        ctx.ui.idFilter = null;
        ctx.ui.pendingImport = null;
        ctx.commit(emptyState(), 'All data deleted. Start by importing a CSV or loading the sample.');
        break;
      case 'today-apply': {
        const v = document.getElementById('set-today').value;
        if (!isValidISODate(v)) {
          ctx.announce('Pick a valid date first.');
          break;
        }
        ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, today: v } }, `As-of date set to ${formatDate(v)}.`);
        break;
      }
      case 'today-system':
        ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, today: null } }, 'Using the system date for overdue calculations.');
        break;
      case 'today-demo':
        ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, today: ctx.state.meta.demoToday } }, `As-of date set to demo date ${formatDate(ctx.state.meta.demoToday)}.`);
        break;
      default:
        break;
    }
  });
}
