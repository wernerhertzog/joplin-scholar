'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAuthors, markdownAuthors, markdownMetadata, latexAuthors, formatFootnotes } = require('../src/paper-data');

test('reads Pandoc and R Markdown authors from YAML frontmatter', () => {
  assert.equal(markdownAuthors('# No metadata\n'), null);
  assert.equal(markdownAuthors('---\ntitle: Example\n---\nBody'), null);
  assert.deepEqual(markdownAuthors('---\nauthor: []\n---\nBody'), []);
  assert.equal(markdownAuthors('---\nauthor: "John Doe, Jane Doe"\n---\nBody')[0].name, 'John Doe, Jane Doe');
  const list = markdownAuthors('---\nauthor:\n  - John Doe, Institution One\n  - Jane Doe^[Institution Two, jane@example.org]\n---\nBody');
  assert.equal(list[0].name, 'John Doe, Institution One');
  assert.equal(list[1].name, 'Jane Doe');
  assert.deepEqual(list[1].notes, ['Institution Two, jane@example.org']);
  assert.match(latexAuthors(list), /Jane Doe\\thanks\{Institution Two, jane@example.org\}/);
  const structured = markdownAuthors('---\ntitle: Distill example\nauthor:\n  - name: JJ Allaire\n    url: https://github.com/jjallaire\n    affiliation: RStudio\n    affiliation_url: https://rstudio.com\n  - name: Alice\n    affiliations: [RStudio, University of Zurich]\n    corresponding: true\n    email: alice@example.org\n---\nBody');
  assert.equal(markdownMetadata('---\ntitle: A title\n---\nBody').title, 'A title');
  assert.equal(structured[0].url, 'https://github.com/jjallaire');
  assert.deepEqual(structured[1].affiliations, ['RStudio', 'University of Zurich']);
  assert.match(latexAuthors(structured), /\\href\{https:\/\/github.com\/jjallaire\}\{JJ Allaire\}/);
  assert.match(latexAuthors(structured), /\\href\{https:\/\/rstudio.com\/\}\{RStudio\}/);
  const aliases = markdownAuthors('---\ninstitution: &uzh University of Zurich\nauthors:\n  - name: Alice\n    affiliation: *uzh\n---\nBody');
  assert.deepEqual(aliases[0].affiliations, ['University of Zurich']);
  const nested = markdownAuthors('---\nauthor: "Jane^[See [the source](https://example.org)]"\n---\nBody');
  assert.deepEqual(nested[0].notes, ['See [the source](https://example.org)']);
  assert.throws(() => markdownAuthors('---\nauthor: [broken\n---\nBody'), /Invalid author metadata/);
  assert.throws(() => markdownAuthors('---\nauthor: Jane\nauthors: [John]\n---\nBody'), /either author or authors/);
  assert.throws(() => markdownAuthors('---\nauthor:\n  - name: A\n    corresponding: "yes"\n---\nBody'), /true or false/);
});

test('authors share numbered affiliations, escape TeX, and can both correspond', () => {
  const authors = normalizeAuthors([
    { name:'Alice & Co', affiliations:['UZH, Zürich', 'Institute_2'], email:'a_b@example.org', corresponding:true },
    { name:'Bob #2', affiliations:['UZH, Zürich'], email:'bob@example.org', corresponding:true },
  ]);
  const tex = latexAuthors(authors);
  assert.match(tex, /Alice \\& Co\\textsuperscript\{1,2\}/);
  assert.match(tex, /Corresponding author: Alice \\& Co \(a\\_b@example.org\)/);
  assert.match(tex, /Bob \\#2\\textsuperscript\{1\}/);
  assert.equal((tex.match(/UZH, Zürich/g) || []).length, 1);
  assert.match(tex, /Corresponding author: Bob \\#2 \(bob@example.org\)/);
  assert.throws(() => normalizeAuthors([{name:'', email:'a@example.org'}]), /name/);
});

test('footnotes work inline without changing code or standard Markdown footnotes', () => {
  const input = 'Text{{fn: a note [with brackets]}} and {{fn: second}}.\n\n`{{fn: code}}`\n\n```\n{{fn: fenced}}\n```\n\n    {{fn: indented}}\n\n<!--\n{{fn: comment}}\n-->\n\nA note[^1].\n\n[^1]: Standard.';
  const output = formatFootnotes(input);
  assert.match(output, /Text\^\[a note \\\[with brackets\\\]\] and \^\[second\]/);
  assert.match(output, /`\{\{fn: code\}\}`/);
  assert.match(output, /```\n\{\{fn: fenced\}\}\n```/);
  assert.match(output, /    \{\{fn: indented\}\}/);
  assert.match(output, /<!--\n\{\{fn: comment\}\}\n-->/);
  assert.match(output, /\[\^1\]: Standard\./);
});
