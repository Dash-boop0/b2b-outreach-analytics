// App bootstrap: state, persistence, routing and shared helpers. All DOM work lives in src/ui/*.
import { STORAGE_KEY } from './lib/constants.js';
import { emptyState, validateState, effectiveToday, appendLog } from './lib/model.js';
import { systemToday, formatDate } from './lib/dates.js';
import { qualityReport } from './lib/quality.js';
import { buildLeadRows, EMPTY_FILTERS } from './lib/leads.js';
import { renderDashboard, drawDashboardCharts, bindDashboard } from './ui/dashboard.js';
import { renderLeads, bindLeads } from './ui/leads.js';
import { renderQuality, bindQuality, drawQualityCharts } from './ui/quality.js';
import { renderData, bindData } from './ui/data.js';
import { renderMethod } from './ui/method.js';
import { bindDialog } from './ui/dialog.js';

const SAMPLE_URL = 'sample-data/sample-dataset.json';
/** Set when the visitor chose to start empty (or reset), so the sample is not auto-loaded again. */
const START_EMPTY_KEY = `${STORAGE_KEY}.startEmpty`;
const VIEWS = ['dashboard', 'leads', 'quality', 'data', 'method'];

const ctx = {
  state: emptyState(),
  storageOk: true,
  ui: {
    view: 'dashboard',
    filters: { ...EMPTY_FILTERS },
    idFilter: null, // { label, ids:Set } from Data quality drill-downs
    sort: { key: 'followUpDate', dir: 'asc' },
    dash: { owner: '', type: '' },
    pendingImport: null,
    cleanPreview: null,
  },
  _derived: null,
};

ctx.today = () => effectiveToday(ctx.state, systemToday());

/** Quality report + joined lead rows, cached per state object and as-of date. */
ctx.derived = () => {
  const today = ctx.today();
  if (ctx._derived && ctx._derived.state === ctx.state && ctx._derived.today === today) return ctx._derived;
  const quality = qualityReport(ctx.state, today);
  const rows = buildLeadRows(ctx.state, today, quality.byOpp);
  ctx._derived = { state: ctx.state, today, quality, rows };
  return ctx._derived;
};

function loadStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const res = validateState(JSON.parse(raw));
    return res.ok ? res.state : null;
  } catch {
    return null;
  }
}

function startEmptyChosen() {
  try { return window.localStorage.getItem(START_EMPTY_KEY) === '1'; } catch { return false; }
}

/** Remember that the visitor wants their own (empty) workspace rather than the auto-loaded sample. */
ctx.rememberStartEmpty = () => {
  try { window.localStorage.setItem(START_EMPTY_KEY, '1'); } catch { /* storage unavailable */ }
};

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx.state));
    ctx.storageOk = true;
  } catch {
    ctx.storageOk = false;
  }
}

/** Replace state, persist, log and re-render. */
ctx.commit = (next, message, { log = true, announce = true } = {}) => {
  ctx.state = log && message ? appendLog(next, message) : next;
  save();
  render();
  if (message && announce) ctx.announce(message);
};

let toastTimer = null;
ctx.announce = (message) => {
  const el = document.getElementById('status');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
};

ctx.navigate = (view) => {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
};

ctx.loadSample = async ({ quiet = false } = {}) => {
  try {
    const res = await fetch(SAMPLE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = validateState(await res.json());
    if (!v.ok) throw new Error(v.errors.join(' '));
    ctx.ui.filters = { ...EMPTY_FILTERS };
    ctx.ui.idFilter = null;
    ctx.commit(v.state, `Loaded synthetic sample data (${v.state.opportunities.length} prospects).`, { announce: !quiet });
    return true;
  } catch (e) {
    ctx.announce(`Could not load sample data (${e.message}). Serve the folder over http — see README.`);
    showBanner(`Could not load ${SAMPLE_URL}: ${e.message}. Open the app through a local web server (python3 -m http.server 8000), not as a file.`, 'error');
    return false;
  }
};

ctx.download = (filename, text, type = 'text/csv;charset=utf-8') => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.announce(`Downloaded ${filename}`);
};

