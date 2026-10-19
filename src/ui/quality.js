import { cleanState } from '../lib/quality.js';
import { mergeOrganisations, mergeContacts, dismissPair } from '../lib/dedup.js';
import { stageLabel } from '../lib/constants.js';
import { horizontalBars, esc } from '../lib/charts.js';
import { emptyStateHTML } from './dashboard.js';

function orgCard(ctx, id) {
  const o = ctx.state.organisations.find((x) => x.id === id);
  if (!o) return '<div>(missing)</div>';
  const opps = ctx.state.opportunities.filter((p) => p.orgId === id);
  const nContacts = ctx.state.contacts.filter((c) => c.orgId === id).length;
  return `<div><strong>${esc(o.name)}</strong><div class="cell-sub">${esc(o.id)} · ${esc(o.type)} · domain: ${esc(o.domain || '—')}</div>
    <div class="small">${nContacts} contact(s) · ${opps.map((p) => `${esc(stageLabel(p.stage))} (${esc(p.owner || 'unassigned')})`).join(', ') || 'no lead'}</div></div>`;
}

function contactCard(ctx, id) {
  const c = ctx.state.contacts.find((x) => x.id === id);
  if (!c) return '<div>(missing)</div>';
  const org = ctx.state.organisations.find((o) => o.id === c.orgId);
  return `<div><strong>${esc(`${c.firstName} ${c.lastName}`.trim() || '(no name)')}</strong><div class="cell-sub">${esc(c.id)} · ${esc(c.email || 'no email')}</div>
    <div class="small">${esc(c.title || '')}${c.title ? ' · ' : ''}${esc(org?.name ?? '')}</div></div>`;
}

function pairHTML(ctx, p) {
  const isOrg = p.kind === 'org';
  const card = isOrg ? orgCard : contactCard;
  const kindLabel = isOrg ? 'organisation' : 'contact';
  return `<div class="pair" data-pair="${esc(p.id)}">
    <div class="reasons">${p.reasons.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}<span class="small muted">matched on “${esc(p.matchedOn[0].replace(/^[^:]*::/, ''))}”</span></div>
    <div class="pair-cols">${card(ctx, p.a)}${card(ctx, p.b)}</div>
    <div class="actions">
      <button class="btn small primary" data-merge="${p.kind}" data-keep="${esc(p.a)}" data-drop="${esc(p.b)}">Keep left, merge right into it</button>
      <button class="btn small" data-merge="${p.kind}" data-keep="${esc(p.b)}" data-drop="${esc(p.a)}">Keep right</button>
      <button class="btn small" data-dismiss="${esc(p.id)}" aria-label="Not a duplicate: dismiss this ${kindLabel} pair">Not a duplicate</button>
    </div></div>`;
}

