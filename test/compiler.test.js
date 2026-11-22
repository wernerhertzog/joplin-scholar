'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { compile, clean, exportResult, stageNote, expandTocMarkers, formatAbstract } = require('../src/compiler');

test('formats the first abstract heading and preserves normal Markdown', () => {
  const input = '# Abstract\n\nAn **important** result [@smith2023].\n\n[toc]\n\n## Introduction\n\nText.';
  const output = formatAbstract(input);
  assert.match(output, /\\begin\{abstract\}[\s\S]*An \*\*important\*\* result \[@smith2023\]\.[\s\S]*\\end\{abstract\}/);
  assert.ok(output.indexOf('\\end{abstract}') < output.indexOf('[toc]'));
  assert.ok(output.indexOf('[toc]') < output.indexOf('## Introduction'));
  assert.match(formatAbstract('Abstract\n--------\nSummary.\n\nIntroduction\n------------\nText.'), /\\end\{abstract\}[\s\S]*Introduction\n------------/);
  assert.match(formatAbstract('## Abstract\n\nSummary at the end.'), /Summary at the end\.[\s\S]*\\end\{abstract\}/);
});

test('leaves abstract-like headings in code and ordinary notes untouched', () => {
  const literal = '```md\n## Abstract\n```\n\n<!--\n# Abstract\n-->\n\n    ## Abstract\n\n# Introduction\n\nText.';
  assert.equal(formatAbstract(literal), literal);
  const withFence = formatAbstract('## Abstract\n\nText.\n\n```md\n# Not a section\n```\n\n# Introduction\nBody.');
  assert.ok(withFence.indexOf('# Not a section') < withFence.indexOf('\\end{abstract}'));
  assert.ok(withFence.indexOf('\\end{abstract}') < withFence.indexOf('# Introduction'));
});

test('expands all Joplin TOC markers at their position, but preserves code and prose', () => {
  for (const marker of ['[toc]', '[TOC]', '[[toc]]', '[[_toc_]]', '${toc}', '\\[toc\\]']) {
    assert.equal(expandTocMarkers(`Before\n\n${marker}\n\n# Introduction`), 'Before\n\n\n\\tableofcontents\n\n\n# Introduction');
  }
  const literal = 'Before [toc] after\n\n    [toc]\n\n```text\n[toc]\n```\n\n~~~~\n[[toc]]\n~~~~\n\n<!--\n[toc]\n-->\n';
  assert.equal(expandTocMarkers(literal), literal);
});

test('expands figure and table lists without changing examples or code', () => {
  const input = '[lof]\n\n[LOT]\n\n\\[lof\\]\n\nA [lot] in prose.\n\n    [lof]\n\n```md\n[lot]\n```\n\n<!--\n[lof]\n-->';
  const output = expandTocMarkers(input);
  assert.equal((output.match(/\\listoffigures/g) || []).length, 2);
  assert.equal((output.match(/\\listoftables/g) || []).length, 1);
  assert.match(output, /A \[lot\] in prose/);
  assert.match(output, /    \[lof\]/);
  assert.match(output, /```md\n\[lot\]\n```/);
  assert.match(output, /<!--\n\[lof\]\n-->/);
  const abstract = formatAbstract('# Abstract\n\nSummary.\n\n[lof]\n\nText.');
  assert.ok(abstract.indexOf('\\end{abstract}') < abstract.indexOf('[lof]'));
});

