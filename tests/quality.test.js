import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityReport, cleanState } from '../src/lib/quality.js';
import { isValidEmail, isValidDomain } from '../src/lib/normalize.js';

test('email syntax validation', () => {
  for (const ok of ['a.b@example.org', 'x+tag@sub.example.org', 'O\'Neil@example.org', ' padded@example.org ']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'plain', 'a@', '@example.org', 'a b@example.org', 'a@@example.org', 'a@example', 'a@example.', 'a..b@example.org', 'a@-x.example.org', 'a@example.c0m']) {
    assert.equal(isValidEmail(bad), false, bad);
  }
});

test('domain validation', () => {
  assert.equal(isValidDomain('https://www.northbridge.example.org/x'), true);
  assert.equal(isValidDomain(''), false);
  assert.equal(isValidDomain('localhost'), false);
  assert.equal(isValidDomain('bad_domain.example.org'), false);
});

const state = {
  organisations: [
    { id: 'o1', name: 'A (synthetic)', domain: 'a.example.org' },
    { id: 'o2', name: 'B (synthetic)', domain: '' },
    { id: 'o3', name: 'A (synthetic)', domain: 'other.example.org' },
  ],
  contacts: [
    { id: 'c1', orgId: 'o1', firstName: 'X', lastName: 'Y', email: '' },
    { id: 'c2', orgId: 'o2', firstName: 'P', lastName: 'Q', email: 'p.q@' },
    { id: 'c3', orgId: 'o3', firstName: 'M', lastName: 'N', email: 'm@other.example.org' },
  ],
  opportunities: [
    { id: 'p1', orgId: 'o1', stage: 'contacted', owner: 'Jordan', followUpDate: '2026-10-10' }, // overdue vs 2026-10-16
    { id: 'p2', orgId: 'o2', stage: 'not_contacted', owner: '', followUpDate: '' }, // missing follow-up + owner + mismatch
    { id: 'p3', orgId: 'o3', stage: 'won', owner: '', followUpDate: '' }, // closed: no follow-up/owner checks
  ],
  activities: [
    { id: 'a1', opportunityId: 'p1', date: '2026-10-01', type: 'email', direction: 'outbound', outcome: 'sent' },
    { id: 'a2', opportunityId: 'p2', date: '2026-10-02', type: 'email', direction: 'outbound', outcome: 'sent' },
    { id: 'a3', opportunityId: 'p3', date: '2026-10-03', type: 'meeting', direction: 'outbound', outcome: 'meeting_held' },
  ],
  dismissedDuplicates: [],
};

test('qualityReport counts every check (hand-computed)', () => {
  const r = qualityReport(state, '2026-10-16');
  const counts = Object.fromEntries(r.checks.map((c) => [c.key, c.count]));
  assert.deepEqual(counts, {
    missingEmail: 1, invalidEmail: 1, missingFollowUp: 1, duplicateOrgs: 1, duplicateContacts: 0,
    missingOwner: 1, invalidDomain: 1, stageMismatch: 1,
  });
  assert.equal(r.overdue, 1);
  assert.deepEqual([...r.checks.find((c) => c.key === 'duplicateOrgs').oppIds].sort(), ['p1', 'p3']);
  assert.deepEqual(r.byOpp.get('p2').sort(), ['Invalid email', 'Missing follow-up date', 'Missing owner', 'Missing/invalid domain', 'Stage/activity mismatch'].sort());
});

test('qualityReport on empty data is all zeros', () => {
  const r = qualityReport({ organisations: [], contacts: [], opportunities: [], activities: [], dismissedDuplicates: [] }, '2026-10-16');
  assert.ok(r.checks.every((c) => c.count === 0));
  assert.equal(r.overdue, 0);
});

test('cleanState trims, lower-cases emails, normalises domains and converts dates — without mutating input', () => {
  const dirty = {
    organisations: [{ id: 'o1', name: '  Northbridge   Academy ', domain: 'https://WWW.Northbridge.example.org/', region: ' North ' }],
    contacts: [{ id: 'c1', orgId: 'o1', firstName: ' Robin', lastName: 'Larkspur ', title: 'Head  of IT', email: ' Robin.L@Northbridge.example.org ' }],
    opportunities: [
      { id: 'p1', orgId: 'o1', owner: ' Priya ', nextAction: 'Call  back', followUpDate: '23/10/2026' },
      { id: 'p2', orgId: 'o1', owner: 'Elena', nextAction: '', followUpDate: '2026/11/02' },
      { id: 'p3', orgId: 'o1', owner: 'Elena', nextAction: '', followUpDate: 'next week' },
    ],
    activities: [],
  };
  const before = JSON.stringify(dirty);
  const { state: s, changes } = cleanState(dirty);
  assert.equal(JSON.stringify(dirty), before);
  assert.equal(s.organisations[0].name, 'Northbridge Academy');
  assert.equal(s.organisations[0].domain, 'northbridge.example.org');
  assert.equal(s.contacts[0].email, 'robin.l@northbridge.example.org');
  assert.equal(s.contacts[0].title, 'Head of IT');
  assert.equal(s.opportunities[0].followUpDate, '2026-10-23');
  assert.equal(s.opportunities[1].followUpDate, '2026-11-02');
  assert.equal(s.opportunities[2].followUpDate, 'next week'); // unparseable values are left for a human
  assert.equal(changes.length, 11);
  assert.equal(cleanState(s).changes.length, 0); // idempotent
});
