import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, updateOpportunity, addActivity, addProspect, nextId, effectiveToday, appendLog } from '../src/lib/model.js';

function base() {
  let s = emptyState();
  s = addProspect(s, { orgName: 'Alpha Academy (synthetic)', orgType: 'School', firstName: 'Robin', lastName: 'Larkspur', email: 'robin@alpha.example.org', stage: 'replied', owner: 'Priya' }, 'T').state;
  return s;
}

test('addProspect creates org + contact + opportunity with sequential ids and validates input', () => {
  const s = base();
  assert.equal(s.organisations[0].id, 'org-001');
  assert.equal(s.contacts[0].id, 'con-001');
  assert.deepEqual([s.opportunities[0].id, s.opportunities[0].orgId, s.opportunities[0].contactId, s.opportunities[0].priority], ['opp-001', 'org-001', 'con-001', 'medium']);
  const bad = addProspect(s, { orgName: '  ', orgType: 'Charity', stage: 'pending', priority: 'urgent', followUpDate: '2026-02-30' });
  assert.equal(bad.errors.length, 5);
  assert.equal(bad.state, s);
  const noContact = addProspect(s, { orgName: 'Beta (synthetic)' });
  assert.equal(noContact.state.contacts.length, 1);
  assert.equal(noContact.state.opportunities[1].contactId, '');
  assert.equal(nextId('org', [{ id: 'org-009' }, { id: 'org-010' }, { id: 'x' }]), 'org-011');
});

test('updateOpportunity edits status/priority/owner/next action/follow-up and validates', () => {
  const s = base();
  const r = updateOpportunity(s, 'opp-001', { priority: 'high', owner: '  Elena ', nextAction: 'Book  call', followUpDate: '2026-10-20' }, 'T2');
  assert.deepEqual(r.errors, []);
  const o = r.state.opportunities[0];
  assert.deepEqual([o.priority, o.owner, o.nextAction, o.followUpDate, o.updatedAt], ['high', 'Elena', 'Book call', '2026-10-20', 'T2']);
  assert.equal(s.opportunities[0].priority, 'medium'); // original untouched
  const bad = updateOpportunity(s, 'opp-001', { stage: 'nope', followUpDate: '20/10/2026', priority: 'x' });
  assert.equal(bad.errors.length, 3);
  assert.equal(updateOpportunity(s, 'missing', { priority: 'low' }).errors.length, 1);
});

test('moving to Lost records the furthest stage reached; leaving Lost clears it', () => {
  const s = base(); // stage replied
  const lost = updateOpportunity(s, 'opp-001', { stage: 'lost' }).state;
  assert.equal(lost.opportunities[0].lostFromStage, 'replied');
  const explicit = updateOpportunity(s, 'opp-001', { stage: 'lost', lostFromStage: 'qualified' }).state;
  assert.equal(explicit.opportunities[0].lostFromStage, 'qualified');
  const reopened = updateOpportunity(lost, 'opp-001', { stage: 'contacted' }).state;
  assert.equal(reopened.opportunities[0].lostFromStage, '');
  const s2 = updateOpportunity(s, 'opp-001', { stage: 'not_contacted' }).state;
  assert.equal(updateOpportunity(s2, 'opp-001', { stage: 'lost' }).state.opportunities[0].lostFromStage, 'contacted');
});

test('addActivity logs a record only and validates every field', () => {
  const s = base();
  const r = addActivity(s, { opportunityId: 'opp-001', date: '2026-10-16', type: 'Email', direction: 'outbound', outcome: 'sent', note: ' hi ' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.activity, { id: 'act-001', opportunityId: 'opp-001', contactId: 'con-001', date: '2026-10-16', type: 'email', direction: 'outbound', outcome: 'sent', note: 'hi' });
  const bad = addActivity(s, { opportunityId: 'nope', date: '2026-13-01', type: 'fax', direction: 'sideways', outcome: 'maybe' });
  assert.equal(bad.errors.length, 5);
});

test('validateState accepts a good backup and rejects broken ones with reasons', () => {
  const s = base();
  const ok = validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(ok.ok, true);
  assert.equal(validateState(null).ok, false);
  assert.equal(validateState([]).ok, false);
  assert.match(validateState({ version: 99, organisations: [], contacts: [], opportunities: [], activities: [] }).errors[0], /version/);
  const broken = JSON.parse(JSON.stringify(s));
  broken.opportunities[0].orgId = 'org-404';
  broken.opportunities.push({ ...broken.opportunities[0] });
  broken.activities.push({ id: 'a', opportunityId: 'opp-404', type: 'email', date: 'x' });
  const res = validateState(broken);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /used twice/.test(e)));
  assert.ok(res.errors.some((e) => /unknown organisation/.test(e)));
  assert.ok(res.errors.some((e) => /unknown opportunity/.test(e)));
  assert.ok(res.errors.some((e) => /invalid date/.test(e)));
});

test('effectiveToday uses the configured date or falls back to the system date; log is capped', () => {
  const s = emptyState();
  assert.equal(effectiveToday(s, '2026-10-19'), '2026-10-19');
  assert.equal(effectiveToday({ ...s, settings: { today: '2026-10-16' } }, '2026-10-19'), '2026-10-16');
  assert.equal(effectiveToday({ ...s, settings: { today: 'garbage' } }, '2026-10-19'), '2026-10-19');
  let l = s;
  for (let i = 0; i < 250; i += 1) l = appendLog(l, `m${i}`, 'T');
  assert.equal(l.log.length, 200);
  assert.equal(l.log[0].message, 'm249');
});
