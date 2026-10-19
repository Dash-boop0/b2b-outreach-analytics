// Date helpers that work on ISO calendar dates ("YYYY-MM-DD") in UTC so results
// never shift with the viewer's time zone. Pure functions, no DOM.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function isValidISODate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Days since the Unix epoch for an ISO date, or NaN if invalid. */
export function toDayNumber(iso) {
  if (!isValidISODate(iso)) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** b - a in whole days. */
export function diffDays(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

/** Monday of the ISO week containing `iso`. */
export function startOfWeek(iso) {
  const n = toDayNumber(iso);
  // 1970-01-01 was a Thursday; (n + 3) % 7 gives 0 for Monday.
  const dow = ((n + 3) % 7 + 7) % 7;
  return fromDayNumber(n - dow);
}

/** Today's date in the viewer's local calendar as ISO. */
export function systemToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Oct 2026" style; returns '' for invalid input. */
export function formatDate(iso, { year = true } = {}) {
  if (!isValidISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return year ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/**
 * Accepts common spreadsheet date spellings and returns ISO, or null.
 * Supported: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY (day-first, documented).
 */
export function parseFlexibleDate(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (isValidISODate(v)) return v;
  let m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(v);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  return null;
}
