// CSV import/export for prospects and activities. Pure, no DOM.

import { parseCSVObjects, objectsToCSV } from './csv.js';
import { parseStage, ORG_TYPES, PRIORITIES, LOST_FROM_STAGES, ACTIVITY_TYPES, DIRECTIONS, OUTCOME_KEYS } from './constants.js';
import { parseFlexibleDate } from './dates.js';
import { isValidEmail, normalizeOrgName, normalizeDomain, cleanText } from './normalize.js';
import { addProspect, addActivity } from './model.js';
import { RATE_DEFINITIONS, formatRate } from './funnel.js';

export const PROSPECT_COLUMNS = [
  'organisation_name', 'organisation_type', 'domain', 'region',
  'contact_first_name', 'contact_last_name', 'contact_title', 'contact_email', 'contact_phone',
  'stage', 'lost_from_stage', 'priority', 'owner', 'next_action', 'follow_up_date', 'notes',
];

export const ACTIVITY_COLUMNS = ['opportunity_id', 'date', 'type', 'direction', 'outcome', 'note'];

export const MAX_IMPORT_ROWS = 5000;

function matchOrgType(v) {
  const s = cleanText(v).toLowerCase();
  if (!s) return 'Other';
  return ORG_TYPES.find((t) => t.toLowerCase() === s) ?? null;
}

/**
 * Validate a prospects CSV against the current state. Nothing is changed.
 * Returns { valid: [{line, input, warnings}], rejected: [{line, errors}], fileErrors, duplicatesOfExisting }
 */
export function parseProspectsCSV(text, state) {
  const out = { valid: [], rejected: [], fileErrors: [], duplicatesOfExisting: 0 };
  let parsed;
  try {
    parsed = parseCSVObjects(text);
  } catch (e) {
    out.fileErrors.push(`Could not read the CSV: ${e.message}.`);
    return out;
  }
  if (!parsed.headers.includes('organisation_name')) {
    out.fileErrors.push('Missing required column "organisation_name". Download the template from sample-data/ to see the expected columns.');
    return out;
  }
  if (parsed.records.length === 0) {
    out.fileErrors.push('The file has a header row but no data rows.');
    return out;
  }
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    out.fileErrors.push(`Too many rows (${parsed.records.length}). The limit is ${MAX_IMPORT_ROWS} per import.`);
    return out;
  }
  const unknown = parsed.headers.filter((h) => h && !PROSPECT_COLUMNS.includes(h) && !['opportunity_id', 'follow_up_status', 'last_activity', 'activity_count', 'data_quality_issues'].includes(h));
  if (unknown.length) out.fileErrors.push(`Ignored unknown column(s): ${unknown.join(', ')}.`);

  const existingNames = new Set(state.organisations.map((o) => normalizeOrgName(o.name)).filter(Boolean));
  const existingDomains = new Set(state.organisations.map((o) => normalizeDomain(o.domain)).filter(Boolean));

  for (const r of parsed.records) {
    const errors = [];
    const warnings = [];
    const orgName = cleanText(r.organisation_name);
    if (!orgName) errors.push('organisation_name is empty');
    const orgType = matchOrgType(r.organisation_type);
    if (orgType === null) errors.push(`organisation_type "${r.organisation_type}" is not one of ${ORG_TYPES.join(', ')}`);
    let stage = 'not_contacted';
    if (cleanText(r.stage)) {
      stage = parseStage(r.stage);
      if (!stage) errors.push(`stage "${r.stage}" is not recognised`);
    }
    let lostFromStage = '';
    if (stage === 'lost') {
      lostFromStage = parseStage(r.lost_from_stage) ?? '';
      if (!LOST_FROM_STAGES.includes(lostFromStage)) {
        warnings.push('lost_from_stage missing or invalid — assumed "contacted"');
        lostFromStage = 'contacted';
      }
    }
    let priority = cleanText(r.priority).toLowerCase() || 'medium';
    if (!PRIORITIES.includes(priority)) {
      warnings.push(`priority "${r.priority}" not recognised — set to medium`);
      priority = 'medium';
    }
    let followUpDate = '';
    if (cleanText(r.follow_up_date)) {
      followUpDate = parseFlexibleDate(r.follow_up_date) ?? '';
      if (!followUpDate) warnings.push(`follow_up_date "${r.follow_up_date}" is not a valid date — left blank`);
    }
    const email = String(r.contact_email ?? '').trim();
    if (email && !isValidEmail(email)) warnings.push(`contact_email "${email}" looks invalid — imported and flagged`);
    if (!email) warnings.push('no contact_email — imported and flagged');
    if (errors.length) {
      out.rejected.push({ line: r._line, errors });
      continue;
    }
    const nn = normalizeOrgName(orgName);
    const nd = normalizeDomain(r.domain);
    if ((nn && existingNames.has(nn)) || (nd && existingDomains.has(nd))) {
      warnings.push('looks like an existing organisation — review in Data quality → Duplicates after import');
      out.duplicatesOfExisting += 1;
    }
    out.valid.push({
      line: r._line,
      warnings,
      input: {
        orgName, orgType, domain: r.domain ?? '', region: r.region ?? '',
        firstName: r.contact_first_name ?? '', lastName: r.contact_last_name ?? '', title: r.contact_title ?? '',
        email, phone: r.contact_phone ?? '', stage, lostFromStage, priority,
        owner: r.owner ?? '', nextAction: r.next_action ?? '', followUpDate, notes: r.notes ?? '',
      },
    });
  }
  return out;
}

