// Normalisation and validation helpers used by dedup, cleaning and import. Pure, no DOM.

const ABBREVIATIONS = {
  univ: 'university',
  uni: 'university',
  st: 'saint',
  intl: 'international',
  coll: 'college',
  sch: 'school',
  hosp: 'hospital',
  dept: 'department',
  ctr: 'centre',
  center: 'centre',
  assoc: 'association',
  fdn: 'foundation',
  cncl: 'council',
};

const DROP_WORDS = new Set(['the', 'of', 'and']);

/**
 * Normalised organisation name used as a duplicate key:
 * lower-case, accents removed, "&" -> "and", punctuation removed, common abbreviations expanded,
 * the words "the", "of", "and" dropped, whitespace collapsed.
 * "The Univ. of Northbridge" and "Northbridge University" do NOT match (word order is kept on purpose);
 * "Univ. of Northbridge" and "University of Northbridge" DO match.
 */
export function normalizeOrgName(name) {
  const base = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!base) return '';
  return base
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .filter((w) => !DROP_WORDS.has(w))
    .join(' ');
}

/**
 * Normalised domain: lower-case, protocol, "www.", credentials, port, path, query and trailing dot removed.
 * Also accepts an email address and returns its domain part.
 */
export function normalizeDomain(value) {
  let v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('@') && !v.includes('/')) v = v.slice(v.lastIndexOf('@') + 1);
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  v = v.replace(/^[^/@]*@/, '');
  v = v.split(/[/?#]/)[0];
  v = v.replace(/:\d+$/, '');
  v = v.replace(/^www\d?\./, '');
  v = v.replace(/\.+$/, '');
  return v;
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** Collapse internal whitespace and trim. */
export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Lower-cased "first last" for same-person checks. */
export function normalizePersonName(first, last) {
  return cleanText(`${first ?? ''} ${last ?? ''}`)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Pragmatic email syntax check (not full RFC 5322): one "@", non-empty local part without spaces,
 * domain with at least one dot, labels of letters/digits/hyphens, TLD of 2+ letters, no consecutive dots.
 */
export function isValidEmail(value) {
  const v = String(value ?? '').trim();
  if (!v || v.length > 254) return false;
  const at = v.indexOf('@');
  if (at <= 0 || at !== v.lastIndexOf('@')) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length > 64 || /\s/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return false;
  }
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const l of labels) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l)) return false;
  }
  return /^[A-Za-z]{2,}$/.test(labels[labels.length - 1]);
}

/** A domain looks valid if it has 2+ dot-separated labels and a letter TLD. */
export function isValidDomain(value) {
  const d = normalizeDomain(value);
  if (!d) return false;
  const labels = d.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) && /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}
