// State shape, validation and state transitions. Pure, no DOM.
//
// state = {
//   version, meta: { synthetic, source, demoToday, label },
//   settings: { today: 'YYYY-MM-DD' | null },          // null → use the system date
//   organisations: [{ id, name, type, domain, region }],
//   contacts:      [{ id, orgId, firstName, lastName, title, email, phone }],
//   opportunities: [{ id, orgId, contactId, stage, lostFromStage, priority, owner, nextAction, followUpDate, notes, createdAt, updatedAt }],
//   activities:    [{ id, opportunityId, contactId, date, type, direction, outcome, note }],
//   dismissedDuplicates: [pairId], log: [{ at, message }]
// }

import {
  STATE_VERSION, STAGE_KEYS, PRIORITIES, ORG_TYPES, ACTIVITY_TYPES, DIRECTIONS, OUTCOME_KEYS,
  LOST_FROM_STAGES, LADDER,
} from './constants.js';
import { isValidISODate } from './dates.js';
import { cleanText } from './normalize.js';
import { reachedIndex } from './funnel.js';

export function emptyState() {
  return {
    version: STATE_VERSION,
    meta: { synthetic: false, source: 'empty', demoToday: null, label: '' },
    settings: { today: null },
    organisations: [],
    contacts: [],
    opportunities: [],
    activities: [],
    dismissedDuplicates: [],
    log: [],
  };
}

export function effectiveToday(state, systemTodayIso) {
  const t = state?.settings?.today;
  return isValidISODate(t) ? t : systemTodayIso;
}

/** Next id like "org-101" given existing records with ids "org-NNN". */
export function nextId(prefix, records) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of records) {
    const m = re.exec(r.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function appendLog(state, message, at = new Date().toISOString()) {
  const log = [{ at, message }, ...(state.log ?? [])].slice(0, 200);
  return { ...state, log };
}

/**
 * Validate an object (e.g. restored from a JSON backup). Returns { ok, errors, state }.
 * Checks structure, enumerations, unique ids and references between records.
 */
export function validateState(obj) {
  const errors = [];
  const err = (m) => {
    if (errors.length < 15) errors.push(m);
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['File is not a JSON object exported by this app.'], state: null };
  }
  if (obj.version !== STATE_VERSION) err(`Unsupported version "${obj.version}" (expected ${STATE_VERSION}).`);
  for (const k of ['organisations', 'contacts', 'opportunities', 'activities']) {
    if (!Array.isArray(obj[k])) err(`Missing "${k}" list.`);
  }
  if (errors.length) return { ok: false, errors, state: null };

  const ids = (list, label) => {
    const set = new Set();
    list.forEach((r, i) => {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) err(`${label} #${i + 1} has no id.`);
      else if (set.has(r.id)) err(`${label} id "${r.id}" is used twice.`);
      else set.add(r.id);
    });
    return set;
  };
  const orgIds = ids(obj.organisations, 'Organisation');
  const contactIds = ids(obj.contacts, 'Contact');
  const oppIds = ids(obj.opportunities, 'Opportunity');
  ids(obj.activities, 'Activity');

  for (const o of obj.organisations) if (o && typeof o.name !== 'string') err(`Organisation "${o.id}" has no name.`);
  for (const c of obj.contacts) if (c && !orgIds.has(c.orgId)) err(`Contact "${c.id}" points to unknown organisation "${c.orgId}".`);
  for (const o of obj.opportunities) {
    if (!o) continue;
    if (!orgIds.has(o.orgId)) err(`Opportunity "${o.id}" points to unknown organisation "${o.orgId}".`);
    if (o.contactId && !contactIds.has(o.contactId)) err(`Opportunity "${o.id}" points to unknown contact "${o.contactId}".`);
    if (!STAGE_KEYS.includes(o.stage)) err(`Opportunity "${o.id}" has unknown stage "${o.stage}".`);
  }
  for (const a of obj.activities) {
    if (!a) continue;
    if (!oppIds.has(a.opportunityId)) err(`Activity "${a.id}" points to unknown opportunity "${a.opportunityId}".`);
    if (!ACTIVITY_TYPES.includes(a.type)) err(`Activity "${a.id}" has unknown type "${a.type}".`);
    if (!isValidISODate(a.date)) err(`Activity "${a.id}" has an invalid date "${a.date}".`);
  }
  if (errors.length) return { ok: false, errors, state: null };

  const base = emptyState();
  const state = {
    ...base,
    ...obj,
    meta: { ...base.meta, ...(obj.meta ?? {}) },
    settings: { ...base.settings, ...(obj.settings ?? {}) },
    dismissedDuplicates: Array.isArray(obj.dismissedDuplicates) ? obj.dismissedDuplicates.filter((x) => typeof x === 'string') : [],
    log: Array.isArray(obj.log) ? obj.log.slice(0, 200) : [],
  };
  return { ok: true, errors: [], state };
}

/** Validate an opportunity patch. Returns array of error strings. */
export function validateOpportunityPatch(patch) {
  const errors = [];
  if ('stage' in patch && !STAGE_KEYS.includes(patch.stage)) errors.push(`Unknown stage "${patch.stage}".`);
  if ('priority' in patch && patch.priority !== '' && !PRIORITIES.includes(patch.priority)) errors.push('Priority must be high, medium or low.');
  if ('followUpDate' in patch && patch.followUpDate !== '' && !isValidISODate(patch.followUpDate)) errors.push('Follow-up date must be a real date (YYYY-MM-DD) or blank.');
  if ('lostFromStage' in patch && patch.lostFromStage && !LOST_FROM_STAGES.includes(patch.lostFromStage)) errors.push('"Lost after" must be a stage between Contacted and Proposal.');
  if ('owner' in patch && String(patch.owner).length > 80) errors.push('Owner name is too long (max 80 characters).');
  if ('nextAction' in patch && String(patch.nextAction).length > 200) errors.push('Next action is too long (max 200 characters).');
  return errors;
}

