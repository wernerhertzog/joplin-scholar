'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {targetList} = require('../src/citation-targets');

test('finds ordered headings, captioned images, and tables without reading code or metadata', () => {
  const text = '---\ntitle: "# Not a heading"\n---\n\n# Introduction\n\n![Growth](:/123){width=80%}\n\n```md\n# Hidden\n![Not a figure](x.png)\n| X |\n|---|\n| 1 |\n```\n\n| Year | Count |\n|---|---|\n| 2024 | 1 |\n\nTable: Values\n\n## Results {#custom-results}\n';
  const targets = targetList(text);
  assert.deepEqual(targets.map(x=>[x.kind,x.title]), [['sec','Introduction'],['fig','Growth'],['tab','Values'],['sec','Results']]);
  assert.equal(targets[1].change.insert,' #fig:figure-1');
  assert.equal(targets[2].change.insert,' {#tab:table-1}');
  assert.equal(targets[3].refId,'sec-id:custom-results');
  assert.equal(targets[3].change,null);
});

test('reuses typed labels, avoids collisions and creates a caption for uncaptioned tables', () => {
  const text = '# Label {#sec:section-1}\n\n# Another\n\n![One](x){#fig:one}\n\n| A | B |\n|---|---|\n| x | y |\n';
  const targets = targetList(text);
  assert.equal(targets[1].label,'sec:section-2');
  assert.equal(targets[2].refId,'fig:one');
  assert.equal(targets[2].change,null);
  assert.equal(targets[3].addedCaption,true);
  assert.match(targets[3].change.insert, /Table: \{#tab:table-1\}/);
});

test('supports captions before tables and heading syntax without changing the note', () => {
  const text = 'Title\n=====\n\nTable: Before {#old-table}\n\n| A |\n|---|\n| x |\n\n## End ###\n';
  const targets = targetList(text);
  assert.deepEqual(targets.map(t=>t.kind),['sec','tab','sec']);
  assert.equal(targets[1].refId,'tab-id:old-table');
  const heading = targets[2];
  assert.equal(text.slice(heading.change.from,heading.change.from+4), ' ###');
});

test('offers uncaptioned images and labels them while preserving their existing attributes', () => {
  const text='![](image.png){width=80%}\n\nSee: ';
  const target=targetList(text)[0];
  assert.equal(target.addedFigureCaption,true);
  const next=text.slice(0,target.change.from)+target.change.insert+text.slice(target.change.to);
  assert.equal(next,'![Figure](image.png){width=80% #fig:figure-1}\n\nSee: ');
});
