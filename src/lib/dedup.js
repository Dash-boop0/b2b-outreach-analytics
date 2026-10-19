// Duplicate detection and merging. Pure functions, no DOM.
//
// Organisations are duplicate candidates when they share
//   - the same normalised name (see normalizeOrgName), and/or
//   - the same normalised domain (see normalizeDomain).
// Contacts are duplicate candidates when they share
//   - the same normalised email address, and/or
//   - the same first + last name within the same organisation.
// A candidate pair can be dismissed ("not a duplicate"); dismissed pair ids are stored in state.

import { normalizeOrgName, normalizeDomain, normalizeEmail, normalizePersonName } from './normalize.js';
import { reachedIndex } from './funnel.js';
import { PRIORITIES } from './constants.js';

export function pairId(kind, idA, idB) {
  const [x, y] = [String(idA), String(idB)].sort();
  return `${kind}:${x}|${y}`;
}

function bucketPairs(items, keyFn, reason, kind, pairs, indexOf) {
  const buckets = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        let [a, b] = [group[i], group[j]];
        if (indexOf.get(a.id) > indexOf.get(b.id)) [a, b] = [b, a];
        const id = pairId(kind, a.id, b.id);
        if (!pairs.has(id)) pairs.set(id, { id, kind, a: a.id, b: b.id, reasons: [], matchedOn: [] });
        const p = pairs.get(id);
        p.reasons.push(reason);
        p.matchedOn.push(key);
      }
    }
  }
}

function finish(pairs, dismissed) {
  const skip = new Set(dismissed ?? []);
  return [...pairs.values()]
    .filter((p) => !skip.has(p.id))
    .sort((p, q) => q.reasons.length - p.reasons.length || p.id.localeCompare(q.id));
}

export function findDuplicateOrganisations(organisations, dismissed = []) {
  const orgs = organisations ?? [];
  const indexOf = new Map(orgs.map((o, i) => [o.id, i]));
  const pairs = new Map();
  bucketPairs(orgs, (o) => normalizeOrgName(o.name), 'Same normalised name', 'org', pairs, indexOf);
  bucketPairs(orgs, (o) => normalizeDomain(o.domain), 'Same domain', 'org', pairs, indexOf);
  return finish(pairs, dismissed);
}

export function findDuplicateContacts(contacts, dismissed = []) {
  const list = contacts ?? [];
  const indexOf = new Map(list.map((c, i) => [c.id, i]));
  const pairs = new Map();
  bucketPairs(list, (c) => normalizeEmail(c.email), 'Same email address', 'contact', pairs, indexOf);
  bucketPairs(
    list,
    (c) => {
      const n = normalizePersonName(c.firstName, c.lastName);
      return n && c.orgId ? `${c.orgId}::${n}` : '';
    },
    'Same name at same organisation',
    'contact',
    pairs,
    indexOf,
  );
  return finish(pairs, dismissed);
}

export function findAllDuplicates(state) {
  const dismissed = state.dismissedDuplicates ?? [];
  return {
    organisations: findDuplicateOrganisations(state.organisations, dismissed),
    contacts: findDuplicateContacts(state.contacts, dismissed),
  };
}

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Copy of `keep` with blank fields filled from `drop`. */
function fillBlanks(keep, drop) {
  const out = { ...keep };
  for (const [k, v] of Object.entries(drop)) {
    if (k === 'id') continue;
    if (isBlank(out[k]) && !isBlank(v)) out[k] = v;
  }
  return out;
}

function opportunityRank(o) {
  // won > open > lost, then furthest stage reached
  const cls = o.stage === 'won' ? 2 : o.stage === 'lost' ? 0 : 1;
  return cls * 10 + reachedIndex(o);
}

/**
 * Combine several opportunities into one survivor (highest rank). Activities move to the survivor,
 * blank survivor fields are filled from the others, priority becomes the highest, notes are concatenated.
 */
export function combineOpportunities(state, oppIds) {
  if (oppIds.length < 2) return state;
  const opps = state.opportunities.filter((o) => oppIds.includes(o.id));
  const ranked = [...opps].sort((a, b) => opportunityRank(b) - opportunityRank(a) || state.opportunities.indexOf(a) - state.opportunities.indexOf(b));
  let survivor = { ...ranked[0] };
  const others = ranked.slice(1);
  for (const o of others) {
    survivor = fillBlanks(survivor, o);
    const pi = (p) => (PRIORITIES.includes(p) ? PRIORITIES.indexOf(p) : 99);
    if (pi(o.priority) < pi(survivor.priority)) survivor.priority = o.priority;
    if (!isBlank(o.notes) && o.notes !== survivor.notes && !String(survivor.notes ?? '').includes(o.notes)) {
      survivor.notes = [survivor.notes, o.notes].filter((x) => !isBlank(x)).join(' | ');
    }
  }
  const otherIds = new Set(others.map((o) => o.id));
  return {
    ...state,
    opportunities: state.opportunities.filter((o) => !otherIds.has(o.id)).map((o) => (o.id === survivor.id ? survivor : o)),
    activities: state.activities.map((a) => (otherIds.has(a.opportunityId) ? { ...a, opportunityId: survivor.id } : a)),
  };
}

function cleanupDismissed(list, removedId) {
  return (list ?? []).filter((p) => !p.split(':')[1].split('|').includes(removedId));
}

/** Merge organisation `dropId` into `keepId`. Returns a new state. Throws on bad ids. */
export function mergeOrganisations(state, keepId, dropId) {
  if (keepId === dropId) throw new Error('Cannot merge an organisation into itself');
  const keep = state.organisations.find((o) => o.id === keepId);
  const drop = state.organisations.find((o) => o.id === dropId);
  if (!keep || !drop) throw new Error('Organisation not found — it may already have been merged');
  let next = {
    ...state,
    organisations: state.organisations.filter((o) => o.id !== dropId).map((o) => (o.id === keepId ? fillBlanks(keep, drop) : o)),
    contacts: state.contacts.map((c) => (c.orgId === dropId ? { ...c, orgId: keepId } : c)),
    opportunities: state.opportunities.map((o) => (o.orgId === dropId ? { ...o, orgId: keepId } : o)),
    dismissedDuplicates: cleanupDismissed(state.dismissedDuplicates, dropId),
  };
  const oppIds = next.opportunities.filter((o) => o.orgId === keepId).map((o) => o.id);
  if (oppIds.length > 1) next = combineOpportunities(next, oppIds);
  return next;
}

/** Merge contact `dropId` into `keepId`. Returns a new state. */
export function mergeContacts(state, keepId, dropId) {
  if (keepId === dropId) throw new Error('Cannot merge a contact into itself');
  const keep = state.contacts.find((c) => c.id === keepId);
  const drop = state.contacts.find((c) => c.id === dropId);
  if (!keep || !drop) throw new Error('Contact not found — it may already have been merged');
  return {
    ...state,
    contacts: state.contacts.filter((c) => c.id !== dropId).map((c) => (c.id === keepId ? fillBlanks(keep, drop) : c)),
    opportunities: state.opportunities.map((o) => (o.contactId === dropId ? { ...o, contactId: keepId } : o)),
    activities: state.activities.map((a) => (a.contactId === dropId ? { ...a, contactId: keepId } : a)),
    dismissedDuplicates: cleanupDismissed(state.dismissedDuplicates, dropId),
  };
}

export function dismissPair(state, id) {
  const list = state.dismissedDuplicates ?? [];
  return list.includes(id) ? state : { ...state, dismissedDuplicates: [...list, id] };
}
