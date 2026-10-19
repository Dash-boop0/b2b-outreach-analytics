import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateOrganisations, findDuplicateContacts, mergeOrganisations, mergeContacts, dismissPair, pairId, findAllDuplicates } from '../src/lib/dedup.js';
import { normalizeOrgName, normalizeDomain } from '../src/lib/normalize.js';

test('normalizeOrgName handles case, punctuation, &, the/of and abbreviations', () => {
  assert.equal(normalizeOrgName('The University of Northbridge'), 'university northbridge');
  assert.equal(normalizeOrgName('Univ. of Northbridge'), 'university northbridge');
  assert.equal(normalizeOrgName('  NORTHBRIDGE  Arts & Crafts Trust '), 'northbridge arts crafts trust');
  assert.equal(normalizeOrgName('Northbridge Arts and Crafts Trust'), 'northbridge arts crafts trust');
  assert.equal(normalizeOrgName('St. Ann’s School'), 'saint ann s school');
  assert.equal(normalizeOrgName('Écoles Réunies'), 'ecoles reunies');
  assert.equal(normalizeOrgName(''), '');
  // word order is significant on purpose
  assert.notEqual(normalizeOrgName('Northbridge University'), normalizeOrgName('University of Northbridge'));
});

test('normalizeDomain strips protocol, www, path, port, case and accepts emails', () => {
  assert.equal(normalizeDomain('https://www.Northbridge.example.org/contact?x=1'), 'northbridge.example.org');
  assert.equal(normalizeDomain('WWW.NORTHBRIDGE.EXAMPLE.ORG.'), 'northbridge.example.org');
  assert.equal(normalizeDomain('http://northbridge.example.org:8080'), 'northbridge.example.org');
  assert.equal(normalizeDomain('jo@northbridge.example.org'), 'northbridge.example.org');
  assert.equal(normalizeDomain(''), '');
});

const orgs = [
  { id: 'o1', name: 'University of Northbridge (synthetic)', domain: 'northbridge.example.org' },
  { id: 'o2', name: 'Univ. of Northbridge (synthetic)', domain: 'https://www.northbridge.example.org/' }, // name + domain
  { id: 'o3', name: 'Northbridge Estates Office (synthetic)', domain: 'NORTHBRIDGE.example.org' }, // domain only
  { id: 'o4', name: 'Eastmere Academy (synthetic)', domain: 'eastmere.example.org' },
  { id: 'o5', name: 'The Eastmere Academy (synthetic)', domain: '' }, // name only (blank domain ignored)
  { id: 'o6', name: 'Westholt Council (synthetic)', domain: '' }, // unique; blank domain must not match o5
];

test('finds organisation pairs with correct reasons (hand-checked)', () => {
  const pairs = findDuplicateOrganisations(orgs);
  const byId = Object.fromEntries(pairs.map((p) => [`${p.a}-${p.b}`, p.reasons]));
  assert.deepEqual(byId, {
    'o1-o2': ['Same normalised name', 'Same domain'],
    'o1-o3': ['Same domain'],
    'o2-o3': ['Same domain'],
    'o4-o5': ['Same normalised name'],
  });
  // pairs with two reasons are listed first
  assert.equal(pairs[0].id, pairId('org', 'o1', 'o2'));
});

test('dismissed pairs are excluded; pairId is order-independent', () => {
  assert.equal(pairId('org', 'o2', 'o1'), pairId('org', 'o1', 'o2'));
  const pairs = findDuplicateOrganisations(orgs, [pairId('org', 'o5', 'o4')]);
  assert.equal(pairs.some((p) => p.a === 'o4'), false);
  assert.equal(pairs.length, 3);
  const st = dismissPair({ dismissedDuplicates: [] }, 'org:o1|o2');
  assert.deepEqual(st.dismissedDuplicates, ['org:o1|o2']);
  assert.equal(dismissPair(st, 'org:o1|o2'), st); // idempotent
});

test('finds contact pairs by email (case-insensitive) and by same name in the same org', () => {
  const contacts = [
    { id: 'c1', orgId: 'o1', firstName: 'Robin', lastName: 'Larkspur', email: 'robin.larkspur@northbridge.example.org' },
    { id: 'c2', orgId: 'o2', firstName: 'R.', lastName: 'Larkspur', email: ' ROBIN.LARKSPUR@northbridge.example.org ' },
    { id: 'c3', orgId: 'o1', firstName: 'robin', lastName: 'larkspur ', email: '' },
    { id: 'c4', orgId: 'o4', firstName: 'Robin', lastName: 'Larkspur', email: '' }, // same name, other org: not a dup
    { id: 'c5', orgId: 'o4', firstName: 'Casey', lastName: 'Inkwell', email: '' }, // blank emails never match each other
  ];
  const pairs = findDuplicateContacts(contacts);
  const byId = Object.fromEntries(pairs.map((p) => [`${p.a}-${p.b}`, p.reasons]));
  assert.deepEqual(byId, { 'c1-c2': ['Same email address'], 'c1-c3': ['Same name at same organisation'] });
});

