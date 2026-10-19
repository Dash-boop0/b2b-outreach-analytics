import { RATE_DEFINITIONS, computeFunnel, formatRate } from '../lib/funnel.js';
import { QUALITY_CHECKS } from '../lib/quality.js';
import { STAGES } from '../lib/constants.js';
import { esc } from '../lib/charts.js';

export function renderMethod(ctx) {
  const f = computeFunnel(ctx.state.opportunities);
  return `
  <div class="page-head"><div><h1>Metrics &amp; method</h1><p class="muted">How every number in this app is calculated. Full write-up: <a href="https://github.com/Dash-boop0/b2b-outreach-analytics/blob/main/docs/METRICS.md">docs/METRICS.md</a>.</p></div></div>
  <div class="card prose">
    <h2>Pipeline stages</h2>
    <p>Each lead (opportunity) is in exactly one stage. The ladder is ordered; <strong>Lost</strong> is terminal and records the stage it was lost after.</p>
    <ol>${STAGES.map((s) => `<li>${esc(s.label)}</li>`).join('')}</ol>
    <p>Funnel counts use the <strong>furthest stage reached</strong>: a lead in Proposal also counts as contacted, replied, qualified and meeting booked. A Lost lead counts up to its “lost after” stage (Contacted if not recorded). Won counts as having passed every stage.</p>

    <h2>Funnel rates and denominators</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>Metric</th><th>Formula</th><th class="num">Current data</th></tr></thead><tbody>
    ${RATE_DEFINITIONS.map((d) => { const r = f.rates[d.key]; return `<tr><td>${esc(d.label)}</td><td>${esc(d.text)}</td><td class="num">${r.numerator} ÷ ${r.denominator} = ${formatRate(r)}</td></tr>`; }).join('')}
    <tr><td>Win rate</td><td>Won ÷ (Won + Lost)</td><td class="num">${f.rates.win.numerator} ÷ ${f.rates.win.denominator} = ${formatRate(f.rates.win)}</td></tr>
    </tbody></table></div>
    <p>When a denominator is zero the rate is shown as <strong>n/a</strong>, never 0%. Rates are rounded to one decimal place for display only; exports include the unrounded value.</p>

    <h2>Weekly trend</h2>
    <p>Activities are grouped into ISO weeks (Monday–Sunday) for the 12 weeks ending with the week that contains the as-of date. Outbound touches are stacked by type; the line counts <em>inbound</em> activities (replies received). The “reply ratio” in the table is replies ÷ outbound touches in the same week — an activity-level ratio that is <strong>not</strong> the funnel reply rate.</p>

    <h2>Follow-ups</h2>
    <p>A lead is <strong>overdue</strong> when it is open (not Won/Lost) and its follow-up date is before the as-of date. “Due in next 7 days” covers today through today + 7. The as-of date defaults to the sample’s demo date and can be changed on the Import / Export page.</p>

    <h2>Data-quality checks</h2>
    <ul>${QUALITY_CHECKS.map((q) => `<li><strong>${esc(q.label)}</strong> (${esc(q.unit)}): ${esc(q.description)}</li>`).join('')}</ul>

    <h2>Duplicate detection</h2>
    <p><strong>Organisations</strong>: normalised name — lower-case, accents and punctuation removed, “&amp;” → “and”, common abbreviations expanded (Univ. → university, St → saint, Intl → international, Fdn → foundation…), the words “the”, “of”, “and” dropped — and/or normalised domain (protocol, <code>www.</code>, port, path and case removed). <strong>Contacts</strong>: same email (trimmed, case-insensitive) or same first + last name at the same organisation. Candidates are never merged automatically.</p>

    <h2>Limitations</h2>
    <ul>
      <li>All sample data is synthetic and illustrative; the rates it produces are not benchmarks.</li>
      <li>Single-user, single-browser: no accounts, sync or audit trail beyond the local change log.</li>
      <li>Name matching is exact after normalisation — no fuzzy/typo matching, and word order matters.</li>
      <li>Email validation is a syntax check only; it cannot tell whether a mailbox exists.</li>
      <li>The app never sends email or contacts anyone; “activities” are manual log entries.</li>
    </ul>
  </div>`;
}
