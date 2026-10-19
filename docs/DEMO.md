# 2-minute demo script

Setup: serve the folder (`python3 -m http.server 8000`) and open http://localhost:8000, or use the live demo. The synthetic sample loads automatically, with the as-of date set to **16 Oct 2026**.

| Time | Do | Say |
|---|---|---|
| 0:00 | Dashboard | "This is a sample CRM for institutional outreach: 100 fictional prospects, clearly labelled synthetic. It never sends anything; activities are logged by hand." |
| 0:15 | Point at the funnel rate cards | "Every rate shows its numerator and denominator. Reply rate is 38 ÷ 84 *contacted*, not ÷ 100 prospects. Divide-by-zero shows n/a, not 0%." |
| 0:30 | Change **Owner** to Priya | "Every chart and rate re-scopes to her leads." Then reset it to All owners. |
| 0:40 | Click **Overdue follow-ups** (30) | "That drills into the Leads list filtered to overdue follow-ups." |
| 0:50 | Open a lead. Change the stage to *Meeting booked*, click **+7 days**, then **Save**. Log a call. | "Status, priority, owner, next action and follow-up are all editable. Logging an activity only adds a record." |
| 1:05 | Back to the Dashboard | "Meetings went from 14 to 15 — metrics are computed live from the data." |
| 1:15 | **Data quality** → **Preview clean-up** → **Apply** | "Whitespace, email case, `https://www.` domains and day-first dates get fixed. I see every change before it's applied, and nothing is guessed." |
| 1:30 | Merge the *Univ. of Eastmoor* pair | "Duplicates are matched on normalised name and domain, with the reason shown. A merge moves contacts and activities and combines the two leads." |
| 1:45 | **Import / Export** → **Try the example file** | "Import is validated first: 5 rows ready, 3 rejected with line numbers, 1 flagged as an existing organisation." Click **Import**. |
| 1:55 | Set the as-of date to 31 Dec 2026 → Dashboard | "Overdue is relative to a configurable today, so the demo stays reproducible." |

To reset afterwards: **Import / Export → Load sample data**.
