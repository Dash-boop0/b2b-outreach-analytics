import test from 'node:test';
import assert from 'node:assert/strict';
import { niceScale, stackedColumns, horizontalBars, stackedBars, esc, dataTable, legendHTML } from '../src/lib/charts.js';

test('niceScale picks 1/2/5 steps and handles zero', () => {
  assert.deepEqual(niceScale(0), { max: 1, step: 1 });
  assert.deepEqual(niceScale(7), { max: 8, step: 2 });
  assert.deepEqual(niceScale(38), { max: 40, step: 10 });
  assert.deepEqual(niceScale(3), { max: 3, step: 1 });
});

test('charts are accessible SVG with escaped text', () => {
  const svg = horizontalBars({ title: 'A <b> & "c"', items: [{ label: '<script>', value: 3 }, { label: 'Zero', value: 0 }] });
  assert.match(svg, /^<svg[^>]+role="img"[^>]+aria-labelledby=/);
  assert.match(svg, /<title id="ch\d+-t">A &lt;b&gt; &amp; &quot;c&quot;<\/title>/);
  assert.ok(!svg.includes('<script>'));
  const col = stackedColumns({ title: 'T', categories: ['a', 'b'], series: [{ name: 'S', color: 'red', values: [1, 2] }], line: { name: 'L', color: 'blue', values: [0, 1] } });
  assert.equal((col.match(/<rect /g) || []).length, 2);
  assert.match(col, /<polyline/);
  const sb = stackedBars({ title: 'T', categories: ['x'], series: [{ name: 'a', color: 'red', values: [2] }, { name: 'b', color: 'blue', values: [0] }] });
  assert.equal((sb.match(/<rect /g) || []).length, 1);
  assert.match(horizontalBars({ title: 'E', items: [] }), /No data/);
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
  assert.match(dataTable('cap', [{ key: 'a', label: 'A', num: true }], [{ a: '<1>' }]), /<td class="num">&lt;1&gt;<\/td>/);
  assert.match(legendHTML([{ name: 'X', color: 'red', kind: 'line' }]), /swatch-line/);
});
