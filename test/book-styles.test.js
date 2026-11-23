'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {compile, clean, processEnvironment} = require('../src/compiler');
const {documentStyleId} = require('../src/document-styles');

const styles = [['book','book'], ['komabook','scrbook'], ['komareport','scrreprt'], ['memoir','memoir'], ['classicthesis','scrbook'], ['tufte','tufte-book']];

test('book and dissertation styles are selectable', () => {
  for (const [id] of styles) assert.equal(documentStyleId(id), id);
});

test('book styles render and export the full example paper', {skip:!process.env.SCHOLAR_TEST_PANDOC, timeout:240000}, async t => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join(__dirname, '..');
  const resourceId = '1234567890abcdef1234567890abcdef';
  const body = (await fs.readFile(path.join(root, 'examples/joplin-scholar-example.md'), 'utf8')).replace('(example-workflow.png)', `(:/${resourceId})`);
  const note = {id:'book-example', title:'Book example', body};
  const data = {resourcePath:async()=>path.join(root, 'examples/example-workflow.png')};
  const options = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:process.env.SCHOLAR_TEST_ENGINE || '/Library/TeX/texbin/xelatex'};
  for (const [id, cls] of styles) await t.test(id, {timeout:60000}, async t => {
    try {
      execFileSync('kpsewhich', [`${cls}.cls`], {env:processEnvironment(), stdio:'ignore'});
      if (id === 'classicthesis') execFileSync('kpsewhich', ['classicthesis.sty'], {env:processEnvironment(), stdio:'ignore'});
    } catch (_) { return t.skip(`TeX files for ${id} are not installed.`); }
    let pdf, tex;
    try {
      pdf = await compile(note, data, {...options, documentStyle:id}, 'pdf');
      tex = await compile(note, data, {...options, documentStyle:id}, 'tex');
      const latex = tex.output.toString();
      assert.match(latex, new RegExp(`\\\\documentclass\\[[\\s\\S]*?\\]\\{${cls}\\}`));
      assert.match(latex, /\\chapter\{/);
      if (id === 'classicthesis') assert.match(latex, /\\usepackage\[palatino=false,beramono=false\]\{classicthesis\}/);
      const doc = await pdfjs.getDocument({data:new Uint8Array(pdf.output), disableFontFace:true}).promise;
      let text = '';
      for (let page=1; page<=doc.numPages; page++) text += (await (await doc.getPage(page)).getTextContent()).items.map(item=>item.str).join(' ')+'\n';
      await doc.destroy();
      for (const expected of ['Alice Example', 'Benjamin Sample', 'Example University', 'alice@example.org', 'Joplin Scholar brings', 'A compact writing workflow', 'A practical workflow', 'References']) {
        assert.ok(text.includes(expected), `${id} PDF is missing ${expected}`);
      }
    } finally { await clean(pdf); await clean(tex); }
  });
});

test('book class options do not leak into an explicitly overridden document class', {skip:!process.env.SCHOLAR_TEST_PANDOC}, async () => {
  let tex;
  try {
    tex = await compile({id:'override', title:'Override', body:'---\ndocumentclass: article\n---\n\n# Introduction\nText.'}, {}, {pandoc:process.env.SCHOLAR_TEST_PANDOC, documentStyle:'tufte'}, 'tex');
    const latex = tex.output.toString();
    assert.match(latex, /\\documentclass\[[\s\S]*?\]\{article\}/);
    assert.doesNotMatch(latex, /\bnols\b|\bnobib\b|\\chapter\{/);
  } finally { await clean(tex); }
});