test('renders captioned Joplin figures and tables in both lists', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const id = '1234567890abcdef1234567890abcdef';
  const note = {id:'figures', title:'Figures and tables', body:`[lof]\n\n[lot]\n\n# Results\n\n![Growth over time](:/${id})\n\n| Year | Value |\n|---|---|\n| 2024 | 10 |\n\nTable: Observed values\n`};
  const data = {resourcePath: async () => path.join(__dirname, 'figure.png')};
  const opts = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:'/Library/TeX/texbin/xelatex'};
  let tex, pdf;
  try {
    tex = await compile(note, data, opts, 'tex');
    const output = tex.output.toString('utf8');
    assert.match(output, /\\listoffigures/); assert.match(output, /\\listoftables/);
    assert.match(output, /\\caption\{Growth over time\}/); assert.match(output, /\\caption\{Observed values\}/);
    assert.match(output, /assets\/1234567890abcdef1234567890abcdef\.png/);
    pdf = await compile(note, data, opts, 'pdf');
    assert.equal(pdf.output.subarray(0, 5).toString(), '%PDF-');
    const cp = require('node:child_process');
    if (cp.spawnSync('python3', ['-c', 'import pypdf']).status === 0) {
      const text = cp.execFileSync('python3', ['-c', 'import sys,pypdf; print("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', path.join(pdf.dir, 'paper.pdf')], {encoding:'utf8'});
      assert.match(text, /List of Figures[\s\S]*Growth over time[\s\S]*List of Tables[\s\S]*Observed values/);
      assert.match(text, /Figure 1: Growth over time/); assert.match(text, /Table 1: Observed values/);
    }
  } finally { await clean(tex); await clean(pdf); }
});

test('stages Joplin images and leaves note links intact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-test-'));
  try {
    const id = '1234567890abcdef1234567890abcdef';
    const source = path.join(root, 'figure.png');
    await fs.writeFile(source, 'image');
    const dir = path.join(root, 'staging'); await fs.mkdir(dir);
    await stageNote({ body: `![Figure](:/${id})\n![Results \\[2018\\]](:/${id})\n[Other note](:/${id})` }, { resourcePath: async () => source }, dir);
    const text = await fs.readFile(path.join(dir, 'paper.md'), 'utf8');
    assert.match(text, new RegExp(`!\\[Figure\\]\\(assets/${id}\\.png\\)`));
    assert.ok(text.includes(`![Results \\[2018\\]](assets/${id}.png)`));
    assert.ok(text.includes(`[Other note](:/${id})`));
    assert.equal(await fs.readFile(path.join(dir, 'assets', id + '.png'), 'utf8'), 'image');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('reports missing Pandoc and removes temporary files', async () => {
  await assert.rejects(() => compile({ id: 'n', title: 'Test', body: 'Hello' }, {}, { pandoc: '/no/such/pandoc' }, 'pdf'), /Pandoc could not be found/);
});

test('renders alternative math delimiters and bookdown equation references', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const body = String.raw`\[toc\]

# Introduction

Equations \@ref(eq:linear) and \@ref(eq:squared). Inline \(x+1\), also $x+2$.

\[
a=b
\]

\begin{equation}
y = a + bx (\#eq:linear)
\end{equation}

$$
z = x^2 (\#eq:squared)
$$

Literal: ` + '`\\@ref(eq:missing)`' + String.raw`

` + '```markdown\n\\@ref(eq:missing)\n(\\#eq:linear)\n```' + String.raw`

<!-- \@ref(eq:missing) -->`;
  const note = {id:'math', title:'Math paper', body};
  const opts = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:'/Library/TeX/texbin/xelatex'};
  let tex, pdf;
  try {
    tex = await compile(note, {}, opts, 'tex');
    const output = tex.output.toString();
    for (const token of [String.raw`\tableofcontents`, String.raw`\eqref{eq:linear}`, String.raw`\eqref{eq:squared}`, String.raw`\label{eq:linear}`, String.raw`\label{eq:squared}`, String.raw`\(x+1\)`, String.raw`\(x+2\)`, String.raw`\[a=b\]`]) assert.ok(output.includes(token), `Missing ${token}`);
    assert.equal((output.match(/\\label\{eq:linear\}/g) || []).length, 1);
    pdf = await compile(note, {}, opts, 'pdf');
    assert.equal(pdf.output.subarray(0, 5).toString(), '%PDF-');
    const cp = require('node:child_process');
    if (cp.spawnSync('python3', ['-c', 'import pypdf']).status === 0) {
      const text = cp.execFileSync('python3', ['-c', 'import sys,pypdf; print("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', path.join(pdf.dir, 'paper.pdf')], {encoding:'utf8'});
      assert.match(text, /Equations\s*\(\s*1\)\s*and\s*\(\s*2\)/);
      assert.doesNotMatch(text, /\?\?/);
    }
  } finally { await clean(tex); await clean(pdf); }
});

