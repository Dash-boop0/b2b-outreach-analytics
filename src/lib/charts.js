// Hand-drawn SVG chart builders. Return markup strings (no DOM access) so they are testable in Node.
// Colours come from CSS custom properties (--s1 … --s6, --muted, --border, --text) so charts follow dark mode.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A "nice" axis maximum and tick step (1/2/5 × 10^k) for roughly `ticks` intervals. */
export function niceScale(maxValue, ticks = 4) {
  if (!(maxValue > 0)) return { max: 1, step: 1 };
  const raw = maxValue / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const finalStep = Math.max(step, 1);
  return { max: Math.ceil(maxValue / finalStep) * finalStep, step: finalStep };
}

function truncate(s, maxChars) {
  const t = String(s ?? '');
  return t.length > maxChars ? `${t.slice(0, Math.max(1, maxChars - 1))}…` : t;
}

let uid = 0;
function header(id, title, desc, w, h) {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="${id}-t ${id}-d" xmlns="http://www.w3.org/2000/svg">`
    + `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>`;
}

/** HTML legend for a list of {name, color, kind?:'line'} series. */
export function legendHTML(series) {
  return `<ul class="legend">${series
    .map((s) => `<li><span class="swatch${s.kind === 'line' ? ' swatch-line' : ''}" style="background:${esc(s.color)}"></span>${esc(s.name)}</li>`)
    .join('')}</ul>`;
}

/**
 * Stacked columns with an optional overlaid line (shares the y axis).
 * opts: { title, desc, width, height, categories:[str], series:[{name,color,values}], line?:{name,color,values} }
 */
export function stackedColumns(opts) {
  const { title, desc = '', categories = [], series = [], line = null } = opts;
  const W = Math.max(280, Math.round(opts.width ?? 640));
  const H = opts.height ?? 240;
  const m = { l: 34, r: 10, t: 12, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const id = `ch${(uid += 1)}`;
  const totals = categories.map((_, i) => series.reduce((s, se) => s + (se.values[i] || 0), 0));
  const maxV = Math.max(0, ...totals, ...(line ? line.values.map((v) => v || 0) : []));
  const { max, step } = niceScale(maxV);
  const y = (v) => m.t + ph - (v / max) * ph;
  const n = Math.max(categories.length, 1);
  const slot = pw / n;
  const bw = Math.max(4, Math.min(36, slot * 0.62));
  let out = header(id, title, desc, W, H);
  for (let v = 0; v <= max + 1e-9; v += step) {
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" style="stroke:var(--grid)" />`;
    out += `<text x="${m.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="axis">${v}</text>`;
  }
  const every = Math.max(1, Math.ceil(44 / slot));
  categories.forEach((c, i) => {
    const cx = m.l + slot * i + slot / 2;
    let acc = 0;
    series.forEach((se) => {
      const v = se.values[i] || 0;
      if (v <= 0) return;
      const y0 = y(acc);
      const y1 = y(acc + v);
      out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" style="fill:${se.color}"><title>${esc(`${c}: ${se.name} ${v}`)}</title></rect>`;
      acc += v;
    });
    if (i % every === 0) out += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(c)}</text>`;
  });
  if (line && categories.length) {
    const pts = line.values.map((v, i) => [m.l + slot * i + slot / 2, y(v || 0)]);
    out += `<polyline fill="none" points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" style="stroke:${line.color};stroke-width:2.5" />`;
    pts.forEach((p, i) => {
      out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" style="fill:${line.color};stroke:var(--surface);stroke-width:1.5"><title>${esc(`${categories[i]}: ${line.name} ${line.values[i] || 0}`)}</title></circle>`;
    });
  }
  out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" style="stroke:var(--axis)" />`;
  return `${out}</svg>`;
}

/**
 * Horizontal bars, one per item. opts: { title, desc, width, items:[{label,value,color?,note?}], format?:fn }
 */
