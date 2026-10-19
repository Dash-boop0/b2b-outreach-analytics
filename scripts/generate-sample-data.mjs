#!/usr/bin/env node
// Deterministic generator for the SYNTHETIC sample dataset (100 fictional institutional prospects).
// Usage: node scripts/generate-sample-data.mjs [--seed 20261016] [--out sample-data]
// Same seed → byte-identical output. All organisations, people and domains are invented;
// domains use the reserved example.org TLD and phone numbers use the UK Ofcom drama range (07700 900xxx).

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRng } from '../src/lib/rng.js';
import { addDays, diffDays, isValidISODate } from '../src/lib/dates.js';
import { objectsToCSV } from '../src/lib/csv.js';
import { LADDER, STATE_VERSION } from '../src/lib/constants.js';
import { PROSPECT_COLUMNS } from '../src/lib/io.js';

export const DEFAULT_SEED = 20261016;
export const DEMO_TODAY = '2026-10-16';
export const WINDOW_START = '2026-07-27'; // Monday, 12 ISO weeks before the demo week ends

const OWNERS = ['Jordan', 'Priya', 'Marcus', 'Elena'];
const REGIONS = ['North', 'South', 'East', 'West', 'Central'];
const PREFIXES = ['North', 'East', 'West', 'South', 'Ash', 'Oak', 'Elm', 'Fern', 'Wren', 'Lark', 'Kestrel', 'Bracken', 'Stone', 'Hazel', 'Rowan', 'Thorn', 'Bright', 'Amber', 'Merrow', 'Quill'];
const SUFFIXES = ['bridge', 'mere', 'vale', 'holt', 'wick', 'combe', 'haven', 'moor', 'fold', 'brook'];
const FIRST = ['Alex', 'Robin', 'Morgan', 'Casey', 'Jamie', 'Riley', 'Quinn', 'Avery', 'Rowan', 'Skyler', 'Parker', 'Emerson', 'Harper', 'Reese', 'Drew', 'Blake', 'Kendall', 'Logan', 'Sasha', 'Tatum', 'Noor', 'Ines', 'Kofi', 'Mei', 'Arjun', 'Lena'];
const LAST = ['Quillfeather', 'Ambermoor', 'Larkspur', 'Thistlewood', 'Brightwater', 'Oakhollow', 'Willowmere', 'Penwhistle', 'Fernhollow', 'Mistlebrook', 'Copperkettle', 'Silverbirch', 'Moonfield', 'Dapplegate', 'Inkwell', 'Hazelburrow', 'Bramblewick', 'Cloudsley', 'Puddleford', 'Tinderbox', 'Marrowgate', 'Pebbleworth'];

const TYPE_WEIGHTS = [['University', 18], ['School', 26], ['Hospital', 16], ['NGO', 18], ['Council', 16]];
const NAME_TEMPLATES = {
  University: ['University of {P}', '{P} University', '{P} Institute of Technology'],
  School: ['{P} Academy', '{P} High School', '{P} Primary School', '{P} Sixth Form College'],
  Hospital: ['{P} General Hospital', '{P} Community Health Trust', '{P} Children\'s Hospital'],
  NGO: ['{P} Literacy Foundation', '{P} Youth Network', '{P} Community Learning Trust'],
  Council: ['{P} District Council', '{P} Borough Council', '{P} County Council'],
};
const TITLES = {
  University: ['Head of Partnerships', 'Director of Admissions', 'Procurement Lead', 'Head of Digital Learning'],
  School: ['Headteacher', 'Business Manager', 'Deputy Head', 'IT Coordinator'],
  Hospital: ['Head of Procurement', 'Training Lead', 'Operations Manager'],
  NGO: ['Programme Director', 'Partnerships Manager', 'Operations Lead'],
  Council: ['Digital Services Lead', 'Education Officer', 'Procurement Officer'],
};
const NEXT_ACTION = {
  not_contacted: ['Send introductory email', 'Research decision maker', 'Connect on LinkedIn'],
  contacted: ['Send follow-up email', 'Try a phone call', 'Share case-study one-pager'],
  replied: ['Book qualification call', 'Answer questions from reply'],
  qualified: ['Propose meeting times', 'Confirm budget cycle'],
  meeting_booked: ['Prepare meeting agenda', 'Send pre-read'],
  proposal: ['Chase proposal decision', 'Answer procurement questions'],
  won: ['Hand over to onboarding'],
  lost: [''],
};

