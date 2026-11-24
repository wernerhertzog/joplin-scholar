'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {compile,clean} = require('../src/compiler');
const {normalizeDocumentOptions} = require('../src/document-options');
const {authorCommands} = require('../src/publisher-styles');

test('validates document options and generates each corresponding author for publisher styles', () => {
  assert.equal(normalizeDocumentOptions().lineNumbers, 'default');
  assert.throws(() => normalizeDocumentOptions({paperSize:'huge'}), /paperSize/);
  const authors = [{name:'Alice',email:'alice@example.org',corresponding:true},{name:'Bob',email:'bob@example.org',corresponding:true}];
  for (const style of ['apa7','elsevier','ieee','acm','revtex','springer']) {
    if (style === 'ieee') continue; // IEEE uses the normal author renderer.
    const output = authorCommands(style, authors);
    assert.match(output, /alice@example.org/, style);
    assert.match(output, /bob@example.org/, style);
  }
});

test('reports settings that publisher classes control', {skip:!process.env.SCHOLAR_TEST_PANDOC}, async () => {
  const note={id:'n',title:'Publisher',body:'Text'};
  const base={pandoc:process.env.SCHOLAR_TEST_PANDOC};
  await assert.rejects(compile(note,{}, {...base,documentStyle:'apa7',documentOptions:{affiliations:'end'}},'tex'), /Affiliation placement is controlled/);
  await assert.rejects(compile(note,{}, {...base,documentStyle:'acm',documentOptions:{spacing:'double'}},'tex'), /ACM class controls line spacing/);
});

test('document options render in PDF and LaTeX and respect YAML overrides', {skip:!process.env.SCHOLAR_TEST_PANDOC, timeout:90000}, async () => {
  const base = {pandoc:process.env.SCHOLAR_TEST_PANDOC,engine:process.env.SCHOLAR_TEST_ENGINE || '/Library/TeX/texbin/xelatex',documentStyle:'article'};
  const value = {lineNumbers:'on',affiliations:'end',spacing:'double',sections:'on',paperSize:'a4'};
  const body = '---\nauthor:\n  - name: Alice\n    affiliation: Shared University\n    corresponding: true\n    email: alice@example.org\n  - name: Bob\n    affiliation: Shared University\n    corresponding: true\n    email: bob@example.org\nbibliography: []\nreferences:\n  - id: test\n    type: article-journal\n    title: A cited paper\n    author:\n      - family: Example\n    issued:\n      date-parts: [[2020]]\n---\n\n# Abstract\n\nThe abstract.\n\n# Introduction\n\nSome text [@test].\n\n# References\n';
  let pdf, tex, overridden;
  try {
    const note={id:'n',title:'Options test',body};
    pdf=await compile(note,{}, {...base, documentOptions:value},'pdf');
    tex=await compile(note,{}, {...base, documentOptions:value},'tex');
    const latex=tex.output.toString();
    assert.match(latex, /\\usepackage\{lineno\}/);
    assert.match(latex, /\\setstretch\{2\}/);
    assert.match(latex, /\\setcounter\{secnumdepth\}\{5\}/);
    assert.match(latex, /a4paper/);
    assert.ok(latex.indexOf('Author affiliations') > latex.indexOf('A cited paper'));
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc=await pdfjs.getDocument({data:new Uint8Array(pdf.output),disableFontFace:true}).promise;
    const first=await doc.getPage(1);
    assert.ok(Math.abs(first.view[2] - 595.28) < 2, `expected A4 width, got ${first.view[2]}`);
    let text='';
    for(let i=1;i<=doc.numPages;i++) text+=(await(await doc.getPage(i)).getTextContent()).items.map(item=>item.str).join(' ')+'\n';
    await doc.destroy();
    for(const expected of ['alice@example.org','bob@example.org','Shared University','Author affiliations','A cited paper']) assert.ok(text.toLowerCase().includes(expected.toLowerCase()),`Missing ${expected}`);
    assert.ok(text.toLowerCase().indexOf('author affiliations') > text.toLowerCase().indexOf('a cited paper'));
    const overrideBody='---\nlinestretch: 1\nnumbersections: false\npapersize: letter\n---\n\n# Introduction\nText';
    overridden=await compile({id:'n',title:'Override',body:overrideBody},{},{...base,documentOptions:value},'tex');
    const o=overridden.output.toString();
    assert.match(o, /\\setstretch\{1\}/);
    assert.match(o, /\\setcounter\{secnumdepth\}\{-\\maxdimen\}/);
    assert.match(o, /letterpaper/);
  } finally { await clean(pdf); await clean(tex); await clean(overridden); }
});
