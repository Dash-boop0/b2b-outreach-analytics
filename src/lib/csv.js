// RFC 4180 CSV parser and serializer. Handles quoted fields, escaped quotes,
// commas and newlines inside quotes, CRLF/LF/CR line endings and a leading BOM.
// Pure functions, no DOM.

/**
 * Parse CSV text into an array of rows (arrays of strings).
 * Throws an Error with a line number if a quoted field is never closed.
 */
export function parseCSV(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be text');
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoteStartLine = 0;
  let line = 1;
  let i = 0;
  const n = s.length;
  let fieldStarted = false; // distinguishes "" (empty line) from a row with one empty field

  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (c === '\n') line += 1;
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      quoteStartLine = line;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (fieldStarted || field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
      fieldStarted = false;
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      i += 1;
      line += 1;
      continue;
    }
    field += c;
    fieldStarted = true;
    i += 1;
  }
  if (inQuotes) {
    throw new Error(`Unclosed quoted field starting on line ${quoteStartLine}`);
  }
  if (fieldStarted || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse CSV with a header row into objects keyed by normalised header
 * (trimmed, lower-case, spaces -> underscores). Blank rows are skipped.
 * Returns { headers, records } where each record has a `_line` (1-based line of the row in the file).
 * By default the apostrophe added by protectCell() on export is removed again ("'=x" → "=x"), so
 * exported files re-import losslessly.
 */
export function parseCSVObjects(text, { unprotect = true } = {}) {
  const rows = parseCSV(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map(normaliseHeader);
  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const obj = { _line: r + 1 };
    headers.forEach((h, idx) => {
      if (h) obj[h] = unprotect ? unprotectCell(cells[idx] ?? '') : cells[idx] ?? '';
    });
    records.push(obj);
  }
  return { headers, records };
}

export function normaliseHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Protect against CSV/formula injection when the file is opened in a spreadsheet. */
export function protectCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Reverse protectCell(): strip one leading apostrophe that precedes = + - @. */
export function unprotectCell(value) {
  const s = String(value ?? '');
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

function quoteCell(value) {
  const s = protectCell(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize an array of rows to CSV with CRLF line endings (RFC 4180). */
export function toCSV(rows) {
  return rows.map((r) => r.map(quoteCell).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Serialize objects using the given column list ([{key, header}] or string keys). */
export function objectsToCSV(objects, columns) {
  const cols = columns.map((c) => (typeof c === 'string' ? { key: c, header: c } : c));
  const rows = [cols.map((c) => c.header)];
  for (const o of objects) rows.push(cols.map((c) => o[c.key]));
  return toCSV(rows);
}
