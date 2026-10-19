import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVObjects, toCSV, protectCell, unprotectCell, objectsToCSV } from '../src/lib/csv.js';

test('parses simple rows with LF and CRLF line endings', () => {
  assert.deepEqual(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
});

test('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
  const rows = parseCSV('name,note\n"Smith, J","He said ""hi""\nnext line"\n');
  assert.deepEqual(rows, [['name', 'note'], ['Smith, J', 'He said "hi"\nnext line']]);
});

test('strips a UTF-8 BOM and keeps empty fields', () => {
  assert.deepEqual(parseCSV('﻿a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
  assert.deepEqual(parseCSV('a\n""\n'), [['a'], ['']]);
});

test('empty input gives no rows; unclosed quote throws with line number', () => {
  assert.deepEqual(parseCSV(''), []);
  assert.throws(() => parseCSV('a,b\n1,"oops\n2,3'), /line 2/);
});

test('parseCSVObjects normalises headers and skips blank rows', () => {
  const { headers, records } = parseCSVObjects('Organisation Name,Contact-Email\nAcme,x@example.org\n,\n\nBeta,\n');
  assert.deepEqual(headers, ['organisation_name', 'contact_email']);
  assert.equal(records.length, 2);
  assert.equal(records[0].organisation_name, 'Acme');
  assert.equal(records[1].contact_email, '');
  assert.equal(records[0]._line, 2);
});

test('serializer quotes when needed and protects against formula injection', () => {
  assert.equal(protectCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(protectCell('+44 7700'), "'+44 7700");
  assert.equal(protectCell('-1'), "'-1");
  assert.equal(protectCell('@cmd'), "'@cmd");
  assert.equal(protectCell('safe'), 'safe');
  assert.equal(toCSV([['a', 'b,c', 'say "x"', 'line\nbreak']]), 'a,"b,c","say ""x""","line\nbreak"\r\n');
  assert.equal(unprotectCell("'=SUM(A1)"), '=SUM(A1)');
  assert.equal(unprotectCell("'plain"), "'plain");
});

test('round trip: objects → CSV → objects is lossless (including protected cells)', () => {
  const objs = [{ a: '=1+1', b: 'x, "y"\nz', c: '' }, { a: '@home', b: '', c: 'ü' }];
  const csv = objectsToCSV(objs, ['a', 'b', 'c']);
  const { records } = parseCSVObjects(csv);
  assert.deepEqual(records.map(({ _line, ...r }) => r), objs);
});
