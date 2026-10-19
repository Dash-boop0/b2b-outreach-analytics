import { computeFunnel, formatRate, RATE_DEFINITIONS, countByStage, funnelByOwner } from '../lib/funnel.js';
import { weeklyTrend, ownersOf } from '../lib/leads.js';
import { STAGES, ORG_TYPES } from '../lib/constants.js';
import { stackedColumns, horizontalBars, stackedBars, legendHTML, dataTable, esc } from '../lib/charts.js';
import { funnelToCSV } from '../lib/io.js';
import { formatDate } from '../lib/dates.js';

const TYPE_SERIES = [
  { key: 'email', name: 'Email', color: 'var(--s1)' },
  { key: 'call', name: 'Call', color: 'var(--s2)' },
  { key: 'linkedin', name: 'LinkedIn', color: 'var(--s5)' },
  { key: 'meeting', name: 'Meeting', color: 'var(--s3)' },
];
const REPLY_LINE = { name: 'Replies received', color: 'var(--s4)', kind: 'line' };
const OWNER_GROUPS = [
  { name: 'Not contacted', color: 'var(--s6)', stages: ['not_contacted'] },
  { name: 'Contacted / replied', color: 'var(--s1)', stages: ['contacted', 'replied'] },
  { name: 'Qualified → proposal', color: 'var(--s5)', stages: ['qualified', 'meeting_booked', 'proposal'] },
  { name: 'Won', color: 'var(--s3)', stages: ['won'] },
  { name: 'Lost', color: 'var(--s2)', stages: ['lost'] },
];
const stageColor = (k) => (k === 'won' ? 'var(--s3)' : k === 'lost' ? 'var(--s2)' : k === 'not_contacted' ? 'var(--s6)' : 'var(--s1)');

function scoped(ctx) {
  const { owner, type } = ctx.ui.dash;
  const orgType = new Map(ctx.state.organisations.map((o) => [o.id, o.type]));
  const opps = ctx.state.opportunities.filter((o) => {
    if (owner === '__unassigned' && (o.owner ?? '').trim()) return false;
    if (owner && owner !== '__unassigned' && (o.owner ?? '').trim() !== owner) return false;
    if (type && orgType.get(o.orgId) !== type) return false;
    return true;
  });
  const ids = new Set(opps.map((o) => o.id));
  const activities = ctx.state.activities.filter((a) => ids.has(a.opportunityId));
  const label = [owner ? `Owner: ${owner === '__unassigned' ? 'Unassigned' : owner}` : '', type ? `Type: ${type}` : ''].filter(Boolean).join(', ') || 'All leads';
  return { opps, ids, activities, label };
}

export function emptyStateHTML(title = 'No prospects yet') {
  return `<div class="card empty"><h2>${esc(title)}</h2>
    <p>Load the synthetic sample (100 fictional institutional prospects) or import your own CSV on the Import / Export page.</p>
    <div class="actions"><button class="btn primary" data-action="load-sample">Load sample data</button>
    <button class="btn" data-action="go" data-view="data">Import a CSV</button></div></div>`;
}

