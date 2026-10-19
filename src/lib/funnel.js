// Funnel metrics with explicit denominators. Pure, no DOM.
//
// Every opportunity has a "furthest stage reached" on the ladder
//   Not contacted(0) → Contacted(1) → Replied(2) → Qualified interest(3) → Meeting booked(4) → Proposal(5) → Won(6)
// A Lost opportunity counts as having reached the stage recorded in `lostFromStage`
// (defaults to Contacted when missing, because a lead must have been contacted to be lost).
//
// Rates (null = denominator is zero, displayed as "n/a"):
//   outreach rate        = contacted ÷ total prospects
//   reply rate           = replied ÷ contacted
//   qualified rate       = qualified ÷ replied
//   meeting rate         = meetings ÷ qualified
//   overall meeting rate = meetings ÷ contacted

import { LADDER, LOST_FROM_STAGES } from './constants.js';

export function reachedIndex(opp) {
  if (!opp) return 0;
  if (opp.stage === 'lost') {
    const from = LOST_FROM_STAGES.includes(opp.lostFromStage) ? opp.lostFromStage : 'contacted';
    return LADDER.indexOf(from);
  }
  const i = LADDER.indexOf(opp.stage);
  return i < 0 ? 0 : i;
}

/** Ratio object; value is null when the denominator is 0. */
export function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

/** "42.9%" or "n/a". */
export function formatRate(r, digits = 1) {
  const v = r && typeof r === 'object' ? r.value : r;
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return `${(v * 100).toFixed(digits)}%`;
}

export const RATE_DEFINITIONS = [
  { key: 'outreach', label: 'Outreach rate', numerator: 'contacted', denominator: 'total', text: 'Contacted ÷ total prospects' },
  { key: 'reply', label: 'Reply rate', numerator: 'replied', denominator: 'contacted', text: 'Replied ÷ contacted' },
  { key: 'qualified', label: 'Qualified rate', numerator: 'qualified', denominator: 'replied', text: 'Qualified interest ÷ replied' },
  { key: 'meeting', label: 'Meeting rate', numerator: 'meetings', denominator: 'qualified', text: 'Meetings booked ÷ qualified interest' },
  { key: 'overallMeeting', label: 'Overall meeting rate', numerator: 'meetings', denominator: 'contacted', text: 'Meetings booked ÷ contacted' },
];

export function computeFunnel(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  const counts = { total: list.length, contacted: 0, replied: 0, qualified: 0, meetings: 0, proposals: 0, won: 0, lost: 0, open: 0 };
  for (const o of list) {
    const r = reachedIndex(o);
    if (r >= 1) counts.contacted += 1;
    if (r >= 2) counts.replied += 1;
    if (r >= 3) counts.qualified += 1;
    if (r >= 4) counts.meetings += 1;
    if (r >= 5) counts.proposals += 1;
    if (o.stage === 'won') counts.won += 1;
    else if (o.stage === 'lost') counts.lost += 1;
    else counts.open += 1;
  }
  const rates = {};
  for (const d of RATE_DEFINITIONS) rates[d.key] = ratio(counts[d.numerator], counts[d.denominator]);
  rates.win = ratio(counts.won, counts.won + counts.lost);
  return { counts, rates };
}

/** Funnel per owner, sorted by owner name; blank owner grouped as "Unassigned". */
export function funnelByOwner(opportunities) {
  const groups = new Map();
  for (const o of opportunities) {
    const owner = (o.owner ?? '').trim() || 'Unassigned';
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(o);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === 'Unassigned') - (b[0] === 'Unassigned') || a[0].localeCompare(b[0]))
    .map(([owner, opps]) => ({ owner, ...computeFunnel(opps), byStage: countByStage(opps) }));
}

/** Count of opportunities currently in each stage (all 8 keys present). */
export function countByStage(opportunities) {
  const out = { not_contacted: 0, contacted: 0, replied: 0, qualified: 0, meeting_booked: 0, proposal: 0, won: 0, lost: 0 };
  for (const o of opportunities) if (o.stage in out) out[o.stage] += 1;
  return out;
}
