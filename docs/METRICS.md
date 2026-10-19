# Metric definitions and method

All calculations live in `src/lib/` and are covered by tests with hand-computed cases (`tests/funnel.test.js`, `tests/leads.test.js`, `tests/quality.test.js`, `tests/dedup.test.js`).

## Stage ladder

| # | Stage | Meaning |
|---|---|---|
| 0 | Not contacted | In the target list; no outreach yet |
| 1 | Contacted | At least one outbound touch |
| 2 | Replied | The prospect responded (positively or not) |
| 3 | Qualified interest | Confirmed need/fit worth a meeting |
| 4 | Meeting booked | A meeting is agreed (held or upcoming) |
| 5 | Proposal | A proposal or quote has been shared |
| 6 | Won | Agreement reached |
| – | Lost | Closed without a deal; `lostFromStage` records the furthest stage reached (Contacted…Proposal) |

**Furthest stage reached** (`reachedIndex`):

- For an open or Won lead, it is the index of the lead's current stage.
- For a Lost lead, it is the index of `lostFromStage`. If that is missing or invalid, it defaults to Contacted, because a lead cannot be lost before it was contacted.
- When you change a lead to Lost in the UI without choosing a stage, `lostFromStage` is set to the previous furthest stage. The minimum is Contacted and the maximum is Proposal.

## Funnel counts

Each count is the number of leads whose furthest stage reached is at least that step:

- `total` = all leads in scope
- `contacted` = reached ≥ 1
- `replied` = reached ≥ 2
- `qualified` = reached ≥ 3
- `meetings` = reached ≥ 4
- `proposals` = reached ≥ 5

## Rates

| Rate | Numerator | Denominator |
|---|---|---|
| Outreach rate | contacted | total prospects |
| Reply rate | replied | contacted |
| Qualified rate | qualified | replied |
| Meeting rate | meetings | qualified |
| Overall meeting rate | meetings | contacted |
| Win rate | won | won + lost |

- When the denominator is 0, the value is `null` and is displayed as **n/a**. A real 0 ÷ n shows as 0.0%.
- Display rounds to one decimal place. The CSV export includes the unrounded value to four decimal places.
- Scope filters on the Dashboard (owner, organisation type) restrict which leads are counted; the definitions do not change.

### Worked example (from `tests/funnel.test.js`)

The test uses 10 leads:

- 2 Not contacted
- 2 Contacted
- 1 Replied
- 1 Qualified
- 1 Meeting booked
- 1 Proposal
- 1 Won
- 1 Lost after Replied

Counts: contacted = 8, replied = 6, qualified = 4, meetings = 3.

| Rate | Calculation | Result |
|---|---|---|
| Outreach | 8 ÷ 10 | 80.0% |
| Reply | 6 ÷ 8 | 75.0% |
| Qualified | 4 ÷ 6 | 66.7% |
| Meeting | 3 ÷ 4 | 75.0% |
| Overall meeting | 3 ÷ 8 | 37.5% |
| Win | 1 ÷ 2 | 50.0% |

## Weekly trend

- Activities are grouped into ISO weeks, Monday to Sunday. The chart covers the 12 weeks ending with the week that contains the as-of date.
- Outbound activities are stacked by type (email, call, LinkedIn, meeting).
- **Replies** are inbound activities.
- **Reply ratio** (shown in the table) = replies ÷ outbound touches in the same week. It is `n/a` when there were no outbound touches that week. This is an activity-level ratio, **not** the funnel reply rate.
- Activities with invalid dates, or dates outside the window, are ignored.

## Follow-up status

The status is relative to the as-of date, which you set on the Import / Export page:

| Status | Rule |
|---|---|
| closed | the lead is Won or Lost |
| none | open, and the follow-up date is missing or not a valid `YYYY-MM-DD` |
| overdue | the follow-up date is before the as-of date |
| today | the follow-up date is the as-of date |
| soon | due in 1–7 days |
| later | due in more than 7 days |

The "Due in next 7 days" filter covers *today* plus *soon*.

## Data-quality checks

| Check | Counted in | Rule |
|---|---|---|
| Missing email | contacts | email blank |
| Invalid email | contacts | non-blank and fails the syntax check: one `@`; a local part with no spaces and no leading, trailing or double dots; domain labels made of letters, digits and hyphens; a TLD of 2+ letters |
| Missing follow-up date | open leads | no valid ISO follow-up date |
| Duplicate organisations | candidate pairs | see below |
| Duplicate contacts | candidate pairs | see below |
| Missing owner | open leads | owner blank |
| Missing/invalid domain | organisations | domain blank or not a valid hostname after normalisation |
| Stage/activity mismatch | leads | "Not contacted" but an outbound activity is logged, **or** past Not contacted with no activity logged |

Clicking **Show N lead(s)** filters the Leads page to the leads affected by that check. A contact or organisation issue is attributed to every lead at that organisation.

### Clean data

The **Clean data** action makes these changes, and only these:

- trims and collapses whitespace in names, titles, owner, next action and region
- lower-cases emails
- normalises domains
- converts `DD/MM/YYYY` and `YYYY/MM/DD` follow-up dates to ISO

It never deletes records and never fills in missing values. The app shows a preview of every change before applying anything, and running it a second time changes nothing (it is idempotent).

## Duplicate detection

**Organisation name normalisation** applies these steps in order:

1. Unicode NFKD, then accents removed
2. Lower-case
3. `&` → `and`
4. Non-alphanumerics → spaces
5. Abbreviations expanded: univ/uni → university, st → saint, intl → international, coll → college, sch → school, hosp → hospital, fdn → foundation, ctr/center → centre, assoc → association, dept → department, cncl → council
6. The words `the`, `of` and `and` dropped

Word order is kept on purpose: "Northbridge University" and "University of Northbridge" are *not* matched.

**Domain normalisation:**

- lower-case
- strip the protocol, credentials, `www.`/`www2.`, port, path, query and trailing dot
- if given an email address, use its domain

**What counts as a pair:**

- **Organisation pairs:** same non-empty normalised name and/or same non-empty normalised domain. Both reasons are listed when both match.
- **Contact pairs:** same non-empty email (trimmed, case-insensitive), and/or same first + last name (normalised) within the same organisation.

Pairs can be dismissed ("Not a duplicate"). Dismissals are stored by an order-independent pair id.

### Merging

**Merging organisations (keep A, drop B):**

1. A's blank fields are filled from B.
2. B's contacts and leads move to A.
3. If A now has more than one lead, the leads are combined into one survivor. The survivor is chosen by Won > open > Lost, then by furthest stage, then by order of creation.
4. Activities move to the survivor.
5. Blank fields on the survivor are filled from the other leads, priority becomes the highest of them, and notes are concatenated.
6. Stale dismissals that mention B are removed.

**Merging contacts:** A's blank fields are filled from B, and any lead or activity that pointed at B is repointed to A.

Merging two organisations can create new contact pairs (the same person now at one organisation). These appear for review straight away.
