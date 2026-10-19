import { STAGES, PRIORITIES, LOST_FROM_STAGES, ACTIVITY_TYPES, OUTCOMES, ORG_TYPES, stageLabel, outcomeLabel } from '../lib/constants.js';
import { updateOpportunity, addActivity, addProspect } from '../lib/model.js';
import { addDays, formatDate } from '../lib/dates.js';
import { followUpStatus, ownersOf } from '../lib/leads.js';
import { esc } from '../lib/charts.js';

let dlg = null;
let current = { kind: null, id: null, errors: [], activityErrors: [] };

const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
const errorsHTML = (errors) => (errors.length ? `<div class="errors" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '');

function leadHTML(ctx, id) {
  const opp = ctx.state.opportunities.find((o) => o.id === id);
  if (!opp) return `<div class="dialog-head"><h2 id="dialog-title">Lead not found</h2><button class="btn small" data-close>Close</button></div><div class="dialog-body"><p>This lead may have been merged into another record.</p></div>`;
  const org = ctx.state.organisations.find((o) => o.id === opp.orgId);
  const contacts = ctx.state.contacts.filter((c) => c.orgId === opp.orgId);
  const contact = contacts.find((c) => c.id === opp.contactId);
  const acts = ctx.state.activities.filter((a) => a.opportunityId === id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id.localeCompare(a.id)));
  const issues = ctx.derived().quality.byOpp.get(id) ?? [];
  const today = ctx.today();
  const status = followUpStatus(opp, today);
  const owners = ownersOf(ctx.state.opportunities);
  return `
  <div class="dialog-head"><div><h2 id="dialog-title">${esc(org?.name ?? 'Unknown organisation')}</h2>
    <div class="small muted">${esc(org?.type ?? '')}${org?.domain ? ` · ${esc(org.domain)}` : ''}${org?.region ? ` · ${esc(org.region)}` : ''} · ${esc(opp.id)}</div></div>
    <button class="btn small" data-close>Close</button></div>
  <div class="dialog-body">
    ${issues.length ? `<p class="small"><span class="badge issue">Data quality</span> ${esc(issues.join(' · '))}</p>` : ''}
    <section aria-labelledby="sec-lead">
      <h3 id="sec-lead">Lead status</h3>
      ${errorsHTML(current.errors)}
      <form data-form="lead" class="form-grid" novalidate>
        <div class="field"><label for="l-stage">Stage</label><select id="l-stage" name="stage">${STAGES.map((s) => opt(s.key, s.label, opp.stage)).join('')}</select></div>
        <div class="field" data-lost-field ${opp.stage === 'lost' ? '' : 'hidden'}><label for="l-lost">Lost after stage</label><select id="l-lost" name="lostFromStage">${opt('', 'Auto (furthest reached)', opp.lostFromStage || '')}${LOST_FROM_STAGES.map((s) => opt(s, stageLabel(s), opp.lostFromStage)).join('')}</select></div>
        <div class="field"><label for="l-priority">Priority</label><select id="l-priority" name="priority">${PRIORITIES.map((p) => opt(p, p, opp.priority)).join('')}</select></div>
        <div class="field"><label for="l-owner">Owner</label><input type="text" id="l-owner" name="owner" list="owner-list" value="${esc(opp.owner)}" maxlength="80"><datalist id="owner-list">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></div>
        <div class="field full"><label for="l-next">Next action</label><input type="text" id="l-next" name="nextAction" value="${esc(opp.nextAction)}" maxlength="200"></div>
        <div class="field"><label for="l-fu">Follow-up date ${status === 'overdue' ? '<span class="badge overdue">Overdue</span>' : ''}</label><input type="date" id="l-fu" name="followUpDate" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(opp.followUpDate) ? opp.followUpDate : '')}">
          ${opp.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(opp.followUpDate) ? `<div class="small" style="color:var(--bad)">Stored value “${esc(opp.followUpDate)}” is not a valid date — run Data quality → Clean data or pick a date.</div>` : ''}</div>
        <div class="field"><span class="small muted" style="display:block;margin-bottom:4px">Quick set (from ${formatDate(today)})</span><div class="actions"><button type="button" class="btn small" data-fu="3">+3 days</button><button type="button" class="btn small" data-fu="7">+7 days</button><button type="button" class="btn small" data-fu="14">+14 days</button><button type="button" class="btn small" data-fu="clear">Clear</button></div></div>
        <div class="field full"><label for="l-notes">Notes</label><textarea id="l-notes" name="notes" maxlength="1000">${esc(opp.notes ?? '')}</textarea></div>
        <div class="full actions"><button class="btn primary" type="submit">Save changes</button></div>
      </form>
    </section>
    <section aria-labelledby="sec-contacts">
      <h3 id="sec-contacts">Contacts at this organisation</h3>
      <ul class="timeline">${contacts.length ? contacts.map((c) => `<li><strong>${esc(`${c.firstName} ${c.lastName}`.trim() || '(no name)')}</strong>${c.id === opp.contactId ? ' <span class="pill">primary</span>' : ''} <span class="muted">${esc(c.title ?? '')}</span><div class="cell-sub">${esc(c.email || 'no email')}${c.phone ? ` · ${esc(c.phone)}` : ''}</div></li>`).join('') : '<li class="muted">No contacts recorded.</li>'}</ul>
    </section>
    <section aria-labelledby="sec-acts">
      <h3 id="sec-acts">Activity log (${acts.length})</h3>
      <p class="small muted">Recording an activity only adds a log entry. Nothing is emailed, called or messaged from this app.</p>
      ${errorsHTML(current.activityErrors)}
      <form data-form="activity" class="form-grid" novalidate>
        <div class="field"><label for="a-date">Date</label><input type="date" id="a-date" name="date" value="${esc(today)}" required></div>
        <div class="field"><label for="a-type">Type</label><select id="a-type" name="type">${ACTIVITY_TYPES.map((t) => opt(t, t, 'email')).join('')}</select></div>
        <div class="field"><label for="a-dir">Direction</label><select id="a-dir" name="direction">${opt('outbound', 'Outbound (we reached out)', 'outbound')}${opt('inbound', 'Inbound (they replied)', 'outbound')}</select></div>
        <div class="field"><label for="a-outcome">Outcome</label><select id="a-outcome" name="outcome">${OUTCOMES.map((o) => opt(o.key, o.label, 'sent')).join('')}</select></div>
        <div class="field full"><label for="a-note">Note</label><input type="text" id="a-note" name="note" maxlength="500"></div>
        <div class="full actions"><button class="btn" type="submit">Log activity (record only)</button></div>
      </form>
      <ul class="timeline" style="margin-top:12px">${acts.length ? acts.map((a) => `<li><strong class="tabular">${esc(formatDate(a.date))}</strong> · ${esc(a.type)} · ${esc(a.direction)} · ${esc(outcomeLabel(a.outcome))}${a.note ? `<div class="cell-sub">${esc(a.note)}</div>` : ''}</li>`).join('') : '<li class="muted">No activity logged yet.</li>'}</ul>
    </section>
    ${contact ? '' : '<p class="small muted">This lead has no primary contact.</p>'}
  </div>`;
}

function prospectHTML(ctx, values = {}) {
  const v = (k) => esc(values[k] ?? '');
  const owners = ownersOf(ctx.state.opportunities);
  return `
  <div class="dialog-head"><h2 id="dialog-title">Add prospect</h2><button class="btn small" data-close>Close</button></div>
  <div class="dialog-body">
    <p class="small muted">Creates an organisation, a primary contact and an opportunity. Use fictional data for demos.</p>
    ${errorsHTML(current.errors)}
    <form data-form="prospect" class="form-grid" novalidate>
      <div class="field full"><label for="p-org">Organisation name (required)</label><input type="text" id="p-org" name="orgName" value="${v('orgName')}" required maxlength="160"></div>
      <div class="field"><label for="p-type">Organisation type</label><select id="p-type" name="orgType">${ORG_TYPES.map((t) => opt(t, t, values.orgType ?? 'Other')).join('')}</select></div>
      <div class="field"><label for="p-domain">Domain</label><input type="text" id="p-domain" name="domain" value="${v('domain')}" placeholder="name.example.org"></div>
      <div class="field"><label for="p-first">Contact first name</label><input type="text" id="p-first" name="firstName" value="${v('firstName')}"></div>
      <div class="field"><label for="p-last">Contact last name</label><input type="text" id="p-last" name="lastName" value="${v('lastName')}"></div>
      <div class="field"><label for="p-email">Contact email</label><input type="email" id="p-email" name="email" value="${v('email')}"></div>
      <div class="field"><label for="p-title">Job title</label><input type="text" id="p-title" name="title" value="${v('title')}"></div>
      <div class="field"><label for="p-stage">Stage</label><select id="p-stage" name="stage">${STAGES.map((s) => opt(s.key, s.label, values.stage ?? 'not_contacted')).join('')}</select></div>
      <div class="field"><label for="p-priority">Priority</label><select id="p-priority" name="priority">${PRIORITIES.map((p) => opt(p, p, values.priority ?? 'medium')).join('')}</select></div>
      <div class="field"><label for="p-owner">Owner</label><input type="text" id="p-owner" name="owner" list="p-owner-list" value="${v('owner')}"><datalist id="p-owner-list">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></div>
      <div class="field"><label for="p-fu">Follow-up date</label><input type="date" id="p-fu" name="followUpDate" value="${v('followUpDate')}"></div>
      <div class="field full"><label for="p-next">Next action</label><input type="text" id="p-next" name="nextAction" value="${v('nextAction')}"></div>
      <div class="full actions"><button class="btn primary" type="submit">Add prospect</button></div>
    </form>
  </div>`;
}

function draw(ctx, values) {
  if (current.kind === 'lead') dlg.innerHTML = leadHTML(ctx, current.id);
  else if (current.kind === 'prospect') dlg.innerHTML = prospectHTML(ctx, values);
}

export function openLeadDialog(ctx, id) {
  current = { kind: 'lead', id, errors: [], activityErrors: [] };
  draw(ctx);
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('#l-stage')?.focus();
}

export function openProspectDialog(ctx) {
  current = { kind: 'prospect', id: null, errors: [], activityErrors: [] };
  draw(ctx);
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('#p-org')?.focus();
}

const formValues = (form) => Object.fromEntries(new FormData(form).entries());

export function bindDialog(ctx, el) {
  dlg = el;
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) {
      el.close();
      return;
    }
    const fu = e.target.closest('[data-fu]');
    if (fu) {
      const input = el.querySelector('#l-fu');
      input.value = fu.dataset.fu === 'clear' ? '' : addDays(ctx.today(), Number(fu.dataset.fu));
      input.focus();
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'l-stage') {
      const lost = el.querySelector('[data-lost-field]');
      if (lost) lost.hidden = e.target.value !== 'lost';
    }
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    const vals = formValues(form);
    if (kind === 'lead') {
      const patch = { stage: vals.stage, priority: vals.priority, owner: vals.owner ?? '', nextAction: vals.nextAction ?? '', followUpDate: vals.followUpDate ?? '', notes: vals.notes ?? '' };
      if (vals.stage === 'lost') patch.lostFromStage = vals.lostFromStage || '';
      const res = updateOpportunity(ctx.state, current.id, patch);
      current.errors = res.errors;
      if (res.errors.length) return draw(ctx);
      ctx.commit(res.state, `Saved changes to ${current.id}.`);
      draw(ctx);
      el.querySelector('#l-stage')?.focus();
    } else if (kind === 'activity') {
      const res = addActivity(ctx.state, { ...vals, opportunityId: current.id });
      current.activityErrors = res.errors;
      if (res.errors.length) return draw(ctx);
      ctx.commit(res.state, `Logged ${res.activity.type} activity on ${current.id} (record only — nothing sent).`);
      draw(ctx);
      el.querySelector('#a-date')?.focus();
    } else if (kind === 'prospect') {
      const res = addProspect(ctx.state, vals);
      current.errors = res.errors;
      if (res.errors.length) return draw(ctx, vals);
      ctx.commit({ ...res.state, meta: { ...res.state.meta } }, `Added prospect ${vals.orgName}.`);
      openLeadDialog(ctx, res.ids.oppId);
    }
    return undefined;
  });
}
