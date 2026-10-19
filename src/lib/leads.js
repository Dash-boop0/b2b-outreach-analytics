// Lead rows (organisation + primary contact + opportunity joined), follow-up status,
// filtering, sorting and weekly activity trend. Pure, no DOM.

import { CLOSED_STAGES, stageLabel, LADDER, ACTIVITY_TYPES } from './constants.js';
import { isValidISODate, toDayNumber, startOfWeek, addDays, formatDate } from './dates.js';
import { reachedIndex } from './funnel.js';

export function isOpen(opp) {
  return !CLOSED_STAGES.includes(opp.stage);
}

/**
 * Follow-up status relative to `today`:
 *   closed  – opportunity is Won or Lost (follow-ups not tracked)
 *   none    – open, no valid follow-up date
 *   overdue – follow-up date is before today
 *   today   – due today
 *   soon    – due in the next 7 days
 *   later   – due after that
 */
export function followUpStatus(opp, today) {
  if (!isOpen(opp)) return 'closed';
  if (!isValidISODate(opp.followUpDate)) return 'none';
  const d = toDayNumber(opp.followUpDate) - toDayNumber(today);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'soon';
  return 'later';
}

export function isOverdue(opp, today) {
  return followUpStatus(opp, today) === 'overdue';
}

export function buildLeadRows(state, today, issuesByOpp = new Map()) {
  const orgs = new Map(state.organisations.map((o) => [o.id, o]));
  const contacts = new Map(state.contacts.map((c) => [c.id, c]));
  const acts = new Map();
  for (const a of state.activities) {
    if (!acts.has(a.opportunityId)) acts.set(a.opportunityId, []);
    acts.get(a.opportunityId).push(a);
  }
  return state.opportunities.map((opp) => {
    const org = orgs.get(opp.orgId) ?? null;
    const contact = contacts.get(opp.contactId) ?? null;
    const list = acts.get(opp.id) ?? [];
    let last = '';
    for (const a of list) if (isValidISODate(a.date) && a.date > last) last = a.date;
    return {
      id: opp.id,
      opp,
      org,
      contact,
      orgName: org?.name ?? '(missing organisation)',
      orgType: org?.type ?? '',
      region: org?.region ?? '',
      domain: org?.domain ?? '',
      contactName: contact ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() : '',
      email: contact?.email ?? '',
      stage: opp.stage,
      stageLabel: stageLabel(opp.stage),
      stageOrder: opp.stage === 'lost' ? LADDER.length : LADDER.indexOf(opp.stage),
      reached: reachedIndex(opp),
      priority: opp.priority ?? '',
      owner: (opp.owner ?? '').trim(),
      nextAction: opp.nextAction ?? '',
      followUpDate: opp.followUpDate ?? '',
      followUp: followUpStatus(opp, today),
      lastActivity: last,
      activityCount: list.length,
      issues: issuesByOpp.get(opp.id) ?? [],
    };
  });
}

export const EMPTY_FILTERS = { q: '', stage: '', owner: '', priority: '', type: '', followUp: '', issuesOnly: false };

export function filterLeads(rows, filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.stage && r.stage !== f.stage) return false;
    if (f.owner === '__unassigned') {
      if (r.owner) return false;
    } else if (f.owner && r.owner !== f.owner) return false;
    if (f.priority && r.priority !== f.priority) return false;
    if (f.type && r.orgType !== f.type) return false;
    if (f.followUp === 'overdue' && r.followUp !== 'overdue') return false;
    if (f.followUp === 'due7' && !['today', 'soon'].includes(r.followUp)) return false;
    if (f.followUp === 'none' && r.followUp !== 'none') return false;
    if (f.issuesOnly && r.issues.length === 0) return false;
    if (f.ids && !f.ids.has(r.id)) return false;
    if (q) {
      const hay = `${r.orgName} ${r.contactName} ${r.email} ${r.domain} ${r.nextAction} ${r.owner}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function sortLeads(rows, key = 'followUpDate', dir = 'asc') {
  const mul = dir === 'desc' ? -1 : 1;
  const val = (r) => {
    switch (key) {
      case 'stage':
        return r.stageOrder;
      case 'priority':
        return PRIORITY_ORDER[r.priority] ?? 9;
      case 'followUpDate':
        // blanks last in ascending order
        return r.followUpDate && isValidISODate(r.followUpDate) ? r.followUpDate : '￿';
      default:
        return String(r[key] ?? '').toLowerCase();
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x < y) return -1 * mul;
    if (x > y) return 1 * mul;
    return a.orgName.localeCompare(b.orgName);
  });
}

/**
 * Weekly activity trend for the `weeks` ISO weeks (Mon–Sun) ending with the week containing `today`.
 *   outbound[type] – outbound touches by activity type
 *   replies        – inbound activities (a reply received)
 *   meetingsHeld   – activities with outcome "meeting_held"
 *   replyRatio     – replies ÷ outbound touches in the same week (activity-level, NOT the funnel reply rate)
 */
export function weeklyTrend(activities, today, weeks = 12) {
  const lastWeek = startOfWeek(today);
  const firstWeek = addDays(lastWeek, -7 * (weeks - 1));
  const buckets = [];
  for (let w = 0; w < weeks; w += 1) {
    const ws = addDays(firstWeek, 7 * w);
    const outbound = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, 0]));
    buckets.push({ weekStart: ws, label: formatDate(ws, { year: false }), outbound, outboundTotal: 0, replies: 0, meetingsHeld: 0, replyRatio: null });
  }
  const start = toDayNumber(firstWeek);
  for (const a of activities ?? []) {
    if (!isValidISODate(a.date)) continue;
    const idx = Math.floor((toDayNumber(a.date) - start) / 7);
    if (idx < 0 || idx >= weeks) continue;
    const b = buckets[idx];
    if (a.direction === 'inbound') b.replies += 1;
    else if (ACTIVITY_TYPES.includes(a.type)) {
      b.outbound[a.type] += 1;
      b.outboundTotal += 1;
    }
    if (a.outcome === 'meeting_held') b.meetingsHeld += 1;
  }
  for (const b of buckets) b.replyRatio = b.outboundTotal > 0 ? b.replies / b.outboundTotal : null;
  return buckets;
}

/** Distinct, sorted owner names present in the data. */
export function ownersOf(opportunities) {
  return [...new Set(opportunities.map((o) => (o.owner ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