// Fixed stage mix for the 100 opportunities (illustrative, not a benchmark).
const STAGE_MIX = { not_contacted: 16, contacted: 36, replied: 10, qualified: 7, meeting_booked: 5, proposal: 4, won: 3, lost: 19 };
const LOST_FROM_MIX = [...Array(10).fill('contacted'), ...Array(5).fill('replied'), 'qualified', 'qualified', 'meeting_booked', 'proposal'];

const slug = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pad = (n) => String(n).padStart(3, '0');

export function generateDataset(seed = DEFAULT_SEED) {
  const rng = createRng(seed);
  const organisations = [];
  const contacts = [];
  const opportunities = [];
  const activities = [];
  const usedNames = new Set();
  const usedPeople = new Set();

  const places = rng.shuffle(PREFIXES.flatMap((p) => SUFFIXES.map((s) => p + s)));
  let placeIdx = 0;

  const person = () => {
    for (;;) {
      const f = rng.pick(FIRST);
      const l = rng.pick(LAST);
      if (!usedPeople.has(f + l)) {
        usedPeople.add(f + l);
        return [f, l];
      }
    }
  };
  const phone = () => `+44 7700 900${pad(rng.int(0, 999))}`;
  const addContact = (org, first, last, title, email) => {
    const c = { id: `con-${pad(contacts.length + 1)}`, orgId: org.id, firstName: first, lastName: last, title, email, phone: rng.next() < 0.6 ? phone() : '' };
    contacts.push(c);
    return c;
  };
  const emailFor = (first, last, domain) => `${first}.${last}@${domain}`.toLowerCase();

  // 1) 94 base organisations
  const BASE = 94;
  for (let i = 0; i < BASE; i += 1) {
    const type = rng.weighted(TYPE_WEIGHTS);
    let name;
    do {
      name = rng.pick(NAME_TEMPLATES[type]).replace('{P}', places[placeIdx++ % places.length]);
    } while (usedNames.has(name));
    usedNames.add(name);
    const domain = `${slug(name)}.example.org`;
    const org = { id: `org-${pad(organisations.length + 1)}`, name: `${name} (synthetic)`, type, domain, region: rng.pick(REGIONS) };
    organisations.push(org);
    const [f, l] = person();
    addContact(org, f, l, rng.pick(TITLES[type]), emailFor(f, l, domain));
    if (rng.next() < 0.3) {
      const [f2, l2] = person();
      addContact(org, f2, l2, rng.pick(TITLES[type]), emailFor(f2, l2, domain));
    }
  }

  // 2) six deliberate duplicate organisations (different spellings of a base org)
  const firstOf = (type, pattern) => organisations.find((o) => o.type === type && pattern.test(o.name));
  const contactOf = (org) => contacts.find((c) => c.orgId === org.id);
  const dupSpecs = [];
  const uni = firstOf('University', /^University of /) ?? firstOf('University', /./);
  dupSpecs.push({ base: uni, name: uni.name.replace('University of', 'Univ. of'), domain: `www.${uni.domain}`, sameContact: 'upper' });
  const school = firstOf('School', /Academy/) ?? firstOf('School', /./);
  dupSpecs.push({ base: school, name: `The ${school.name}`, domain: school.domain.replace('.example.org', '-trust.example.org'), sameContact: null });
  const hosp = firstOf('Hospital', /./);
  dupSpecs.push({ base: hosp, name: hosp.name.replace(' (synthetic)', ' – Estates Team (synthetic)'), domain: hosp.domain.toUpperCase(), sameContact: null });
  const ngo = firstOf('NGO', /Literacy Foundation/) ?? firstOf('NGO', /./);
  dupSpecs.push({ base: ngo, name: ngo.name, domain: '', sameContact: null });
  const council = firstOf('Council', /District Council/) ?? firstOf('Council', /./);
  dupSpecs.push({ base: council, name: council.name.replace(' (synthetic)', '').toUpperCase().replace('COUNCIL', 'council') + '  (synthetic)', domain: `https://${council.domain}/contact-us`, sameContact: 'same' });
  const ngo2 = organisations.find((o) => o.type === 'NGO' && o !== ngo && /Foundation|Trust/.test(o.name)) ?? organisations.find((o) => o.type === 'NGO' && o !== ngo);
  dupSpecs.push({ base: ngo2, name: ngo2.name.replace('Foundation', 'Fdn'), domain: ngo2.domain, sameContact: null });

  for (const spec of dupSpecs) {
    const org = { id: `org-${pad(organisations.length + 1)}`, name: spec.name, type: spec.base.type, domain: spec.domain, region: spec.base.region };
    organisations.push(org);
    const bc = contactOf(spec.base);
    if (spec.sameContact) {
      const email = spec.sameContact === 'upper' ? bc.email.toUpperCase() : bc.email;
      addContact(org, bc.firstName, bc.lastName, bc.title, email);
    } else {
      const [f, l] = person();
      const d = spec.domain ? spec.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : spec.base.domain;
      addContact(org, f, l, rng.pick(TITLES[org.type]), emailFor(f, l, d));
    }
  }

  // 3) one opportunity per organisation with a fixed stage mix
  const stageList = rng.shuffle(Object.entries(STAGE_MIX).flatMap(([k, n]) => Array(n).fill(k)));
  const lostFrom = rng.shuffle(LOST_FROM_MIX);
  let lostIdx = 0;
  organisations.forEach((org, i) => {
    const stage = stageList[i];
    const primary = contactOf(org);
    const open = stage !== 'won' && stage !== 'lost';
    let followUpDate = '';
    if (open) followUpDate = addDays(DEMO_TODAY, stage === 'not_contacted' ? rng.int(-6, 14) : rng.int(-12, 21));
    opportunities.push({
      id: `opp-${pad(i + 1)}`,
      orgId: org.id,
      contactId: primary.id,
      stage,
      lostFromStage: stage === 'lost' ? lostFrom[lostIdx++] : '',
      priority: rng.weighted([['high', 25], ['medium', 50], ['low', 25]]),
      owner: rng.pick(OWNERS),
      nextAction: rng.pick(NEXT_ACTION[stage]),
      followUpDate,
      notes: '',
      createdAt: `${WINDOW_START}T09:00:00.000Z`,
      updatedAt: `${DEMO_TODAY}T09:00:00.000Z`,
    });
  });

  // 4) activity history consistent with each opportunity's stage
  const span = diffDays(WINDOW_START, DEMO_TODAY);
  for (const opp of opportunities) {
    const reached = opp.stage === 'lost' ? LADDER.indexOf(opp.lostFromStage) : LADDER.indexOf(opp.stage);
    if (reached < 1) continue;
    const steps = [];
    const touches = reached === 1 ? rng.int(1, 4) : rng.int(1, 2);
    for (let t = 0; t < touches; t += 1) {
      const type = t === 0 ? 'email' : rng.pick(['email', 'linkedin', 'call']);
      const outcome = type === 'call' ? rng.pick(['no_answer', 'voicemail']) : 'sent';
      steps.push({ type, direction: 'outbound', outcome, note: t === 0 ? 'Intro email logged (not sent by this app)' : 'Follow-up touch' });
    }
    if (opp.stage === 'lost' && reached === 1) steps.push({ type: 'email', direction: 'outbound', outcome: 'sent', note: 'Closing the loop — marked lost after no response' });
    if (reached >= 2) {
      const negative = opp.stage === 'lost' && reached === 2;
      steps.push({ type: 'email', direction: 'inbound', outcome: negative ? 'not_interested' : reached >= 3 ? 'interested' : 'replied', note: negative ? 'Replied: no budget this year' : 'Reply received' });
    }
    if (reached >= 3) steps.push({ type: 'call', direction: 'outbound', outcome: opp.stage === 'lost' && reached === 3 ? 'not_interested' : 'interested', note: 'Qualification call' });
    if (reached >= 4) {
      steps.push({ type: 'email', direction: 'outbound', outcome: 'meeting_booked', note: 'Meeting invite agreed' });
      if (reached >= 5 || rng.next() < 0.5) steps.push({ type: 'meeting', direction: 'outbound', outcome: 'meeting_held', note: 'Discovery meeting' });
    }
    if (reached >= 5) steps.push({ type: 'email', direction: 'outbound', outcome: 'proposal_sent', note: 'Proposal shared' });
    if (opp.stage === 'won') steps.push({ type: 'email', direction: 'inbound', outcome: 'replied', note: 'Confirmed go-ahead (synthetic)' });
    if (opp.stage === 'lost' && reached >= 4) steps.push({ type: 'email', direction: 'inbound', outcome: 'not_interested', note: 'Chose another option' });

    const gaps = steps.map((_, k) => (k === 0 ? 0 : rng.int(2, 9)));
    let total = gaps.reduce((a, b) => a + b, 0);
    if (total > span) {
      const f = span / total;
      for (let k = 1; k < gaps.length; k += 1) gaps[k] = Math.max(1, Math.floor(gaps[k] * f));
      total = gaps.reduce((a, b) => a + b, 0);
    }
    let date = addDays(WINDOW_START, rng.int(0, Math.max(0, span - total)));
    steps.forEach((s, k) => {
      date = addDays(date, gaps[k]);
      if (date > DEMO_TODAY) date = DEMO_TODAY;
      activities.push({ id: '', opportunityId: opp.id, contactId: opp.contactId, date, ...s });
    });
  }

  // 5) deliberate data-quality issues (so the checks and cleaning have something to find)
  const dupOrgIds = new Set(organisations.slice(BASE).map((o) => o.id));
  const dupBaseIds = new Set(dupSpecs.map((s) => s.base.id));
  const plainContacts = rng.shuffle(contacts.filter((c) => !dupOrgIds.has(c.orgId) && !dupBaseIds.has(c.orgId)));
  let ci = 0;
  for (let k = 0; k < 4; k += 1) plainContacts[ci++].email = '';
  const badForms = [(e) => e.split('@')[0] + '@', (e) => e.replace('@', '.'), (e) => e.replace('.', ' '), (e) => e.replace('@', '@@'), (e) => e.replace('.example.org', '.example.')];
  for (const f of badForms) {
    const c = plainContacts[ci++];
    c.email = f(c.email);
  }
  for (let k = 0; k < 4; k += 1) {
    const c = plainContacts[ci++];
    c.email = ` ${c.email.replace(/^./, (m) => m.toUpperCase())} `;
  }
  // same person twice inside one organisation (second copy without email)
  const twin = plainContacts[ci++];
  contacts.push({ ...twin, id: `con-${pad(contacts.length + 1)}`, email: '', phone: '', title: twin.title });

  const plainOrgs = rng.shuffle(organisations.filter((o) => !dupOrgIds.has(o.id) && !dupBaseIds.has(o.id)));
  plainOrgs[0].name = `${plainOrgs[0].name.replace(' (synthetic)', '')}   (synthetic) `;
  plainOrgs[1].name = `  ${plainOrgs[1].name.replace(' ', '  ')}`;
  plainOrgs[2].domain = `https://www.${plainOrgs[2].domain}/`;
  plainOrgs[3].domain = `WWW.${plainOrgs[3].domain.toUpperCase()}`;

  const openOpps = rng.shuffle(opportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost' && !dupOrgIds.has(o.orgId)));
  for (let k = 0; k < 6; k += 1) openOpps[k].followUpDate = '';
  for (let k = 6; k < 8; k += 1) {
    const [y, m, d] = openOpps[k].followUpDate.split('-');
    openOpps[k].followUpDate = `${d}/${m}/${y}`; // DD/MM/YYYY — fixed by "Clean data"
  }
  openOpps[8].owner = '';
  openOpps[9].owner = '';
  // stage/activity mismatch: a "not contacted" lead that actually has an outbound email logged
  const nc = opportunities.find((o) => o.stage === 'not_contacted' && !dupOrgIds.has(o.orgId));
  activities.push({ id: '', opportunityId: nc.id, contactId: nc.contactId, date: addDays(DEMO_TODAY, -3), type: 'email', direction: 'outbound', outcome: 'sent', note: 'Logged, but stage was never updated' });

  activities.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.opportunityId.localeCompare(b.opportunityId)));
  activities.forEach((a, i) => {
    a.id = `act-${pad(i + 1)}`;
  });

  for (const a of activities) if (!isValidISODate(a.date) || a.date > DEMO_TODAY || a.date < WINDOW_START) throw new Error(`Generated bad activity date ${a.date}`);

  return {
    version: STATE_VERSION,
    meta: {
      synthetic: true,
      source: 'sample',
      demoToday: DEMO_TODAY,
      seed,
      label: 'SYNTHETIC sample data — 100 fictional institutional prospects. Not real organisations, people or results.',
    },
    settings: { today: DEMO_TODAY },
    organisations,
    contacts,
    opportunities,
    activities,
    dismissedDuplicates: [],
    log: [],
  };
}