export function renderDashboard(ctx) {
  if (ctx.state.opportunities.length === 0) return `<div class="page-head"><h1>Dashboard</h1></div>${emptyStateHTML()}`;
  const { opps, activities, label } = scoped(ctx);
  const { quality, rows } = ctx.derived();
  const today = ctx.today();
  const f = computeFunnel(opps);
  const c = f.counts;
  const overdue = rows.filter((r) => r.followUp === 'overdue' && (!ctx.ui.dash.owner || (ctx.ui.dash.owner === '__unassigned' ? !r.owner : r.owner === ctx.ui.dash.owner)) && (!ctx.ui.dash.type || r.orgType === ctx.ui.dash.type)).length;
  const owners = ownersOf(ctx.state.opportunities);
  const sel = (v, cur) => (v === cur ? ' selected' : '');

  const funnelSteps = [
    ['Total prospects', c.total],
    ['Contacted', c.contacted],
    ['Replied', c.replied],
    ['Qualified interest', c.qualified],
    ['Meeting booked', c.meetings],
  ];
  const funnel = `<ol class="funnel" aria-label="Funnel counts">${funnelSteps
    .map(([l, n]) => `<li><span>${l}</span><span class="bar" aria-hidden="true"><span style="width:${c.total ? (n / c.total) * 100 : 0}%"></span></span><span class="count">${n}</span></li>`)
    .join('')}</ol>`;
  const rates = `<div class="rates">${RATE_DEFINITIONS.map((d) => {
    const r = f.rates[d.key];
    return `<div class="rate" data-rate="${d.key}"><div class="l">${d.label}</div><div class="v${r.value === null ? ' na' : ''}">${formatRate(r)}</div>
      <div class="d">${r.numerator} ÷ ${r.denominator} — ${esc(d.text.toLowerCase())}</div></div>`;
  }).join('')}<div class="rate" data-rate="win"><div class="l">Win rate (closed)</div><div class="v${f.rates.win.value === null ? ' na' : ''}">${formatRate(f.rates.win)}</div><div class="d">${c.won} ÷ ${c.won + c.lost} — won ÷ (won + lost)</div></div></div>`;

  const qTotal = quality.checks.reduce((s, q) => s + q.count, 0);

  return `
  <div class="page-head">
    <div><h1>Dashboard</h1><p class="muted">Funnel, activity trend, pipeline and data quality for <strong>${esc(label)}</strong> · ${opps.length} prospects.</p></div>
    <div class="actions" role="group" aria-label="Dashboard scope">
      <div class="field"><label for="dash-owner">Owner</label><select id="dash-owner" data-dash="owner"><option value="">All owners</option>${owners.map((o) => `<option value="${esc(o)}"${sel(o, ctx.ui.dash.owner)}>${esc(o)}</option>`).join('')}<option value="__unassigned"${sel('__unassigned', ctx.ui.dash.owner)}>Unassigned</option></select></div>
      <div class="field"><label for="dash-type">Organisation type</label><select id="dash-type" data-dash="type"><option value="">All types</option>${ORG_TYPES.map((t) => `<option${sel(t, ctx.ui.dash.type)}>${t}</option>`).join('')}</select></div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="label">Prospects</div><div class="value">${c.total}</div><div class="sub">${c.open} open</div></div>
    <div class="kpi"><div class="label">Contacted</div><div class="value">${c.contacted}</div><div class="sub">${formatRate(f.rates.outreach)} of prospects</div></div>
    <div class="kpi"><div class="label">Replied</div><div class="value">${c.replied}</div><div class="sub">${formatRate(f.rates.reply)} of contacted</div></div>
    <div class="kpi"><div class="label">Qualified interest</div><div class="value">${c.qualified}</div><div class="sub">${formatRate(f.rates.qualified)} of replied</div></div>
    <div class="kpi"><div class="label">Meetings booked</div><div class="value">${c.meetings}</div><div class="sub">${formatRate(f.rates.meeting)} of qualified</div></div>
    <a class="kpi${overdue ? ' alert' : ''}" href="#leads" data-overdue-link><div class="label">Overdue follow-ups</div><div class="value">${overdue}</div><div class="sub">before ${formatDate(today)} →</div></a>
  </div>
  <div class="grid grid-2">
    <section class="card" aria-labelledby="h-funnel">
      <div class="card-head"><h2 id="h-funnel">Outreach funnel</h2><button class="btn small" data-dash-action="export-funnel">Export funnel CSV</button></div>
      ${funnel}
      ${rates}
      <p class="small muted" style="margin-top:10px">Counts use the furthest stage each lead has reached; a Lost lead counts up to its “lost after” stage. Divide-by-zero shows <strong>n/a</strong>. <a href="#method">Definitions</a></p>
    </section>
    <section class="card" aria-labelledby="h-trend">
      <div class="card-head"><h2 id="h-trend">Weekly activity &amp; replies</h2><span class="small muted">12 weeks to ${formatDate(today)}</span></div>
      <div class="chart-box" data-chart="trend"></div>
      ${legendHTML([...TYPE_SERIES, REPLY_LINE])}
      <details class="fallback"><summary>Show data table</summary><div data-table="trend"></div></details>
    </section>
    <section class="card" aria-labelledby="h-stage">
      <div class="card-head"><h2 id="h-stage">Pipeline by stage</h2><span class="small muted">current stage</span></div>
      <div class="chart-box" data-chart="stage"></div>
      <details class="fallback"><summary>Show data table</summary><div data-table="stage"></div></details>
    </section>
    <section class="card" aria-labelledby="h-owner">
      <div class="card-head"><h2 id="h-owner">Pipeline by owner</h2></div>
      <div class="chart-box" data-chart="owner"></div>
      ${legendHTML(OWNER_GROUPS)}
      <div data-table="owner" style="margin-top:12px"></div>
    </section>
    <section class="card span-2" aria-labelledby="h-quality">
      <div class="card-head"><h2 id="h-quality">Data-quality indicators</h2><a class="btn small" href="#quality">Review &amp; fix (${qTotal})</a></div>
      <p class="small muted">Across all records (not affected by the scope filters). Duplicates are candidate pairs awaiting review.</p>
      <div class="chart-box" data-chart="quality"></div>
      <details class="fallback"><summary>Show data table</summary><div data-table="quality"></div></details>
    </section>
  </div>`;
}