export function horizontalBars(opts) {
  const { title, desc = '', items = [], format = (v) => String(v) } = opts;
  const W = Math.max(280, Math.round(opts.width ?? 560));
  const rowH = 30;
  const labelW = Math.min(170, Math.round(W * 0.42));
  const m = { t: 6, b: 6, r: 44 };
  const H = m.t + m.b + Math.max(1, items.length) * rowH;
  const id = `ch${(uid += 1)}`;
  const maxV = Math.max(0, ...items.map((i) => i.value || 0));
  const { max } = niceScale(maxV);
  const pw = W - labelW - m.r - 8;
  const maxChars = Math.floor(labelW / 7);
  let out = header(id, title, desc, W, H);
  items.forEach((it, i) => {
    const yy = m.t + i * rowH;
    const w = ((it.value || 0) / max) * pw;
    out += `<text x="${labelW}" y="${yy + rowH / 2 + 4}" text-anchor="end" class="label">${esc(truncate(it.label, maxChars))}</text>`;
    out += `<rect x="${labelW + 8}" y="${yy + 6}" width="${pw.toFixed(1)}" height="${rowH - 12}" rx="3" style="fill:var(--track)" />`;
    if (w > 0) out += `<rect x="${labelW + 8}" y="${yy + 6}" width="${Math.max(2, w).toFixed(1)}" height="${rowH - 12}" rx="3" style="fill:${it.color ?? 'var(--s1)'}"><title>${esc(`${it.label}: ${format(it.value)}${it.note ? ` (${it.note})` : ''}`)}</title></rect>`;
    out += `<text x="${(labelW + 8 + Math.max(2, w) + 6).toFixed(1)}" y="${yy + rowH / 2 + 4}" class="value">${esc(format(it.value))}</text>`;
  });
  if (!items.length) out += `<text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" class="axis">No data</text>`;
  return `${out}</svg>`;
}

/**
 * Horizontal stacked bars. opts: { title, desc, width, categories:[label], series:[{name,color,values}] }
 */
export function stackedBars(opts) {
  const { title, desc = '', categories = [], series = [] } = opts;
  const W = Math.max(280, Math.round(opts.width ?? 560));
  const rowH = 32;
  const labelW = Math.min(130, Math.round(W * 0.32));
  const m = { t: 6, b: 6, r: 40 };
  const H = m.t + m.b + Math.max(1, categories.length) * rowH;
  const id = `ch${(uid += 1)}`;
  const totals = categories.map((_, i) => series.reduce((s, se) => s + (se.values[i] || 0), 0));
  const { max } = niceScale(Math.max(0, ...totals));
  const pw = W - labelW - m.r - 8;
  let out = header(id, title, desc, W, H);
  categories.forEach((c, i) => {
    const yy = m.t + i * rowH;
    out += `<text x="${labelW}" y="${yy + rowH / 2 + 4}" text-anchor="end" class="label">${esc(truncate(c, Math.floor(labelW / 7)))}</text>`;
    let x = labelW + 8;
    series.forEach((se) => {
      const v = se.values[i] || 0;
      if (v <= 0) return;
      const w = (v / max) * pw;
      out += `<rect x="${x.toFixed(1)}" y="${yy + 6}" width="${w.toFixed(1)}" height="${rowH - 12}" style="fill:${se.color};stroke:var(--surface);stroke-width:1"><title>${esc(`${c}: ${se.name} ${v}`)}</title></rect>`;
      x += w;
    });
    out += `<text x="${(x + 6).toFixed(1)}" y="${yy + rowH / 2 + 4}" class="value">${totals[i]}</text>`;
  });
  return `${out}</svg>`;
}

/** Accessible data table fallback. columns: [{key,label,num?}] */
export function dataTable(caption, columns, rows) {
  return `<div class="table-wrap"><table class="data"><caption>${esc(caption)}</caption><thead><tr>${columns
    .map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${columns.map((c) => `<td${c.num ? ' class="num"' : ''}>${esc(r[c.key])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}