function importExamples(ds) {
  const existing = ds.organisations.find((o) => o.type === 'Council' && /^[a-z0-9.-]+$/.test(o.domain));
  const prospects = [
    ['Willowmere Adult Education Centre (synthetic)', 'School', 'willowmere-adult-education.example.org', 'North', 'Harper', 'Gladwhistle', 'Centre Manager', 'harper.gladwhistle@willowmere-adult-education.example.org', '', 'Not contacted', '', 'high', 'Priya', 'Send introductory email', '2026-10-20', 'Imported example row'],
    ['Lanternfield Teaching Hospital (synthetic)', 'Hospital', 'lanternfield-hospital.example.org', 'South', 'Kofi', 'Starglow', 'Head of Procurement', 'kofi.starglow@lanternfield-hospital.example.org', '+44 7700 900123', 'Contacted', '', 'medium', 'Marcus', 'Send follow-up email', '23/10/2026', 'Day-first date is converted on import'],
    ['Briarwood Community Learning Trust (synthetic)', 'NGO', 'briarwood-learning.example.org', 'East', 'Ines', 'Puddlesworth', 'Programme Director', 'ines.puddlesworth@', '', 'Replied', '', 'High', 'Elena', 'Book qualification call', '2026-10-14', 'Invalid email is imported and flagged'],
    [existing.name.replace(' (synthetic)', '') + ' – Youth Services (synthetic)', 'Council', existing.domain, existing.region, 'Mei', 'Nettlefold', 'Youth Services Lead', `mei.nettlefold@${existing.domain}`, '', 'Not contacted', '', 'low', 'Jordan', 'Check with existing owner first', '', 'Same domain as an existing council → flagged as a duplicate candidate'],
    ['Gullhaven Primary School (synthetic)', 'School', 'gullhaven-primary.example.org', 'West', 'Lena', 'Hopscotch', 'Headteacher', 'lena.hopscotch@gullhaven-primary.example.org', '', 'Lost', 'Replied', 'medium', 'Jordan', '', '', 'Lost after reply'],
    ['', 'School', 'no-name.example.org', '', 'Drew', 'Nameless', '', 'drew.nameless@no-name.example.org', '', '', '', '', '', '', '', 'Rejected: organisation_name is required'],
    ['Cobblestone Arts Charity (synthetic)', 'Charity', 'cobblestone-arts.example.org', '', '', '', '', '', '', 'Contacted', '', '', '', '', '', 'Rejected: organisation_type "Charity" is not allowed'],
    ['Tidewater Borough Council (synthetic)', 'Council', 'tidewater-borough.example.org', 'Central', 'Sasha', 'Wavecrest', 'Digital Services Lead', 'sasha.wavecrest@tidewater-borough.example.org', '', 'Pending', '', 'medium', 'Priya', '', '', 'Rejected: stage "Pending" is not a pipeline stage'],
  ];
  const template = objectsToCSV([Object.fromEntries(PROSPECT_COLUMNS.map((c, i) => [c, prospects[0][i]]))], PROSPECT_COLUMNS);
  const example = objectsToCSV(prospects.map((p) => Object.fromEntries(PROSPECT_COLUMNS.map((c, i) => [c, p[i]]))), PROSPECT_COLUMNS);
  const openOpps = ds.opportunities.filter((o) => ['contacted', 'replied'].includes(o.stage)).slice(0, 4);
  const acts = [
    { opportunity_id: openOpps[0].id, date: DEMO_TODAY, type: 'call', direction: 'outbound', outcome: 'no_answer', note: 'Imported call log (synthetic)' },
    { opportunity_id: openOpps[1].id, date: DEMO_TODAY, type: 'email', direction: 'inbound', outcome: 'replied', note: 'Imported reply (synthetic)' },
    { opportunity_id: openOpps[2].id, date: addDays(DEMO_TODAY, -1), type: 'linkedin', direction: 'outbound', outcome: 'sent', note: 'Imported LinkedIn message log (synthetic)' },
    { opportunity_id: openOpps[3].id, date: '2026/10/15', type: 'email', direction: 'outbound', outcome: 'sent', note: 'Slash date is converted' },
    { opportunity_id: 'opp-999', date: DEMO_TODAY, type: 'email', direction: 'outbound', outcome: 'sent', note: 'Rejected: unknown opportunity' },
    { opportunity_id: openOpps[0].id, date: '2026-02-30', type: 'fax', direction: 'outbound', outcome: 'sent', note: 'Rejected: bad date and type' },
  ];
  return { template, example, activities: objectsToCSV(acts, ['opportunity_id', 'date', 'type', 'direction', 'outcome', 'note']) };
}

