import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpStatus, buildLeadRows, filterLeads, sortLeads, weeklyTrend, ownersOf } from '../src/lib/leads.js';
import { isValidISODate, addDays, diffDays, startOfWeek, parseFlexibleDate, formatDate } from '../src/lib/dates.js';

const TODAY = '2026-10-16'; // a Friday

test('date helpers', () => {
  assert.equal(isValidISODate('2026-02-29'), false);
  assert.equal(isValidISODate('2028-02-29'), true);
  assert.equal(isValidISODate('2026-13-01'), false);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(diffDays('2026-10-01', '2026-10-16'), 15);
  assert.equal(startOfWeek('2026-10-16'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-12'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12'); // Sunday belongs to the week starting Monday
  assert.equal(parseFlexibleDate('23/10/2026'), '2026-10-23');
  assert.equal(parseFlexibleDate('2026/1/5'), '2026-01-05');
  assert.equal(parseFlexibleDate('31/02/2026'), null);
  assert.equal(parseFlexibleDate('soon'), null);
  assert.equal(formatDate('2026-10-16'), '16 Oct 2026');
});

test('follow-up status relative to a configurable today', () => {
  const o = (stage, followUpDate) => ({ stage, followUpDate });
  assert.equal(followUpStatus(o('contacted', '2026-10-15'), TODAY), 'overdue');
  assert.equal(followUpStatus(o('contacted', '2026-10-16'), TODAY), 'today');
  assert.equal(followUpStatus(o('contacted', '2026-10-23'), TODAY), 'soon');
  assert.equal(followUpStatus(o('contacted', '2026-10-24'), TODAY), 'later');
  assert.equal(followUpStatus(o('contacted', ''), TODAY), 'none');
  assert.equal(followUpStatus(o('contacted', '23/10/2026'), TODAY), 'none');
  assert.equal(followUpStatus(o('won', '2026-01-01'), TODAY), 'closed');
  assert.equal(followUpStatus(o('lost', '2026-01-01'), TODAY), 'closed');
  // moving "today" changes the answer
  assert.equal(followUpStatus(o('contacted', '2026-10-15'), '2026-10-01'), 'later');
});

const state = {
  organisations: [
    { id: 'o1', name: 'Alpha Academy (synthetic)', type: 'School', domain: 'alpha.example.org', region: 'North' },
    { id: 'o2', name: 'Beta Council (synthetic)', type: 'Council', domain: 'beta.example.org', region: 'South' },
    { id: 'o3', name: 'Gamma Hospital (synthetic)', type: 'Hospital', domain: 'gamma.example.org', region: 'East' },
  ],
  contacts: [{ id: 'c1', orgId: 'o1', firstName: 'Robin', lastName: 'Larkspur', email: 'robin@alpha.example.org' }],
  opportunities: [
    { id: 'p1', orgId: 'o1', contactId: 'c1', stage: 'contacted', priority: 'high', owner: 'Priya', nextAction: 'Call', followUpDate: '2026-10-10' },
    { id: 'p2', orgId: 'o2', contactId: '', stage: 'qualified', priority: 'low', owner: '', nextAction: '', followUpDate: '2026-10-20' },
    { id: 'p3', orgId: 'o3', contactId: '', stage: 'won', priority: 'medium', owner: 'Elena', nextAction: '', followUpDate: '' },
  ],
  activities: [
    { id: 'a1', opportunityId: 'p1', date: '2026-10-01', type: 'email', direction: 'outbound', outcome: 'sent' },
    { id: 'a2', opportunityId: 'p1', date: '2026-10-05', type: 'call', direction: 'outbound', outcome: 'no_answer' },
  ],
};

test('buildLeadRows joins records and derives follow-up + last activity', () => {
  const rows = buildLeadRows(state, TODAY, new Map([['p2', ['Missing owner']]]));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].contactName, 'Robin Larkspur');
  assert.equal(rows[0].lastActivity, '2026-10-05');
  assert.equal(rows[0].activityCount, 2);
  assert.equal(rows[0].followUp, 'overdue');
  assert.equal(rows[1].followUp, 'soon');
  assert.equal(rows[2].followUp, 'closed');
  assert.deepEqual(rows[1].issues, ['Missing owner']);
});

