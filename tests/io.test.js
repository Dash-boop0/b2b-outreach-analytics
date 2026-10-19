import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProspectsCSV, applyProspects, parseActivitiesCSV, applyActivities, leadsToCSV, activitiesToCSV, funnelToCSV } from '../src/lib/io.js';
import { parseCSVObjects } from '../src/lib/csv.js';
import { emptyState } from '../src/lib/model.js';
import { buildLeadRows } from '../src/lib/leads.js';
import { computeFunnel } from '../src/lib/funnel.js';

const sample = JSON.parse(readFileSync(new URL('../sample-data/sample-dataset.json', import.meta.url)));
const exampleCSV = readFileSync(new URL('../sample-data/prospects-import-example.csv', import.meta.url), 'utf8');
const activitiesCSV = readFileSync(new URL('../sample-data/activities-import-example.csv', import.meta.url), 'utf8');

test('prospect import example: 5 valid, 3 rejected with reasons, 1 duplicate of existing', () => {
  const r = parseProspectsCSV(exampleCSV, sample);
  assert.deepEqual(r.fileErrors, []);
  assert.equal(r.valid.length, 5);
  assert.equal(r.rejected.length, 3);
  assert.match(r.rejected[0].errors[0], /organisation_name is empty/);
  assert.match(r.rejected[1].errors[0], /Charity/);
  assert.match(r.rejected[2].errors[0], /Pending/);
  assert.equal(r.duplicatesOfExisting, 1);
  const lantern = r.valid.find((v) => v.input.orgName.startsWith('Lanternfield'));
  assert.equal(lantern.input.followUpDate, '2026-10-23'); // DD/MM/YYYY converted
  assert.equal(lantern.input.phone, '+44 7700 900123'); // injection-protection apostrophe removed
  assert.equal(lantern.input.stage, 'contacted'); // label → key
  const briar = r.valid.find((v) => v.input.orgName.startsWith('Briarwood'));
  assert.equal(briar.input.priority, 'high'); // case-insensitive
  assert.ok(briar.warnings.some((w) => /looks invalid/.test(w)));
  const lost = r.valid.find((v) => v.input.stage === 'lost');
  assert.equal(lost.input.lostFromStage, 'replied');
});

test('applying an import updates metrics (metrics follow the data)', () => {
  const before = computeFunnel(sample.opportunities).counts;
  const r = parseProspectsCSV(exampleCSV, sample);
  const { state, added } = applyProspects(sample, r.valid, 'T');
  assert.equal(added, 5);
  assert.equal(state.opportunities.length, 105);
  assert.equal(state.organisations.at(-1).id, 'org-105');
  const after = computeFunnel(state.opportunities).counts;
  assert.equal(after.total, before.total + 5);
  // new rows: not contacted, contacted, replied, not contacted, lost-after-replied → +3 contacted, +2 replied
  assert.equal(after.contacted, before.contacted + 3);
  assert.equal(after.replied, before.replied + 2);
});

test('file-level errors: missing required column, header only, unclosed quote', () => {
  assert.match(parseProspectsCSV('name,email\nA,b\n', sample).fileErrors[0], /organisation_name/);
  assert.match(parseProspectsCSV('organisation_name\n', sample).fileErrors[0], /no data rows/);
  assert.match(parseProspectsCSV('organisation_name\n"oops\n', sample).fileErrors[0], /Unclosed/);
  assert.match(parseProspectsCSV('organisation_name,favourite_colour\nA (synthetic),blue\n', emptyState()).fileErrors[0], /favourite_colour/);
});

test('activity import example: 4 valid, 2 rejected; applying adds them', () => {
  const r = parseActivitiesCSV(activitiesCSV, sample);
  assert.equal(r.valid.length, 4);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0].errors[0], /opp-999/);
  assert.equal(r.rejected[1].errors.length, 2);
  assert.equal(r.valid[3].input.date, '2026-10-15');
  const { state, added } = applyActivities(sample, r.valid);
  assert.equal(added, 4);
  assert.equal(state.activities.length, sample.activities.length + 4);
  assert.match(parseActivitiesCSV('date,type\n2026-01-01,email', sample).fileErrors[0], /opportunity_id/);
});

test('leads export → re-import round-trips every editable field', () => {
  const rows = buildLeadRows(sample, '2026-10-16');
  const csv = leadsToCSV(rows);
  const { records } = parseCSVObjects(csv);
  assert.equal(records.length, 100);
  const r = parseProspectsCSV(csv, emptyState());
  assert.equal(r.rejected.length, 0);
  assert.equal(r.valid.length, 100);
  const { state } = applyProspects(emptyState(), r.valid, 'T');
  const pick = (s) => s.opportunities.map((o) => [o.stage, o.lostFromStage, o.priority, o.owner.trim(), o.nextAction.trim()]);
  assert.deepEqual(pick(state), pick(sample));
  assert.deepEqual(computeFunnel(state.opportunities).counts, computeFunnel(sample.opportunities).counts);
});

test('activities and funnel exports have the documented columns', () => {
  const a = parseCSVObjects(activitiesToCSV(sample));
  assert.deepEqual(a.headers, ['activity_id', 'opportunity_id', 'contact_id', 'date', 'type', 'direction', 'outcome', 'note']);
  assert.equal(a.records.length, sample.activities.length);
  const f = parseCSVObjects(funnelToCSV(computeFunnel([]), 'Empty'));
  assert.equal(f.records.length, 5);
  assert.ok(f.records.every((x) => x.value === 'n/a' && x.display === 'n/a'));
});