export function writeOutputs(ds, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'sample-dataset.json'), `${JSON.stringify(ds, null, 2)}\n`);
  writeFileSync(resolve(outDir, 'organisations.csv'), objectsToCSV(ds.organisations, ['id', 'name', 'type', 'domain', 'region']));
  writeFileSync(resolve(outDir, 'contacts.csv'), objectsToCSV(ds.contacts, ['id', 'orgId', 'firstName', 'lastName', 'title', 'email', 'phone']));
  writeFileSync(resolve(outDir, 'opportunities.csv'), objectsToCSV(ds.opportunities, ['id', 'orgId', 'contactId', 'stage', 'lostFromStage', 'priority', 'owner', 'nextAction', 'followUpDate', 'notes']));
  writeFileSync(resolve(outDir, 'activities.csv'), objectsToCSV(ds.activities, ['id', 'opportunityId', 'contactId', 'date', 'type', 'direction', 'outcome', 'note']));
  const ex = importExamples(ds);
  writeFileSync(resolve(outDir, 'prospects-import-template.csv'), ex.template);
  writeFileSync(resolve(outDir, 'prospects-import-example.csv'), ex.example);
  writeFileSync(resolve(outDir, 'activities-import-example.csv'), ex.activities);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const seed = Number(get('--seed', DEFAULT_SEED));
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(get('--out', resolve(here, '..', 'sample-data')));
  const ds = generateDataset(seed);
  writeOutputs(ds, out);
  console.log(`Synthetic dataset (seed ${seed}): ${ds.organisations.length} organisations, ${ds.contacts.length} contacts, ${ds.opportunities.length} opportunities, ${ds.activities.length} activities → ${out}`);
}
