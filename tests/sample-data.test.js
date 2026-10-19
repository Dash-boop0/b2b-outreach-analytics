import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDataset, writeOutputs, DEFAULT_SEED, DEMO_TODAY } from '../scripts/generate-sample-data.mjs';
import { validateState } from '../src/lib/model.js';
import { computeFunnel } from '../src/lib/funnel.js';
import { qualityReport } from '../src/lib/quality.js';
import { mergeOrganisations } from '../src/lib/dedup.js';

const committedDir = new URL('../sample-data/', import.meta.url);
const committed = JSON.parse(readFileSync(new URL('sample-dataset.json', committedDir)));

test('generator is deterministic and matches the committed sample files byte for byte', () => {
  assert.deepEqual(generateDataset(DEFAULT_SEED), generateDataset(DEFAULT_SEED));
  assert.notDeepEqual(generateDataset(1), generateDataset(2));
  const dir = mkdtempSync(join(tmpdir(), 'outreach-'));
  writeOutputs(generateDataset(DEFAULT_SEED), dir);
  for (const f of readdirSync(dir)) {
    assert.equal(readFileSync(join(dir, f), 'utf8'), readFileSync(new URL(f, committedDir), 'utf8'), f);
  }
});

test('sample is valid, synthetic-labelled and has exactly 100 prospects', () => {
  assert.equal(validateState(committed).ok, true);
  assert.equal(committed.meta.synthetic, true);
  assert.match(committed.meta.label, /SYNTHETIC/);
  assert.equal(committed.opportunities.length, 100);
  assert.equal(committed.organisations.length, 100);
  assert.equal(committed.settings.today, DEMO_TODAY);
  assert.ok(committed.organisations.every((o) => /\(synthetic\)/.test(o.name)));
});

test('only reserved example domains and fictional phone range are used', () => {
  const domains = committed.organisations.map((o) => o.domain).filter(Boolean);
  assert.ok(domains.every((d) => /example\.org/i.test(d)), 'organisation domains');
  const emails = committed.contacts.map((c) => c.email).filter((e) => e.includes('@') && e.split('@')[1]);
  assert.ok(emails.every((e) => /@[^@]*example\.(org|com|net)?/i.test(e.trim())), 'emails');
  assert.ok(committed.contacts.every((c) => !c.phone || /^\+44 7700 900\d{3}$/.test(c.phone)), 'phones');
});

test('sample funnel and data-quality numbers (documented in README)', () => {
  const { counts } = computeFunnel(committed.opportunities);
  assert.deepEqual(
    [counts.total, counts.contacted, counts.replied, counts.qualified, counts.meetings, counts.won, counts.lost],
    [100, 84, 38, 23, 14, 3, 19],
  );
  const q = Object.fromEntries(qualityReport(committed, DEMO_TODAY).checks.map((c) => [c.key, c.count]));
  assert.deepEqual(q, { missingEmail: 5, invalidEmail: 5, missingFollowUp: 8, duplicateOrgs: 6, duplicateContacts: 3, missingOwner: 2, invalidDomain: 1, stageMismatch: 1 });
  assert.ok(committed.activities.every((a) => a.date >= '2026-07-27' && a.date <= DEMO_TODAY));
});

test('merging every organisation duplicate pair resolves them (sample has 6 duplicate orgs)', () => {
  let s = committed;
  for (;;) {
    const pairs = qualityReport(s, DEMO_TODAY).duplicates.organisations;
    if (!pairs.length) break;
    s = mergeOrganisations(s, pairs[0].a, pairs[0].b);
  }
  assert.equal(s.organisations.length, 94);
  assert.equal(s.opportunities.length, 94);
  assert.equal(validateState(s).ok, true);
  assert.equal(s.activities.length, committed.activities.length);
});