export function renderQuality(ctx) {
  if (ctx.state.opportunities.length === 0 && ctx.state.organisations.length === 0) return `<div class="page-head"><h1>Data quality</h1></div>${emptyStateHTML()}`;
  const { quality } = ctx.derived();
  const dup = quality.duplicates;
  const preview = ctx.ui.cleanPreview;
  const changeRows = preview ? preview.changes.slice(0, 60).map((c) => `<tr><td>${esc(c.entity)}</td><td>${esc(c.id)}</td><td>${esc(c.field)}</td><td><code>${esc(JSON.stringify(c.from))}</code></td><td><code>${esc(JSON.stringify(c.to))}</code></td></tr>`).join('') : '';
  const cleanBody = !preview
    ? `<p class="small muted">Trims whitespace, lower-cases emails, normalises domains (removes https://, www., paths) and converts DD/MM/YYYY follow-up dates to YYYY-MM-DD. Never deletes records or guesses missing values. You will see every change before it is applied.</p>
       <button class="btn" data-q-action="preview-clean">Preview clean-up</button>`
    : preview.changes.length === 0
      ? `<p>Nothing to clean — all fields are already normalised.</p><button class="btn small" data-q-action="discard-clean">Close</button>`
      : `<p><strong>${preview.changes.length}</strong> field change(s) proposed${preview.changes.length > 60 ? ' (first 60 shown)' : ''}.</p>
         <div class="table-wrap"><table class="data"><caption>Proposed changes</caption><thead><tr><th>Record</th><th>Id</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${changeRows}</tbody></table></div>
         <div class="actions" style="margin-top:10px"><button class="btn primary" data-q-action="apply-clean">Apply ${preview.changes.length} change(s)</button><button class="btn" data-q-action="discard-clean">Discard</button></div>`;

  return `
  <div class="page-head"><div><h1>Data quality</h1><p class="muted">Find and fix missing or invalid data, then review duplicate candidates.</p></div></div>
  <div class="grid grid-2">
    <section class="card" aria-labelledby="h-checks">
      <div class="card-head"><h2 id="h-checks">Checks</h2></div>
      <ul class="quality-list">${quality.checks.map((q) => `<li><div><strong>${esc(q.label)}</strong><div class="small muted">${esc(q.description)} Counted in ${esc(q.unit)}.</div></div>
        <div class="actions"><span class="count${q.count ? '' : ' zero'}">${q.count}</span>${q.oppIds.size ? `<button class="btn small" data-show-check="${q.key}">Show ${q.oppIds.size} lead(s)</button>` : ''}</div></li>`).join('')}</ul>
      <p class="small muted" style="margin-top:8px">Overdue follow-ups (pipeline hygiene, not a data error): <strong>${quality.overdue}</strong>.</p>
    </section>
    <section class="card" aria-labelledby="h-qchart">
      <div class="card-head"><h2 id="h-qchart">Issues at a glance</h2></div>
      <div class="chart-box" data-chart="quality-page"></div>
    </section>
    <section class="card span-2" aria-labelledby="h-clean">
      <div class="card-head"><h2 id="h-clean">Clean data</h2></div>
      ${cleanBody}
    </section>
    <section class="card span-2" aria-labelledby="h-dups">
      <div class="card-head"><h2 id="h-dups">Duplicate candidates</h2>
        ${(ctx.state.dismissedDuplicates ?? []).length ? `<button class="btn small" data-q-action="restore-dismissed">Restore ${ctx.state.dismissedDuplicates.length} dismissed pair(s)</button>` : ''}</div>
      <p class="small muted">Organisations match on normalised name (case, punctuation, “&amp;”/“and”, “the”/“of” and abbreviations like “Univ.” ignored) and/or normalised domain. Contacts match on email (case-insensitive) or same name at the same organisation. Merging keeps the chosen record, fills its blank fields from the other, moves contacts, leads and activities across, and combines two leads at the same organisation into one (the most advanced stage wins).</p>
      <h3>Organisations (${dup.organisations.length})</h3>
      ${dup.organisations.length ? dup.organisations.map((p) => pairHTML(ctx, p)).join('') : '<p class="muted">No organisation duplicates found.</p>'}
      <h3 style="margin-top:16px">Contacts (${dup.contacts.length})</h3>
      ${dup.contacts.length ? dup.contacts.map((p) => pairHTML(ctx, p)).join('') : '<p class="muted">No contact duplicates found.</p>'}
    </section>
  </div>`;
}

export function drawQualityCharts(ctx) {
  const el = document.querySelector('[data-chart="quality-page"]');
  if (!el) return;
  const { quality } = ctx.derived();
  el.innerHTML = horizontalBars({
    title: 'Data-quality issues by check',
    desc: quality.checks.map((q) => `${q.label}: ${q.count}`).join(', '),
    width: Math.max(280, el.clientWidth || 480),
    items: quality.checks.map((q) => ({ label: q.label, value: q.count, note: q.unit, color: q.count ? 'var(--s2)' : 'var(--s3)' })),
  });
}

export function bindQuality(ctx, root) {
  root.addEventListener('click', (e) => {
    if (ctx.ui.view !== 'quality') return;
    const show = e.target.closest('[data-show-check]');
    if (show) {
      const check = ctx.derived().quality.checks.find((c) => c.key === show.dataset.showCheck);
      ctx.ui.idFilter = { label: check.label, ids: new Set(check.oppIds) };
      ctx.navigate('leads');
      return;
    }
    const merge = e.target.closest('[data-merge]');
    if (merge) {
      const { keep, drop } = merge.dataset;
      try {
        const next = merge.dataset.merge === 'org' ? mergeOrganisations(ctx.state, keep, drop) : mergeContacts(ctx.state, keep, drop);
        ctx.commit(next, `Merged ${drop} into ${keep}.`);
      } catch (err) {
        ctx.announce(err.message);
      }
      return;
    }
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      ctx.commit(dismissPair(ctx.state, dismiss.dataset.dismiss), 'Marked pair as not a duplicate.');
      return;
    }
    const a = e.target.closest('[data-q-action]');
    if (!a) return;
    const act = a.dataset.qAction;
    if (act === 'preview-clean') {
      ctx.ui.cleanPreview = cleanState(ctx.state);
      ctx.render();
    } else if (act === 'discard-clean') {
      ctx.ui.cleanPreview = null;
      ctx.render();
    } else if (act === 'apply-clean') {
      const res = cleanState(ctx.state); // recompute against current state
      ctx.ui.cleanPreview = null;
      ctx.commit(res.state, `Applied ${res.changes.length} clean-up change(s).`);
    } else if (act === 'restore-dismissed') {
      ctx.commit({ ...ctx.state, dismissedDuplicates: [] }, 'Restored dismissed duplicate pairs.');
    }
  });
}