test('filters: overdue, due in 7 days, owner/unassigned, type, search, issues, ids', () => {
  const rows = buildLeadRows(state, TODAY, new Map([['p2', ['Missing owner']]]));
  const ids = (f) => filterLeads(rows, f).map((r) => r.id);
  assert.deepEqual(ids({ followUp: 'overdue' }), ['p1']);
  assert.deepEqual(ids({ followUp: 'due7' }), ['p2']);
  assert.deepEqual(ids({ owner: '__unassigned' }), ['p2']);
  assert.deepEqual(ids({ owner: 'Elena' }), ['p3']);
  assert.deepEqual(ids({ type: 'Council' }), ['p2']);
  assert.deepEqual(ids({ q: 'LARKSPUR' }), ['p1']);
  assert.deepEqual(ids({ q: 'beta.example' }), ['p2']);
  assert.deepEqual(ids({ issuesOnly: true }), ['p2']);
  assert.deepEqual(ids({ ids: new Set(['p3']) }), ['p3']);
  assert.deepEqual(ids({ stage: 'won', priority: 'medium' }), ['p3']);
  assert.deepEqual(ids({}), ['p1', 'p2', 'p3']);
});

test('sorting by follow-up puts blanks last; priority sorts high→low', () => {
  const rows = buildLeadRows(state, TODAY);
  assert.deepEqual(sortLeads(rows, 'followUpDate', 'asc').map((r) => r.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(sortLeads(rows, 'priority', 'asc').map((r) => r.id), ['p1', 'p3', 'p2']);
  assert.deepEqual(sortLeads(rows, 'stage', 'desc').map((r) => r.id), ['p3', 'p2', 'p1']);
});

test('weeklyTrend buckets activities into 12 Monday-start weeks (hand-checked)', () => {
  const acts = [
    { date: '2026-10-12', type: 'email', direction: 'outbound', outcome: 'sent' }, // last week (Mon)
    { date: '2026-10-16', type: 'call', direction: 'outbound', outcome: 'no_answer' }, // last week (Fri)
    { date: '2026-10-14', type: 'email', direction: 'inbound', outcome: 'replied' }, // reply, last week
    { date: '2026-10-11', type: 'meeting', direction: 'outbound', outcome: 'meeting_held' }, // Sunday → previous week
    { date: '2026-07-27', type: 'linkedin', direction: 'outbound', outcome: 'sent' }, // first week (Mon)
    { date: '2026-07-26', type: 'email', direction: 'outbound', outcome: 'sent' }, // before window: ignored
    { date: 'bad', type: 'email', direction: 'outbound', outcome: 'sent' }, // invalid: ignored
  ];
  const t = weeklyTrend(acts, TODAY, 12);
  assert.equal(t.length, 12);
  assert.equal(t[0].weekStart, '2026-07-27');
  assert.equal(t[11].weekStart, '2026-10-12');
  assert.deepEqual(t[11].outbound, { email: 1, call: 1, linkedin: 0, meeting: 0 });
  assert.equal(t[11].replies, 1);
  assert.equal(t[11].replyRatio, 1 / 2);
  assert.equal(t[10].outbound.meeting, 1);
  assert.equal(t[10].meetingsHeld, 1);
  assert.equal(t[0].outbound.linkedin, 1);
  assert.equal(t[5].replyRatio, null); // no outbound → n/a, not 0
  assert.equal(t.reduce((s, w) => s + w.outboundTotal + w.replies, 0), 5);
});

test('ownersOf returns distinct trimmed owners', () => {
  assert.deepEqual(ownersOf([{ owner: 'Priya' }, { owner: ' Priya ' }, { owner: '' }, { owner: 'Elena' }]), ['Elena', 'Priya']);
});
