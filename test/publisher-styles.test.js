'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {compile, clean, exportResult, processEnvironment} = require('../src/compiler');
const {documentStyles, documentStyleId} = require('../src/document-styles');
const {extractAbstract, ieeeTables} = require('../src/publisher-styles');

test('publisher styles are selectable and preserve abstract blocks', () => {
  for (const id of ['koma','apa7','elsevier','ieee','acm','revtex','springer']) assert.equal(documentStyleId(id), id);
  assert.ok(!Object.keys(documentStyles).some(id => /texmacs/i.test(id)));
  const document = {meta:{}, blocks:[{t:'RawBlock',c:['latex','\\begin{abstract}']},{t:'Para',c:[{t:'Str',c:'Abstract'}]},{t:'RawBlock',c:['latex','\\end{abstract}']},{t:'Para',c:[{t:'Str',c:'Body'}]}]};
  extractAbstract(document);
  assert.equal(document.meta.abstract.c[0].c[0].c, 'Abstract');
  assert.equal(document.blocks[0].c[0].c, 'Body');
  assert.throws(()=>ieeeTables({blocks:[{t:'BlockQuote',c:[{t:'Table',c:[]}]}]}), /outside lists/);
});

test('publisher templates retain the example paper and export self-contained LaTeX', {skip:!process.env.SCHOLAR_TEST_PANDOC, timeout:180000}, async t => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = path.join(__dirname,'..');
  const resourceId = '1234567890abcdef1234567890abcdef';
  const body = (await fs.readFile(path.join(root,'examples/joplin-scholar-example.md'),'utf8')).replace('(example-workflow.png)', `(:/${resourceId})`).replace(/^---\n/, '---\nsubtitle: A sample subtitle\n').replace('name: Benjamin Sample\n    affiliation: Example University', 'name: Benjamin Sample\n    affiliation: Example University\n    corresponding: true\n    email: ben@example.org');
  const note = {id:'example', title:'Writing a Paper with Joplin Scholar', body};
  const data = {resourcePath:async()=>path.join(root,'examples/example-workflow.png')};
  const engine = process.env.SCHOLAR_TEST_ENGINE || '/Library/TeX/texbin/xelatex';
  const options = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine, springerClass:process.env.SCHOLAR_TEST_SPRINGER_CLASS || ''};
  const targets = [['koma','scrartcl'],['apa7','apa7'],['elsevier','elsarticle'],['ieee','IEEEtran'],['acm','acmart'],['revtex','revtex4-2'],['springer','sn-jnl']];
  for (const [id, cls] of targets) await t.test(id, {timeout:60000}, async t => {
    if (id === 'springer' && !options.springerClass) return t.skip('Set SCHOLAR_TEST_SPRINGER_CLASS to the official sn-jnl.cls.');
    if (id !== 'springer') {
      try { execFileSync('kpsewhich',[`${cls}.cls`],{env:processEnvironment(),stdio:'ignore'}); }
      catch (_) { return t.skip(`${cls}.cls is not installed.`); }
    }
    let pdf, tex, exported, outdir;
    try {
      pdf = await compile(note,data,{...options,documentStyle:id},'pdf');
      tex = await compile(note,data,{...options,documentStyle:id},'tex');
      assert.match(tex.output.toString(), new RegExp(`\\\\documentclass\\[[\\s\\S]*?\\]\\{${cls}\\}`));
      assert.match(tex.output.toString(), /\\includegraphics/);
      const doc = await pdfjs.getDocument({data:new Uint8Array(pdf.output),disableFontFace:true}).promise;
      let text = '';
      for (let page = 1; page <= doc.numPages; page++) text += (await (await doc.getPage(page)).getTextContent()).items.map(item=>item.str).join(' ')+'\n';
      await doc.destroy();
      for (const expected of ['A sample subtitle','Alice Example','Benjamin Sample','Example University','Centre for Open Scholarship','alice@example.org','ben@example.org','Joplin Scholar brings','A compact writing workflow','A practical workflow','References']) {
        assert.ok(text.includes(expected), `${id} PDF is missing ${expected}`);
      }
      outdir = await fs.mkdtemp(path.join(os.tmpdir(),'scholar-style-export-'));
      exported = await exportResult(tex,outdir);
      assert.ok((await fs.stat(path.join(path.dirname(exported),'assets',`${resourceId}.png`))).isFile());
      if (id === 'springer') {
        assert.ok((await fs.stat(path.join(path.dirname(exported),'sn-jnl.cls'))).isFile());
        execFileSync(engine,['-interaction=nonstopmode','-halt-on-error',path.basename(exported)],{cwd:path.dirname(exported),env:processEnvironment(),timeout:60000,stdio:'ignore'});
      }
    } finally { await clean(pdf); await clean(tex); if (outdir) await fs.rm(outdir,{recursive:true,force:true}); }
  });
});

test('APA draft without an author and explicit document-class overrides work', {skip:!process.env.SCHOLAR_TEST_PANDOC, timeout:60000}, async t => {
  try { execFileSync('kpsewhich',['apa7.cls'],{env:processEnvironment(),stdio:'ignore'}); } catch (_) { return t.skip('apa7.cls is not installed.'); }
  const options = {pandoc:process.env.SCHOLAR_TEST_PANDOC,engine:process.env.SCHOLAR_TEST_ENGINE || '/Library/TeX/texbin/xelatex'};
  let pdf, tex;
  try {
    pdf = await compile({id:'n',title:'A draft',body:'Some text.'},{},{...options,documentStyle:'apa7'},'pdf');
    assert.equal(pdf.output.subarray(0,5).toString(),'%PDF-');
    tex = await compile({id:'n',title:'Override',body:'---\ndocumentclass: report\nauthor: Alice\n---\n\n# Chapter\nText.'},{},{...options,documentStyle:'acm'},'tex');
    assert.match(tex.output.toString(), /\\documentclass\[[\s\S]*?\]\{report\}/);
    assert.doesNotMatch(tex.output.toString(), /\\acmConference/);
    assert.doesNotMatch(tex.output.toString(), /nonacm|manuscript/);
  } finally { await clean(pdf); await clean(tex); }
});

test('reports an unreadable Springer class file', {skip:!process.env.SCHOLAR_TEST_PANDOC}, async () => {
  await assert.rejects(compile({id:'n',title:'Test',body:'Text'}, {}, {pandoc:process.env.SCHOLAR_TEST_PANDOC,documentStyle:'springer',springerClass:'/missing/sn-jnl.cls'},'tex'), /Could not read the Springer Nature class file/);
});