/** Apply validated prospect rows. Returns { state, added }. */
export function applyProspects(state, valid, at = new Date().toISOString()) {
  let s = state;
  let added = 0;
  for (const v of valid) {
    const res = addProspect(s, v.input, at);
    if (!res.errors.length) {
      s = res.state;
      added += 1;
    }
  }
  return { state: s, added };
}

/** Validate an activities CSV (keyed by opportunity_id). */
export function parseActivitiesCSV(text, state) {
  const out = { valid: [], rejected: [], fileErrors: [] };
  let parsed;
  try {
    parsed = parseCSVObjects(text);
  } catch (e) {
    out.fileErrors.push(`Could not read the CSV: ${e.message}.`);
    return out;
  }
  const missing = ['opportunity_id', 'date', 'type'].filter((c) => !parsed.headers.includes(c));
  if (missing.length) {
    out.fileErrors.push(`Missing required column(s): ${missing.join(', ')}.`);
    return out;
  }
  if (parsed.records.length === 0) {
    out.fileErrors.push('The file has a header row but no data rows.');
    return out;
  }
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    out.fileErrors.push(`Too many rows (${parsed.records.length}). The limit is ${MAX_IMPORT_ROWS} per import.`);
    return out;
  }
  const oppIds = new Set(state.opportunities.map((o) => o.id));
  for (const r of parsed.records) {
    const errors = [];
    const opportunityId = cleanText(r.opportunity_id);
    if (!oppIds.has(opportunityId)) errors.push(`opportunity_id "${opportunityId}" does not exist`);
    const date = parseFlexibleDate(r.date);
    if (!date) errors.push(`date "${r.date}" is not a valid date`);
    const type = cleanText(r.type).toLowerCase();
    if (!ACTIVITY_TYPES.includes(type)) errors.push(`type "${r.type}" must be one of ${ACTIVITY_TYPES.join(', ')}`);
    const direction = cleanText(r.direction).toLowerCase() || 'outbound';
    if (!DIRECTIONS.includes(direction)) errors.push(`direction "${r.direction}" must be outbound or inbound`);
    const outcome = cleanText(r.outcome).toLowerCase().replace(/\s+/g, '_') || (direction === 'inbound' ? 'replied' : 'sent');
    if (!OUTCOME_KEYS.includes(outcome)) errors.push(`outcome "${r.outcome}" is not recognised`);
    if (errors.length) out.rejected.push({ line: r._line, errors });
    else out.valid.push({ line: r._line, warnings: [], input: { opportunityId, date, type, direction, outcome, note: r.note ?? '' } });
  }
  return out;
}

export function applyActivities(state, valid) {
  let s = state;
  let added = 0;
  for (const v of valid) {
    const res = addActivity(s, v.input);
    if (!res.errors.length) {
      s = res.state;
      added += 1;
    }
  }
  return { state: s, added };
}

/** Flattened lead rows (from buildLeadRows) → CSV. Columns are a superset of the import template. */
export function leadsToCSV(rows) {
  const objs = rows.map((r) => ({
    opportunity_id: r.id,
    organisation_name: r.org?.name ?? '',
    organisation_type: r.org?.type ?? '',
    domain: r.org?.domain ?? '',
    region: r.org?.region ?? '',
    contact_first_name: r.contact?.firstName ?? '',
    contact_last_name: r.contact?.lastName ?? '',
    contact_title: r.contact?.title ?? '',
    contact_email: r.contact?.email ?? '',
    contact_phone: r.contact?.phone ?? '',
    stage: r.opp.stage,
    lost_from_stage: r.opp.lostFromStage ?? '',
    priority: r.opp.priority ?? '',
    owner: r.opp.owner ?? '',
    next_action: r.opp.nextAction ?? '',
    follow_up_date: r.opp.followUpDate ?? '',
    notes: r.opp.notes ?? '',
    follow_up_status: r.followUp,
    last_activity: r.lastActivity,
    activity_count: r.activityCount,
    data_quality_issues: r.issues.join('; '),
  }));
  return objectsToCSV(objs, ['opportunity_id', ...PROSPECT_COLUMNS, 'follow_up_status', 'last_activity', 'activity_count', 'data_quality_issues']);
}

export function activitiesToCSV(state) {
  const objs = state.activities.map((a) => ({
    activity_id: a.id, opportunity_id: a.opportunityId, contact_id: a.contactId, date: a.date,
    type: a.type, direction: a.direction, outcome: a.outcome, note: a.note ?? '',
  }));
  return objectsToCSV(objs, ['activity_id', 'opportunity_id', 'contact_id', ...ACTIVITY_COLUMNS.slice(1)]);
}

/** Funnel summary → CSV with numerator, denominator and definition for every rate. */
export function funnelToCSV(funnel, scopeLabel = 'All leads') {
  const rows = RATE_DEFINITIONS.map((d) => {
    const r = funnel.rates[d.key];
    return {
      scope: scopeLabel, metric: d.label, definition: d.text, numerator: r.numerator, denominator: r.denominator,
      value: r.value === null ? 'n/a' : r.value.toFixed(4), display: formatRate(r),
    };
  });
  return objectsToCSV(rows, ['scope', 'metric', 'definition', 'numerator', 'denominator', 'value', 'display']);
}