function showBanner(html, kind = '', action = '') {
  document.getElementById('banner').innerHTML = `<div class="sample-banner${kind ? ` is-${kind}` : ''}" role="${kind === 'error' ? 'alert' : 'note'}"><p class="sample-banner__text">${html}</p>${action}</div>`;
}

function renderBanner() {
  if (!ctx.storageOk) {
    showBanner('<strong>Browser storage is unavailable.</strong> Changes will be lost when you close this tab — use “Back up data” on the Import / Export page.', 'error');
  } else if (ctx.state.meta?.synthetic) {
    showBanner('<strong>Synthetic sample data.</strong> All organisations, people and results are fictional and illustrative. This app never sends email or contacts anyone — activities are log entries only.', '',
      '<button type="button" class="sample-banner__action" data-action="start-own">Start with your own data</button>');
  } else {
    showBanner('<strong>Your working data.</strong> Stored only in this browser (localStorage). Nothing is uploaded and no email is ever sent — activities are log entries only.', 'info');
  }
  const t = ctx.today();
  const custom = ctx.state.settings?.today;
  document.getElementById('asof').innerHTML = `As of <strong class="tabular">${formatDate(t)}</strong>${custom ? ` <span class="muted">(${custom === ctx.state.meta?.demoToday ? 'demo date' : 'set date'})</span>` : ''}`;
}

const RENDERERS = { dashboard: renderDashboard, leads: renderLeads, quality: renderQuality, data: renderData, method: renderMethod };

function render() {
  renderBanner();
  const view = ctx.ui.view;
  document.querySelectorAll('#tabs a').forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const host = document.getElementById('view');
  host.innerHTML = RENDERERS[view](ctx);
  drawCharts();
}

function drawCharts() {
  if (ctx.ui.view === 'dashboard') drawDashboardCharts(ctx);
  if (ctx.ui.view === 'quality') drawQualityCharts(ctx);
}
ctx.render = render;

function route() {
  const v = location.hash.replace('#', '');
  const prev = ctx.ui.view;
  ctx.ui.view = VIEWS.includes(v) ? v : 'dashboard';
  render();
  if (prev !== ctx.ui.view) {
    window.scrollTo(0, 0);
    document.getElementById('main').focus({ preventScroll: true });
  }
}

async function init() {
  const stored = loadStored();
  // Probe storage availability once.
  try {
    window.localStorage.setItem(`${STORAGE_KEY}.probe`, '1');
    window.localStorage.removeItem(`${STORAGE_KEY}.probe`);
  } catch {
    ctx.storageOk = false;
  }
  const view = document.getElementById('view');
  bindDashboard(ctx, view);
  bindLeads(ctx, view);
  bindQuality(ctx, view);
  bindData(ctx, view);
  bindDialog(ctx, document.getElementById('dialog'));
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'load-sample') ctx.loadSample();
    if (b.dataset.action === 'go') ctx.navigate(b.dataset.view);
  });
  document.getElementById('banner').addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="start-own"]')) return;
    ctx.rememberStartEmpty();
    ctx.ui.filters = { ...EMPTY_FILTERS };
    ctx.ui.idFilter = null;
    ctx.ui.pendingImport = null;
    ctx.commit(emptyState(), 'Sample cleared. Import your own CSV, add a prospect, or load the sample again.');
    ctx.navigate('dashboard');
  });
  window.addEventListener('hashchange', route);
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 120);
  });
  if (stored) {
    ctx.state = stored;
    route();
  } else if (startEmptyChosen()) {
    route();
  } else {
    // First visit: nothing saved and the sample was never declined, so open the populated demo.
    route();
    // Quiet: the synthetic-data banner already explains it; no toast over the dashboard on arrival.
    await ctx.loadSample({ quiet: true });
  }
}

init();