function fixtureState() {
  return {
    organisations: [
      { id: 'o1', name: 'University of Northbridge (synthetic)', type: 'University', domain: 'northbridge.example.org', region: '' },
      { id: 'o2', name: 'Univ. of Northbridge (synthetic)', type: 'University', domain: 'www.northbridge.example.org', region: 'North' },
    ],
    contacts: [
      { id: 'c1', orgId: 'o1', firstName: 'Robin', lastName: 'Larkspur', email: 'robin@northbridge.example.org', phone: '' },
      { id: 'c2', orgId: 'o2', firstName: 'Robin', lastName: 'Larkspur', email: 'ROBIN@northbridge.example.org', phone: '+44 7700 900001' },
    ],
    opportunities: [
      { id: 'p1', orgId: 'o1', contactId: 'c1', stage: 'contacted', priority: 'low', owner: 'Jordan', nextAction: '', followUpDate: '2026-10-20', notes: 'A' },
      { id: 'p2', orgId: 'o2', contactId: 'c2', stage: 'qualified', priority: 'high', owner: 'Priya', nextAction: 'Book call', followUpDate: '', notes: 'B' },
    ],
    activities: [
      { id: 'a1', opportunityId: 'p1', contactId: 'c1', date: '2026-10-01', type: 'email', direction: 'outbound', outcome: 'sent' },
      { id: 'a2', opportunityId: 'p2', contactId: 'c2', date: '2026-10-02', type: 'email', direction: 'inbound', outcome: 'replied' },
    ],
    dismissedDuplicates: ['org:o2|o9'],
  };
}

test('mergeOrganisations moves contacts, combines leads (most advanced stage wins) and keeps activities', () => {
  const s = mergeOrganisations(fixtureState(), 'o1', 'o2');
  assert.deepEqual(s.organisations.map((o) => o.id), ['o1']);
  assert.equal(s.organisations[0].region, 'North'); // blank filled from dropped record
  assert.equal(s.organisations[0].name, 'University of Northbridge (synthetic)'); // kept value not overwritten
  assert.ok(s.contacts.every((c) => c.orgId === 'o1'));
  assert.equal(s.opportunities.length, 1);
  const [o] = s.opportunities;
  assert.equal(o.id, 'p2'); // qualified beats contacted
  assert.equal(o.stage, 'qualified');
  assert.equal(o.orgId, 'o1');
  assert.equal(o.priority, 'high');
  assert.equal(o.followUpDate, '2026-10-20'); // filled from p1
  assert.equal(o.notes, 'B | A');
  assert.ok(s.activities.every((a) => a.opportunityId === 'p2'));
  assert.equal(s.activities.length, 2);
  assert.deepEqual(s.dismissedDuplicates, []); // stale dismissal for o2 removed
  // after the org merge the two Robins are now same-name-same-org and same-email duplicates
  const dups = findAllDuplicates(s);
  assert.equal(dups.organisations.length, 0);
  assert.deepEqual(dups.contacts[0].reasons, ['Same email address', 'Same name at same organisation']);
});

test('mergeContacts repoints leads and activities and fills blanks', () => {
  const s = mergeContacts(fixtureState(), 'c1', 'c2');
  assert.deepEqual(s.contacts.map((c) => c.id), ['c1']);
  assert.equal(s.contacts[0].phone, '+44 7700 900001');
  assert.ok(s.opportunities.every((o) => o.contactId === 'c1'));
  assert.ok(s.activities.every((a) => a.contactId === 'c1'));
});

test('merge guards: self-merge and unknown ids throw; input state is not mutated', () => {
  const st = fixtureState();
  const before = JSON.stringify(st);
  assert.throws(() => mergeOrganisations(st, 'o1', 'o1'), /itself/);
  assert.throws(() => mergeOrganisations(st, 'o1', 'nope'), /not found/);
  assert.throws(() => mergeContacts(st, 'c1', 'nope'), /not found/);
  mergeOrganisations(st, 'o1', 'o2');
  assert.equal(JSON.stringify(st), before);
});

test('combining a won lead with an open lead keeps the won lead; lost loses to open', () => {
  const st = fixtureState();
  st.opportunities[0].stage = 'won';
  assert.equal(mergeOrganisations(st, 'o1', 'o2').opportunities[0].id, 'p1');
  const st2 = fixtureState();
  st2.opportunities[1].stage = 'lost';
  st2.opportunities[1].lostFromStage = 'proposal';
  assert.equal(mergeOrganisations(st2, 'o2', 'o1').opportunities[0].id, 'p1');
});
