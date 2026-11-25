'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {compile, clean} = require('../src/compiler');
const {hasCrossReferences, transformCrossReferences} = require('../src/cross-references');
const {targetList} = require('../src/citation-targets');

const pandoc = process.env.SCHOLAR_TEST_PANDOC;
const parse = markdown => JSON.parse(execFileSync(pandoc, ['-f','markdown+tex_math_single_backslash','-t','json'], {input:markdown, encoding:'utf8'}));
async function textOf(pdf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({data:new Uint8Array(pdf), disableFontFace:true}).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(item => item.str).join(''));
  await doc.destroy();
  return pages.join(' ').replace(/\s+/g, ' ');
}

test('reference detection does not make ordinary citations cross-references', () => {
  assert.equal(hasCrossReferences(String.raw`See \@ref(fig:plot).`), true);
  assert.equal(hasCrossReferences('See [@smith2024].'), false);
});

test('preserves code and citations, and validates labels and numbered headings', {skip:!pandoc}, () => {
  const input = String.raw`# Results {#sec:results}

![First](figure.png){#fig:first}

See Figure \@ref(fig:first), Section \@ref(sec:results), and [@smith2024].

Literal: ` + '`\\@ref(fig:missing)`' + String.raw`

` + '```markdown\n\\@ref(tab:missing)\n```' + '\n';
  const doc = transformCrossReferences(parse(input), {sectionsNumbered:true});
  const serialized = JSON.stringify(doc);
  assert.match(serialized, /\\\\ref\{fig:first\}/);
  assert.match(serialized, /\\\\ref\{sec:results\}/);
  assert.match(serialized, /smith2024/);
  assert.match(serialized, /@ref\(fig:missing\)/);
  assert.match(serialized, /@ref\(tab:missing\)/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`See \@ref(fig:missing).`)), /no matching labelled figure/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`See \@ref(fig:bad!).`)), /Invalid figure label/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`# Results {#sec:results}

See \@ref(sec:results).`)), /unnumbered heading/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`# Results {#sec:results .unnumbered}

See \@ref(sec:results).`), {sectionsNumbered:true}), /unnumbered heading/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`### Details {#sec:details}

See \@ref(sec:details).`), {sectionsNumbered:true,sectionDepth:2}), /numbering depth/);
  assert.throws(()=>transformCrossReferences(parse(String.raw`![One](a.png){#fig:repeated}

![Two](b.png){#fig:repeated}

See \@ref(fig:repeated).`)), /Duplicate figure label/);
});

test('section numbering follows Document options and explicit YAML precedence', {skip:!pandoc}, async () => {
  const body = String.raw`# Results {#sec:results}

See Section \@ref(sec:results).`;
  const note = {id:'section',title:'Section',body};
  const opts = {pandoc, documentOptions:{sections:'on'}};
  let tex;
  try {
    tex = await compile(note, {}, opts, 'tex');
    assert.match(tex.output.toString(), /\\ref\{sec:results\}/);
    await assert.rejects(compile({...note,body:'---\nnumbersections: false\n---\n\n'+body}, {}, opts, 'tex'), /unnumbered heading/);
    await assert.rejects(compile(note, {}, {pandoc,documentOptions:{sections:'off'}}, 'tex'), /unnumbered heading/);
  } finally { await clean(tex); }
});

test('picker-generated references resolve existing IDs and add labels and captions safely', {skip:!pandoc}, async () => {
  const id='1234567890abcdef1234567890abcdef';
  let body=`---\nnumbersections: true\n---\n\n# Analysis {#existing-heading}\n\n![](:/${id})\n\n| Name | Value |\n|---|---|\n| x | 1 |\n\nReferences: `;
  for (const kind of ['sec','fig','tab']) {
    const target=targetList(body).find(value=>value.kind===kind);
    assert.ok(target,`Missing ${kind}`);
    const reference=`${{sec:'Section',fig:'Figure',tab:'Table'}[kind]} \\@ref(${target.refId}) `;
    if (target.change) body=body.slice(0,target.change.from)+target.change.insert+body.slice(target.change.to);
    body+=reference;
  }
  assert.match(body,/\{#existing-heading\}/);
  const data={resourcePath:async()=>path.join(__dirname,'figure.png')};
  let pdf;
  try {
    pdf=await compile({id:'picker',title:'Picker',body},data,{pandoc,engine:'/Library/TeX/texbin/xelatex'},'pdf');
    assert.match(await textOf(pdf.output),/References: Section 1 Figure 1 Table 1/);
  } finally { await clean(pdf); }
});

test('PDF and LaTeX references follow reordered figures, tables and sections', {skip:!pandoc}, async () => {
  const imageId = '1234567890abcdef1234567890abcdef';
  const body = String.raw`---
numbersections: true
---

# First section

![First figure](:/1234567890abcdef1234567890abcdef){#fig:first}

| Value |
|:------|
| 1 |

Table: First table {#tab:first}

# Results {#sec:results}

We refer to Figure \@ref(fig:target), Table \@ref(tab:target), and Section \@ref(sec:results).

![Target figure](:/1234567890abcdef1234567890abcdef){#fig:target}

| Value |
|:------|
| 2 |

Table: Target table {#tab:target}
`;
  const data = {resourcePath:async id => {assert.equal(id, imageId); return path.join(__dirname, 'figure.png');}};
  const opts = {pandoc, engine:'/Library/TeX/texbin/xelatex', bibliographySource:'auto'};
  let tex, pdf;
  try {
    tex = await compile({id:'xref',title:'Cross references',body}, data, opts, 'tex');
    const source = tex.output.toString();
    for (const label of ['fig:target','tab:target','sec:results']) {
      assert.ok(source.includes(`\\label{${label}}`), `Missing target ${label}`);
      assert.ok(source.includes(`\\ref{${label}}`), `Missing reference ${label}`);
    }
    pdf = await compile({id:'xref',title:'Cross references',body}, data, opts, 'pdf');
    assert.match(await textOf(pdf.output), /refer to Figure 2, Table 2, and Section 2\./);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({data:new Uint8Array(pdf.output)}).promise;
    try {
      const links = [];
      for (let i=1; i<=doc.numPages; i++) links.push(...(await (await doc.getPage(i)).getAnnotations()).filter(annotation=>annotation.subtype==='Link' && typeof annotation.dest==='string'));
      for (const kind of ['figure','table','section']) {
        const link = links.find(annotation=>annotation.dest.startsWith(`${kind}.`));
        assert.ok(link, `Missing internal PDF link to ${kind}`);
        const destination = await doc.getDestination(link.dest);
        assert.ok(Array.isArray(destination), `Missing destination for ${kind}`);
        assert.ok((await doc.getPageIndex(destination[0])) >= 0, `Invalid target page for ${kind}`);
      }
    } finally { await doc.destroy(); }
    const reordered = body.replace(/!\[First figure\][^\n]+\n\n/, '').replace(/\| Value \|\n\|:------\|\n\| 1 \|\n\nTable: First table \{#tab:first\}\n\n/, '').replace('# First section\n\n', '');
    await clean(pdf); pdf = await compile({id:'xref',title:'Cross references',body:reordered}, data, opts, 'pdf');
    assert.match(await textOf(pdf.output), /refer to Figure 1, Table 1, and Section 1\./);
  } finally { await clean(tex); await clean(pdf); }
});