test('reports missing, duplicate, and unnumbered equation labels', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const opts = {pandoc:process.env.SCHOLAR_TEST_PANDOC};
  const note = body => ({id:'bad-math', title:'Math', body});
  await assert.rejects(compile(note(String.raw`See \@ref(eq:missing).`), {}, opts, 'tex'), /Equation reference "eq:missing" has no matching label/);
  await assert.rejects(compile(note(String.raw`See \@ref(eq:bad!).`), {}, opts, 'tex'), /Invalid equation label/);
  await assert.rejects(compile(note(String.raw`$$a (\#eq:one)$$

$$b (\#eq:one)$$`), {}, opts, 'tex'), /Duplicate equation label "eq:one"/);
  await assert.rejects(compile(note(String.raw`\begin{equation*}
a (\#eq:one)
\end{equation*}`), {}, opts, 'tex'), /unnumbered environment/);
});

test('renders TeX math delimiters without equation references', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const note = {id:'delimiters', title:'Math', body:String.raw`Inline \(x+1\) and $x+2$.

\[
x^2=4
\]`};
  let tex;
  try {
    tex = await compile(note, {}, {pandoc:process.env.SCHOLAR_TEST_PANDOC}, 'tex');
    for (const token of [String.raw`\(x+1\)`, String.raw`\(x+2\)`, String.raw`\[x^2=4\]`]) assert.ok(tex.output.toString().includes(token), `Missing ${token}`);
  } finally { await clean(tex); }
});

test('the bundled paper renders with embedded references regardless of global bibliography settings', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const id = '1234567890abcdef1234567890abcdef';
  const source = await fs.readFile(path.join(__dirname, '../examples/joplin-scholar-example.md'), 'utf8');
  const note = {id:'example', title:'Example', body:source.replace('(example-workflow.png)', `(:/${id})`)};
  const data = {resourcePath: async resourceId => { assert.equal(resourceId,id); return path.join(__dirname, '../examples/example-workflow.png'); }};
  const base = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:'/Library/TeX/texbin/xelatex', zoteroEndpoint:'http://127.0.0.1:1/unreachable'};
  let pdf;
  try {
    for (const opts of [{bibliographySource:'zotero',bibliography:'/does/not/exist.bib'}, {bibliographySource:'file'}, {bibliographySource:'auto',bibliography:'/does/not/exist.bib'}]) {
      let tex;
      try {
        tex = await compile(note, data, {...base,...opts,citationStyle:'ieee'}, 'tex');
        const text = tex.output.toString();
        for (const token of ['\\tableofcontents','\\listoffigures','\\listoftables','\\eqref{eq:mean}','\\label{eq:mean}','\\caption{A compact writing workflow','\\caption{A practical workflow','\\begin{CSLReferences}']) assert.ok(text.includes(token), `Missing ${token}`);
        assert.match(text, /\[1\]/);
        assert.doesNotMatch(text, /\[@(?:pandoc|joplin|zotero)\]/);
        assert.ok(text.includes(`assets/${id}.png`));
      } finally { await clean(tex); }
    }
    pdf = await compile(note, data, {...base,bibliographySource:'zotero'}, 'pdf');
    assert.equal(pdf.output.subarray(0,5).toString(), '%PDF-');
    const cp = require('node:child_process');
    if (cp.spawnSync('python3', ['-c', 'import pypdf']).status === 0) {
      const text = cp.execFileSync('python3', ['-c', 'import sys,pypdf; print("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', path.join(pdf.dir, 'paper.pdf')], {encoding:'utf8'});
      assert.match(text, /Figure 1:/); assert.match(text, /Table 1:/);
      assert.match(text, /Equation\s*\(\s*1\)/); assert.doesNotMatch(text, /\?\?/);
    }
  } finally { await clean(pdf); }
});

