'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tableMarkdown } = require('../src/insert-tools');

test('builds a captioned table from the chosen cells and escapes pipes', () => {
  assert.equal(tableMarkdown([['Group','Value'],['A|B','10']], 'Observations'), '| Group | Value |\n| --- | --- |\n| A\\|B | 10 |\n\nTable: Observations');
  assert.throws(() => tableMarkdown([['one']], ''), /rows/);
});
