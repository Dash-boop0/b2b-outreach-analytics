// Shared enumerations for the outreach data model. Pure data, no DOM.

/** Opportunity stages in pipeline order. `lost` is terminal and sits outside the ladder. */
export const STAGES = [
  { key: 'not_contacted', label: 'Not contacted' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'replied', label: 'Replied' },
  { key: 'qualified', label: 'Qualified interest' },
  { key: 'meeting_booked', label: 'Meeting booked' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

/** Ordered ladder used for "furthest stage reached" (excludes lost). */
export const LADDER = ['not_contacted', 'contacted', 'replied', 'qualified', 'meeting_booked', 'proposal', 'won'];

/** Stages a lost opportunity can have been lost from. */
export const LOST_FROM_STAGES = ['contacted', 'replied', 'qualified', 'meeting_booked', 'proposal'];

export const CLOSED_STAGES = ['won', 'lost'];

export const STAGE_KEYS = STAGES.map((s) => s.key);

export function stageLabel(key) {
  const s = STAGES.find((x) => x.key === key);
  return s ? s.label : String(key ?? '');
}

/** Accepts a stage key or label (case/space-insensitive) and returns the key, or null. */
export function parseStage(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!v) return null;
  for (const s of STAGES) {
    if (s.key === v || s.label.toLowerCase().replace(/[\s-]+/g, '_') === v) return s.key;
  }
  if (v === 'meeting' || v === 'meetings') return 'meeting_booked';
  if (v === 'qualified_interest') return 'qualified';
  return null;
}

export const ORG_TYPES = ['University', 'School', 'Hospital', 'NGO', 'Council', 'Other'];

export const PRIORITIES = ['high', 'medium', 'low'];

export const ACTIVITY_TYPES = ['email', 'call', 'linkedin', 'meeting'];

export const DIRECTIONS = ['outbound', 'inbound'];

export const OUTCOMES = [
  { key: 'sent', label: 'Sent (no response yet)' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'voicemail', label: 'Left voicemail' },
  { key: 'bounced', label: 'Bounced' },
  { key: 'replied', label: 'Replied' },
  { key: 'interested', label: 'Interested' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'meeting_booked', label: 'Meeting booked' },
  { key: 'meeting_held', label: 'Meeting held' },
  { key: 'proposal_sent', label: 'Proposal sent' },
];

export const OUTCOME_KEYS = OUTCOMES.map((o) => o.key);

export function outcomeLabel(key) {
  const o = OUTCOMES.find((x) => x.key === key);
  return o ? o.label : String(key ?? '');
}

export const STATE_VERSION = 1;
export const STORAGE_KEY = 'dash.b2b-outreach-analytics.v1';