/**
 * Update an opportunity. When the stage changes to Lost without a "lost after" stage, it is set to the
 * furthest stage reached before (minimum Contacted). Leaving Lost clears it.
 * Returns { state, errors }.
 */
export function updateOpportunity(state, id, patch, at = new Date().toISOString()) {
  const errors = validateOpportunityPatch(patch);
  const current = state.opportunities.find((o) => o.id === id);
  if (!current) errors.push('Lead not found — it may have been merged or removed.');
  if (errors.length) return { state, errors };
  const next = { ...current, ...patch, updatedAt: at };
  for (const k of ['owner', 'nextAction', 'notes']) if (k in patch) next[k] = cleanText(patch[k]);
  if (next.stage === 'lost') {
    if (!LOST_FROM_STAGES.includes(next.lostFromStage)) {
      const idx = Math.min(Math.max(reachedIndex(current), 1), LADDER.indexOf('proposal'));
      next.lostFromStage = LADDER[idx];
    }
  } else {
    next.lostFromStage = '';
  }
  return { state: { ...state, opportunities: state.opportunities.map((o) => (o.id === id ? next : o)) }, errors: [] };
}

export function validateActivity(state, a) {
  const errors = [];
  if (!state.opportunities.some((o) => o.id === a.opportunityId)) errors.push('Activity must belong to an existing lead.');
  if (!isValidISODate(a.date)) errors.push('Activity date must be a real date (YYYY-MM-DD).');
  if (!ACTIVITY_TYPES.includes(a.type)) errors.push(`Type must be one of: ${ACTIVITY_TYPES.join(', ')}.`);
  if (!DIRECTIONS.includes(a.direction)) errors.push('Direction must be outbound or inbound.');
  if (!OUTCOME_KEYS.includes(a.outcome)) errors.push(`Outcome must be one of: ${OUTCOME_KEYS.join(', ')}.`);
  if (a.note && String(a.note).length > 500) errors.push('Note is too long (max 500 characters).');
  return errors;
}

/** Log an outreach activity (a record only — nothing is sent). Returns { state, errors, activity }. */
export function addActivity(state, input) {
  const opp = state.opportunities.find((o) => o.id === input.opportunityId);
  const activity = {
    id: input.id || nextId('act', state.activities),
    opportunityId: input.opportunityId,
    contactId: input.contactId || opp?.contactId || '',
    date: String(input.date ?? '').trim(),
    type: String(input.type ?? '').trim().toLowerCase(),
    direction: String(input.direction ?? 'outbound').trim().toLowerCase(),
    outcome: String(input.outcome ?? '').trim().toLowerCase(),
    note: cleanText(input.note ?? ''),
  };
  const errors = validateActivity(state, activity);
  if (errors.length) return { state, errors, activity: null };
  return { state: { ...state, activities: [...state.activities, activity] }, errors: [], activity };
}

/**
 * Add a prospect = organisation + primary contact + opportunity.
 * input: { orgName, orgType, domain, region, firstName, lastName, title, email, phone,
 *          stage, lostFromStage, priority, owner, nextAction, followUpDate, notes }
 * Returns { state, errors, ids }.
 */
export function addProspect(state, input, at = new Date().toISOString()) {
  const errors = [];
  const orgName = cleanText(input.orgName);
  if (!orgName) errors.push('Organisation name is required.');
  const orgType = input.orgType || 'Other';
  if (!ORG_TYPES.includes(orgType)) errors.push(`Organisation type must be one of: ${ORG_TYPES.join(', ')}.`);
  const stage = input.stage || 'not_contacted';
  if (!STAGE_KEYS.includes(stage)) errors.push(`Unknown stage "${stage}".`);
  const priority = input.priority || 'medium';
  if (!PRIORITIES.includes(priority)) errors.push('Priority must be high, medium or low.');
  const followUpDate = String(input.followUpDate ?? '').trim();
  if (followUpDate && !isValidISODate(followUpDate)) errors.push('Follow-up date must be YYYY-MM-DD or blank.');
  if (errors.length) return { state, errors, ids: null };

  const orgId = nextId('org', state.organisations);
  const hasContact = [input.firstName, input.lastName, input.email].some((v) => cleanText(v));
  const contactId = hasContact ? nextId('con', state.contacts) : '';
  const oppId = nextId('opp', state.opportunities);
  const org = { id: orgId, name: orgName, type: orgType, domain: String(input.domain ?? '').trim(), region: cleanText(input.region) };
  const contacts = hasContact
    ? [...state.contacts, {
      id: contactId, orgId, firstName: cleanText(input.firstName), lastName: cleanText(input.lastName),
      title: cleanText(input.title), email: String(input.email ?? '').trim(), phone: cleanText(input.phone),
    }]
    : state.contacts;
  const opp = {
    id: oppId, orgId, contactId, stage,
    lostFromStage: stage === 'lost' ? (LOST_FROM_STAGES.includes(input.lostFromStage) ? input.lostFromStage : 'contacted') : '',
    priority, owner: cleanText(input.owner), nextAction: cleanText(input.nextAction), followUpDate,
    notes: cleanText(input.notes), createdAt: at, updatedAt: at,
  };
  return {
    state: { ...state, organisations: [...state.organisations, org], contacts, opportunities: [...state.opportunities, opp] },
    errors: [],
    ids: { orgId, contactId, oppId },
  };
}
