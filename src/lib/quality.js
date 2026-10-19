// Data-quality checks and automatic cleaning. Pure, no DOM.

import { isValidEmail, isValidDomain, cleanText, normalizeDomain } from './normalize.js';
import { isValidISODate, parseFlexibleDate } from './dates.js';
import { isOpen, followUpStatus } from './leads.js';
import { findAllDuplicates } from './dedup.js';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

export const QUALITY_CHECKS = [
  { key: 'missingEmail', label: 'Missing email', unit: 'contacts', description: 'Contact has no email address.' },
  { key: 'invalidEmail', label: 'Invalid email', unit: 'contacts', description: 'Email fails the syntax check (one @, valid domain, 2+ letter TLD).' },
  { key: 'missingFollowUp', label: 'Missing follow-up date', unit: 'open leads', description: 'Open lead (not Won/Lost) without a valid follow-up date.' },
  { key: 'duplicateOrgs', label: 'Duplicate organisations', unit: 'candidate pairs', description: 'Same normalised name and/or domain.' },
  { key: 'duplicateContacts', label: 'Duplicate contacts', unit: 'candidate pairs', description: 'Same email, or same name at the same organisation.' },
  { key: 'missingOwner', label: 'Missing owner', unit: 'open leads', description: 'Open lead with no owner assigned.' },
  { key: 'invalidDomain', label: 'Missing/invalid domain', unit: 'organisations', description: 'Organisation domain is blank or not a valid hostname.' },
  { key: 'stageMismatch', label: 'Stage/activity mismatch', unit: 'leads', description: '"Not contacted" with outbound activity logged, or contacted+ with no activity logged.' },
];

/**
 * Returns { checks: [{key,label,unit,description,count,oppIds:Set}], byOpp: Map<oppId,string[]>, duplicates, overdue }
 */
export function qualityReport(state, today) {
  const oppsByOrg = new Map();
  for (const o of state.opportunities) {
    if (!oppsByOrg.has(o.orgId)) oppsByOrg.set(o.orgId, []);
    oppsByOrg.get(o.orgId).push(o.id);
  }
  const results = Object.fromEntries(QUALITY_CHECKS.map((c) => [c.key, { count: 0, oppIds: new Set() }]));
  const addOrg = (key, orgId) => (oppsByOrg.get(orgId) ?? []).forEach((id) => results[key].oppIds.add(id));

  for (const c of state.contacts) {
    if (blank(c.email)) {
      results.missingEmail.count += 1;
      addOrg('missingEmail', c.orgId);
    } else if (!isValidEmail(c.email)) {
      results.invalidEmail.count += 1;
      addOrg('invalidEmail', c.orgId);
    }
  }
  for (const org of state.organisations) {
    if (!isValidDomain(org.domain)) {
      results.invalidDomain.count += 1;
      addOrg('invalidDomain', org.id);
    }
  }
  const actsByOpp = new Map();
  for (const a of state.activities) {
    if (!actsByOpp.has(a.opportunityId)) actsByOpp.set(a.opportunityId, []);
    actsByOpp.get(a.opportunityId).push(a);
  }
  let overdue = 0;
  for (const o of state.opportunities) {
    if (isOpen(o) && !isValidISODate(o.followUpDate)) {
      results.missingFollowUp.count += 1;
      results.missingFollowUp.oppIds.add(o.id);
    }
    if (isOpen(o) && blank(o.owner)) {
      results.missingOwner.count += 1;
      results.missingOwner.oppIds.add(o.id);
    }
    if (followUpStatus(o, today) === 'overdue') overdue += 1;
    const acts = actsByOpp.get(o.id) ?? [];
    const outbound = acts.some((a) => a.direction !== 'inbound');
    if ((o.stage === 'not_contacted' && outbound) || (o.stage !== 'not_contacted' && acts.length === 0)) {
      results.stageMismatch.count += 1;
      results.stageMismatch.oppIds.add(o.id);
    }
  }
  const duplicates = findAllDuplicates(state);
  results.duplicateOrgs.count = duplicates.organisations.length;
  for (const p of duplicates.organisations) {
    addOrg('duplicateOrgs', p.a);
    addOrg('duplicateOrgs', p.b);
  }
  results.duplicateContacts.count = duplicates.contacts.length;
  const contactOrg = new Map(state.contacts.map((c) => [c.id, c.orgId]));
  for (const p of duplicates.contacts) {
    addOrg('duplicateContacts', contactOrg.get(p.a));
    addOrg('duplicateContacts', contactOrg.get(p.b));
  }

  const checks = QUALITY_CHECKS.map((c) => ({ ...c, ...results[c.key] }));
  const byOpp = new Map();
  for (const c of checks) {
    for (const id of c.oppIds) {
      if (!byOpp.has(id)) byOpp.set(id, []);
      byOpp.get(id).push(c.label);
    }
  }
  return { checks, byOpp, duplicates, overdue };
}

/**
 * Safe, automatic clean-up. Never deletes records and never guesses missing values.
 *   - trims/collapses whitespace in names, titles, owner, next action
 *   - lower-cases and trims email addresses
 *   - normalises domains (strips protocol, www., path, trailing dot; lower-case)
 *   - converts follow-up dates written as YYYY/MM/DD or DD/MM/YYYY to YYYY-MM-DD
 * Returns { state, changes: [{entity, id, field, from, to}] }.
 */
export function cleanState(state) {
  const changes = [];
  const apply = (entity, rec, field, fn) => {
    const from = rec[field];
    if (from === undefined || from === null) return;
    const to = fn(from);
    if (to !== from) {
      changes.push({ entity, id: rec.id, field, from, to });
      rec[field] = to;
    }
  };
  const organisations = state.organisations.map((o) => {
    const r = { ...o };
    apply('organisation', r, 'name', cleanText);
    apply('organisation', r, 'domain', (d) => (blank(d) ? '' : normalizeDomain(d)));
    apply('organisation', r, 'region', cleanText);
    return r;
  });
  const contacts = state.contacts.map((c) => {
    const r = { ...c };
    apply('contact', r, 'firstName', cleanText);
    apply('contact', r, 'lastName', cleanText);
    apply('contact', r, 'title', cleanText);
    apply('contact', r, 'email', (e) => String(e).trim().toLowerCase());
    return r;
  });
  const opportunities = state.opportunities.map((o) => {
    const r = { ...o };
    apply('opportunity', r, 'owner', cleanText);
    apply('opportunity', r, 'nextAction', cleanText);
    apply('opportunity', r, 'followUpDate', (d) => {
      if (blank(d)) return d === '' ? d : '';
      if (isValidISODate(d)) return d;
      return parseFlexibleDate(d) ?? d;
    });
    return r;
  });
  return { state: { ...state, organisations, contacts, opportunities }, changes };
}