export function drawDashboardCharts(ctx) {
  const root = document.getElementById('view');
  if (!root.querySelector('[data-chart]')) return;
  const { opps, activities } = scoped(ctx);
  const { quality } = ctx.derived();
  const today = ctx.today();
  const width = (el) => Math.max(280, el.clientWidth || 560);

  const trend = weeklyTrend(activities, today, 12);
  const tEl = root.querySelector('[data-chart="trend"]');
  tEl.innerHTML = stackedColumns({
    title: 'Weekly outbound activity by type, with replies received',
    desc: `Outbound touches per ISO week (Monday start) for the 12 weeks to ${formatDate(today)}; the line shows inbound replies.`,
    width: width(tEl),
    categories: trend.map((w) => w.label),
    series: TYPE_SERIES.map((s) => ({ name: s.name, color: s.color, values: trend.map((w) => w.outbound[s.key]) })),
    line: { name: REPLY_LINE.name, color: REPLY_LINE.color, values: trend.map((w) => w.replies) },
  });
  root.querySelector('[data-table="trend"]').innerHTML = dataTable(
    'Weekly activity (reply ratio = replies ÷ outbound touches in the same week)',
    [{ key: 'week', label: 'Week of' }, { key: 'email', label: 'Email', num: true }, { key: 'call', label: 'Call', num: true }, { key: 'linkedin', label: 'LinkedIn', num: true }, { key: 'meeting', label: 'Meeting', num: true }, { key: 'outbound', label: 'Outbound', num: true }, { key: 'replies', label: 'Replies', num: true }, { key: 'ratio', label: 'Reply ratio', num: true }],
    trend.map((w) => ({ week: formatDate(w.weekStart), ...w.outbound, outbound: w.outboundTotal, replies: w.replies, ratio: w.replyRatio === null ? 'n/a' : `${(w.replyRatio * 100).toFixed(1)}%` })),
  );

  const byStage = countByStage(opps);
  const sEl = root.querySelector('[data-chart="stage"]');
  const stageItems = STAGES.map((s) => ({ label: s.label, value: byStage[s.key], color: stageColor(s.key) }));
  sEl.innerHTML = horizontalBars({ title: 'Leads by current pipeline stage', desc: STAGES.map((s) => `${s.label}: ${byStage[s.key]}`).join(', '), width: width(sEl), items: stageItems });
  root.querySelector('[data-table="stage"]').innerHTML = dataTable('Leads by current stage', [{ key: 'label', label: 'Stage' }, { key: 'value', label: 'Leads', num: true }], stageItems);

  const owners = funnelByOwner(opps);
  const oEl = root.querySelector('[data-chart="owner"]');
  oEl.innerHTML = stackedBars({
    title: 'Leads per owner by stage group',
    desc: owners.map((o) => `${o.owner}: ${o.counts.total} leads`).join(', '),
    width: width(oEl),
    categories: owners.map((o) => o.owner),
    series: OWNER_GROUPS.map((g) => ({ name: g.name, color: g.color, values: owners.map((o) => g.stages.reduce((s, k) => s + o.byStage[k], 0)) })),
  });
  root.querySelector('[data-table="owner"]').innerHTML = dataTable(
    'Funnel by owner (rates use the same denominators as the main funnel)',
    [{ key: 'owner', label: 'Owner' }, { key: 'total', label: 'Leads', num: true }, { key: 'contacted', label: 'Contacted', num: true }, { key: 'reply', label: 'Reply rate', num: true }, { key: 'meetings', label: 'Meetings', num: true }, { key: 'om', label: 'Overall mtg rate', num: true }, { key: 'won', label: 'Won', num: true }],
    owners.map((o) => ({ owner: o.owner, total: o.counts.total, contacted: o.counts.contacted, reply: formatRate(o.rates.reply), meetings: o.counts.meetings, om: formatRate(o.rates.overallMeeting), won: o.counts.won })),
  );

  const qEl = root.querySelector('[data-chart="quality"]');
  const qItems = quality.checks.map((q) => ({ label: q.label, value: q.count, note: q.unit, color: q.count ? 'var(--s2)' : 'var(--s3)' }));
  qEl.innerHTML = horizontalBars({ title: 'Data-quality issues by check', desc: quality.checks.map((q) => `${q.label}: ${q.count} ${q.unit}`).join(', '), width: width(qEl), items: qItems });
  root.querySelector('[data-table="quality"]').innerHTML = dataTable('Data-quality checks', [{ key: 'label', label: 'Check' }, { key: 'value', label: 'Count', num: true }, { key: 'note', label: 'Counted in' }], qItems);
}

export function bindDashboard(ctx, root) {
  root.addEventListener('change', (e) => {
    const k = e.target.dataset?.dash;
    if (!k || ctx.ui.view !== 'dashboard') return;
    ctx.ui.dash[k] = e.target.value;
    ctx.render();
    document.getElementById(`dash-${k}`)?.focus();
  });
  root.addEventListener('click', (e) => {
    if (ctx.ui.view !== 'dashboard') return;
    if (e.target.closest('[data-overdue-link]')) {
      ctx.ui.filters = { ...ctx.ui.filters, followUp: 'overdue', owner: ctx.ui.dash.owner, type: ctx.ui.dash.type };
      ctx.ui.idFilter = null;
    }
    const b = e.target.closest('[data-dash-action]');
    if (b?.dataset.dashAction === 'export-funnel') {
      const { opps, label } = scoped(ctx);
      ctx.download(`funnel-${ctx.today()}.csv`, funnelToCSV(computeFunnel(opps), label));
    }
  });
}