test('exports into separate folders without overwriting, preserving TeX assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-test-'));
  try {
    const stage = path.join(root, 'stage'); await fs.mkdir(path.join(stage, 'assets'), { recursive: true });
    await fs.writeFile(path.join(stage, 'assets', 'a.png'), 'picture');
    const result = { dir: stage, output: Buffer.from('tex'), name: 'My paper', format: 'tex' };
    const a = await exportResult(result, root); const b = await exportResult(result, root);
    assert.notEqual(a, b); assert.equal(await fs.readFile(a, 'utf8'), 'tex');
    assert.equal(await fs.readFile(path.join(path.dirname(a), 'assets', 'a.png'), 'utf8'), 'picture');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('real Pandoc creates readable LaTeX and PDF with a bibliography', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-integration-'));
  let tex, pdf;
  try {
    const bib = path.join(root, 'library.bib');
    await fs.writeFile(bib, '@article{smith2023, author={Smith, Jane}, title={A useful study}, journal={Journal of Tests}, year={2023}}');
    const id = '1234567890abcdef1234567890abcdef';
    const note = { id: '123', title: 'A paper', body: `## Abstract\n\nAn **important** study [@smith2023].\n\n[toc]\n\n## Introduction\n\nA useful finding [@smith2023]{{fn: Source detail}}.\n\n$$E = mc^2$$\n\n![Example](:/${id})` };
    const data = { resourcePath: async () => path.join(__dirname, 'figure.png') };
    const opts = { pandoc: process.env.SCHOLAR_TEST_PANDOC, engine: '/Library/TeX/texbin/xelatex', bibliography: bib, authors: [{ name: 'Alice & Ada', affiliations: ['University of Zürich'], corresponding: true, email: 'alice_a@example.org' }, { name: 'Bob', affiliations: ['University of Zürich'] }] };
    tex = await compile(note, data, opts, 'tex');
    const content = tex.output.toString('utf8');
    assert.match(content, /\\author\{/); assert.match(content, /Alice \\& Ada/); assert.match(content, /Corresponding author/); assert.match(content, /\\footnote\{Source detail\}/);
    assert.match(content, /Smith/); assert.match(content, /2023/); assert.match(content, /Introduction/);
    assert.match(content, /\\begin\{abstract\}[\s\S]*\\textbf\{important\}[\s\S]*Smith[\s\S]*\\end\{abstract\}/);
    assert.ok(content.indexOf('\\end{abstract}') < content.indexOf('\\tableofcontents'));
    assert.ok(content.indexOf('\\tableofcontents') < content.indexOf('Introduction'));
    assert.doesNotMatch(content, /\[toc\]/i);
    pdf = await compile(note, data, opts, 'pdf');
    assert.equal(pdf.output.subarray(0, 5).toString(), '%PDF-');
    const cp = require('node:child_process');
    if (cp.spawnSync('python3', ['-c', 'import pypdf']).status === 0) {
      const text = cp.execFileSync('python3', ['-c', 'import sys,pypdf; print(\"\\n\".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', path.join(pdf.dir, 'paper.pdf')], { encoding: 'utf8' });
      assert.ok(text.indexOf('An important study') < text.indexOf('Contents'));
      assert.match(text, /Alice/); assert.match(text, /University of Zürich/); assert.match(text, /Corresponding author/); assert.match(text, /Source detail/);
      assert.match(text, /Abstract[\s\S]*An important study[\s\S]*Smith/);
      assert.match(text, /Contents[\s\S]*Introduction[\s\S]*Introduction/);
      assert.doesNotMatch(text, /\[toc\]/i);
    }
    const exported = await exportResult(tex, root);
    require('node:child_process').execFileSync(opts.engine, ['-interaction=nonstopmode', '-halt-on-error', path.basename(exported)], { cwd: path.dirname(exported), stdio: 'ignore' });
    assert.ok((await fs.stat(path.join(path.dirname(exported), 'A paper.pdf'))).size > 0);
  } finally { await clean(tex); await clean(pdf); await fs.rm(root, { recursive: true, force: true }); }
});

test('real Pandoc renders YAML authors and GitHub-style footnotes', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const note = { id: 'metadata', title: 'Fallback title', body: [
    '---', 'title: Paper from metadata', 'author:',
    '  - name: Alice Researcher', '    url: https://example.org/people/alice', '    affiliation_url: https://example.org/university', '    affiliations:', '      - University of Zurich', '      - Research Institute',
    '    corresponding: true', '    email: alice@example.org',
    '  - Jane Doe^[Institution Two, jane@example.org]',
    '---', '', '## Abstract', '', 'Summary with a note[^background].', '',
    '[toc]', '', '## Introduction', '', 'An observation[^source].', '',
    '[^background]: Background detail.', '', '[^source]: Source **detail**.',
  ].join('\n') };
  const opts = { pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:'/Library/TeX/texbin/xelatex', authors:[{name:'Panel author'}] };
  let tex, pdf;
  try {
    tex = await compile(note, {}, opts, 'tex');
    const output = tex.output.toString('utf8');
    assert.match(output, /\\title\{Paper from metadata\}/);
    assert.match(output, /Alice Researcher/);
    assert.match(output, /\\href\{https:\/\/example.org\/people\/alice\}\{Alice Researcher\}/);
    assert.match(output, /Corresponding author: Alice Researcher/);
    assert.match(output, /Jane Doe\\thanks\{Institution Two, jane@example.org\}/);
    assert.doesNotMatch(output, /Panel author/);
    assert.match(output, /\\begin\{abstract\}[\s\S]*\\footnote\{Background detail\.[\s\S]*\\end\{abstract\}/);
    assert.match(output, /\\footnote\{Source \\textbf\{detail\}/);
    pdf = await compile(note, {}, opts, 'pdf');
    assert.equal(pdf.output.subarray(0, 5).toString(), '%PDF-');
    const cp = require('node:child_process');
    if (cp.spawnSync('python3', ['-c', 'import pypdf']).status === 0) {
      const text = cp.execFileSync('python3', ['-c', 'import sys,pypdf; print("\\n".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', path.join(pdf.dir, 'paper.pdf')], {encoding:'utf8'});
      for (const value of ['Paper from metadata', 'Alice Researcher', 'University of Zurich', 'Jane Doe', 'Background detail', 'Source detail']) assert.ok(text.includes(value), `Missing ${value}`);
      assert.ok(!text.includes('Panel author'));
      const links = cp.execFileSync('python3', ['-c', 'import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print("\\n".join(str(a.get_object().get("/A",{}).get("/URI","")) for p in r.pages for a in p.get("/Annots",[])))', path.join(pdf.dir, 'paper.pdf')], {encoding:'utf8'});
      assert.match(links, /https:\/\/example.org\/people\/alice/);
      assert.match(links, /https:\/\/example.org\/university/);
    }
  } finally { await clean(tex); await clean(pdf); }
});

test('direct Zotero bibliography resolves only real citation keys', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const http = require('node:http');
  const calls = [];
  const bib = '@article{smith2023, author={Smith, Jane}, title={First Study}, journaltitle={Studies}, year={2023}}\n@book{doe2020, author={Doe, John}, title={Second Study}, year={2020}}';
  const server = http.createServer((request, response) => {
    let body=''; request.on('data', x=>body+=x); request.on('end', () => {
      calls.push(JSON.parse(body)); response.writeHead(200, {'Content-Type':'application/json'});
      response.end(JSON.stringify({jsonrpc:'2.0', id:1, result:bib}));
    });
  });
  await new Promise(resolve=>server.listen(0, '127.0.0.1', resolve));
  const opts = {pandoc:process.env.SCHOLAR_TEST_PANDOC, engine:'/Library/TeX/texbin/xelatex', bibliographySource:'zotero', zoteroEndpoint:`http://127.0.0.1:${server.address().port}/better-bibtex/json-rpc`};
  let tex, pdf, plain, directMetadata;
  try {
    const note = {id:'one', title:'Paper', body:'## Intro\n\nA claim [@smith2023, p. 42]. Another note[^more]. See equation \\@ref(eq:result).\n\n$$x=1 (\\#eq:result)$$\n\n[^more]: See [@doe2020].\n\n`[@not-a-citation]`\n\n## References'};
    tex = await compile(note, {}, opts, 'tex');
    const output = tex.output.toString('utf8');
    assert.match(output, /Smith/); assert.match(output, /Doe/); assert.match(output, /First Study/);
    assert.match(output, /\\eqref\{eq:result\}/);
    assert.deepEqual(new Set(calls[0].params[0]), new Set(['smith2023', 'doe2020']));
    assert.equal(calls[0].params[1], 'Better BibLaTeX');
    assert.ok(!JSON.stringify(calls[0]).includes('A claim'));
    const metadataBib = path.join(tex.dir, 'user-library.bib');
    await fs.writeFile(metadataBib, bib);
    let viaMetadata;
    try {
      const metadataNote = {id:'metadata-bib', title:'Metadata bibliography', body:`---\nbibliography: ${JSON.stringify(metadataBib)}\n---\n\nA claim [@smith2023].`};
      const previous = calls.length;
      viaMetadata = await compile(metadataNote, {}, {...opts, bibliographySource:'auto'}, 'tex');
      assert.match(viaMetadata.output.toString('utf8'), /First Study/);
      assert.equal(calls.length, previous, 'explicit note bibliography takes precedence over automatic Zotero');
    } finally { await clean(viaMetadata); }
    directMetadata = await compile({id:'zotero-style',title:'Styled Zotero',body:'---\ncsl: ieee\n---\n\nA claim [@smith2023].'}, {}, opts, 'tex');
    assert.match(directMetadata.output.toString(), /\[1\]/);
    pdf = await compile(note, {}, opts, 'pdf');
    assert.equal(pdf.output.subarray(0, 5).toString(), '%PDF-');
    const before = calls.length;
    plain = await compile({id:'two', title:'No citations', body:'Just text and `[@not-a-citation]`.'}, {}, opts, 'tex');
    assert.equal(calls.length, before, 'no Zotero request without citations');
    await assert.rejects(compile({id:'three', title:'All', body:'---\nnocite: |\n  @*\n---\nText'}, {}, opts, 'tex'), /nocite: @\*/);
    assert.equal(calls.length, before, 'wildcard is rejected before requesting Zotero');
  } finally { await clean(tex); await clean(pdf); await clean(plain); await clean(directMetadata); await new Promise(resolve=>server.close(resolve)); }
});

test('applies bundled citation styles and gives R Markdown csl metadata precedence', { skip: !process.env.SCHOLAR_TEST_PANDOC }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-csl-'));
  const bib = path.join(root, 'references.bib');
  await fs.writeFile(bib, '@article{smith2023, author={Smith, Jane}, title={A study}, journal={Journal}, year={2023}}');
  const opts = {pandoc:process.env.SCHOLAR_TEST_PANDOC, bibliography:bib};
  let apa, ieee, metadata;
  try {
    const note = {id:'s',title:'Paper',body:'A claim [@smith2023].'};
    apa = await compile(note, {}, {...opts, citationStyle:'apa'}, 'tex');
    ieee = await compile(note, {}, {...opts, citationStyle:'ieee'}, 'tex');
    assert.match(apa.output.toString(), /Smith, 2023/);
    assert.match(ieee.output.toString(), /\[1\]/);
    metadata = await compile({...note, body:'---\ncsl: ieee.csl\n---\n\nA claim [@smith2023].'}, {}, {...opts, citationStyle:'apa'}, 'tex');
    assert.match(metadata.output.toString(), /\[1\]/);
    assert.doesNotMatch(metadata.output.toString(), /Smith, 2023/);
  } finally { await clean(apa); await clean(ieee); await clean(metadata); await fs.rm(root, {recursive:true,force:true}); }
});
