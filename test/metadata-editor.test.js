'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {inspectMetadata, updateMetadata} = require('../src/metadata-editor');
const {markdownAuthors, markdownMetadata} = require('../src/paper-data');

test('displays the note title as a live default and preserves a separate document title', () => {
  const body = 'A manuscript.';
  const initial = inspectMetadata(body, [], 'My note');
  assert.equal(initial.fields.title, 'My note');
  assert.equal(initial.titleFromNote, true);
  const withAuthor = updateMetadata(body, {version:initial.version, authors:[{name:'Alice'}], authorsChanged:true});
  assert.equal(markdownMetadata(withAuthor).title, undefined, 'an unrelated edit does not freeze the default into YAML');
  assert.equal(inspectMetadata(withAuthor, [], 'Renamed note').fields.title, 'Renamed note');
  const current = inspectMetadata(withAuthor, [], 'Renamed note');
  const titled = updateMetadata(withAuthor, {version:current.version, fields:{title:'Published paper'}});
  const explicit = inspectMetadata(titled, [], 'Renamed note');
  assert.equal(explicit.fields.title, 'Published paper');
  assert.equal(explicit.titleFromNote, false);
  const cleared = updateMetadata(titled, {version:explicit.version, fields:{title:''}});
  assert.equal(inspectMetadata(cleared, [], 'Renamed note').fields.title, 'Renamed note');
});

test('adds visible YAML to a note and migrates legacy authors without changing the body', () => {
  const body = '# Introduction\n\nText.\n';
  const legacy = [{name:'Alice',affiliations:['University'],corresponding:true,email:'alice@example.org'}];
  const state = inspectMetadata(body,legacy);
  assert.equal(state.legacy,true);
  const result = updateMetadata(body, {version:state.version,fields:{title:'My paper'},authors:state.authors},legacy);
  assert.ok(result.endsWith(body));
  assert.equal(markdownMetadata(result).title,'My paper');
  assert.equal(markdownAuthors(result)[0].email,'alice@example.org');
  assert.equal(markdownAuthors(result)[0].corresponding,true);
});

test('edits existing authors while preserving unknown fields, comments, references and note text', () => {
  const body = '---\n# Keep this comment\ntitle: Original\nauthor:\n  - name: Alice\n    affiliation: University\n    orcid: 0000-0001\n    custom: [a, b]\n  - name: Bob\n    corresponding: true\n    email: bob@example.org\nreferences:\n  - id: first\n    title: Custom reference\ncustom-field: {nested: true}\n---\n\n# Main text\nBody\n';
  const state = inspectMetadata(body);
  state.authors[0].email='alice@example.org'; state.authors[0].corresponding=true;
  const result = updateMetadata(body,{version:state.version,fields:{title:'Updated'},authors:state.authors,authorsChanged:true});
  assert.match(result, /# Keep this comment/);
  assert.match(result, /orcid: 0000-0001/);
  assert.deepEqual(markdownMetadata(result)['custom-field'],{nested:true});
  assert.equal(markdownMetadata(result).references[0].title,'Custom reference');
  assert.equal(markdownAuthors(result).length,2);
  assert.ok(markdownAuthors(result).every(a=>a.corresponding));
  assert.ok(result.endsWith('\n# Main text\nBody\n'));
});

test('preserves unmodified author YAML, supports arbitrary fields, and detects conflicting edits', () => {
  const body='---\nauthor: "Jane^[Example University]"\nkeywords: [one, two]\n---\nBody';
  const state=inspectMetadata(body);
  const yaml=state.yaml+'custom: {nested: [1, 2]}\n';
  const result=updateMetadata(body,{version:state.version,yaml,yamlChanged:true,fields:{subtitle:'Subtitle'},authors:state.authors});
  assert.equal(markdownMetadata(result).custom.nested[1],2);
  assert.deepEqual(markdownAuthors(result)[0].notes,['Example University']);
  assert.match(result,/author: "Jane\^\[Example University\]"/);
  assert.throws(()=>updateMetadata(body,{version:state.version,yaml:state.yaml.replace('Jane','Janet'),yamlChanged:true,authorsChanged:true,authors:state.authors}),/Authors were changed in both places/);
  assert.throws(()=>updateMetadata(body.replace('keywords:', 'other:'),{version:state.version,authors:state.authors}),/metadata changed/);
  assert.throws(()=>updateMetadata(body,{version:state.version,yaml:'x: [broken',yamlChanged:true,authors:state.authors}),/Invalid YAML/);
  assert.throws(()=>updateMetadata(body,{version:state.version,yaml:'---\ntitle: X\n',yamlChanged:true,authors:state.authors}),/without YAML document markers/);
  assert.throws(()=>inspectMetadata('---\ntitle: Missing close\n'),/no closing/);
});

test('edits keywords as YAML entries without disturbing unrelated metadata', () => {
  const body='---\nkeywords: [Tzotzil, "language, contact"]\ncustom: keep\n---\n\nPaper';
  const state=inspectMetadata(body);
  assert.equal(state.fields.keywords,'Tzotzil\nlanguage, contact');
  const changed=updateMetadata(body,{version:state.version,fields:{keywords:'Tzotzil\nlanguage, contact\n  markets & trade  '}});
  assert.deepEqual(markdownMetadata(changed).keywords,['Tzotzil','language, contact','markets & trade']);
  assert.equal(markdownMetadata(changed).custom,'keep');
  assert.ok(changed.endsWith('\nPaper'));
  const next=inspectMetadata(changed);
  assert.equal(markdownMetadata(updateMetadata(changed,{version:next.version,fields:{keywords:''}})).keywords,undefined);
  assert.throws(()=>updateMetadata(body,{version:state.version,yaml:'keywords: [changed]\ncustom: keep\n',yamlChanged:true,fields:{keywords:'other'}}),/changed in both places/);
  const complex=inspectMetadata('---\nkeywords: {foo: bar}\n---\nText');
  assert.ok(complex.complex.includes('keywords'));
});

test('supports author removal, unusual author notes, and CRLF notes', () => {
  const body='---\r\nauthor:\r\n  - name: Alice\r\n    extra: keep\r\n---\r\n\r\nText\r\n';
  const state=inspectMetadata(body);
  state.authors[0].notes=['Closing ] and [brackets]'];
  const changed=updateMetadata(body,{version:state.version,authors:state.authors,authorsChanged:true});
  assert.deepEqual(markdownAuthors(changed)[0].notes,['Closing ] and [brackets]']);
  assert.equal(markdownMetadata(changed).author[0].extra,'keep');
  assert.ok(changed.endsWith('\r\nText\r\n'));
  const again=inspectMetadata(changed);
  const empty=updateMetadata(changed,{version:again.version,authors:[],authorsChanged:true});
  assert.deepEqual(markdownAuthors(empty),[]);
});

test('keeps edits to the body made after opening the panel and exposes unusual authors through YAML', () => {
  const body='---\ntitle: First\nauthor:\n  literal: A research group\n---\n\nInitial text.';
  const state=inspectMetadata(body);
  assert.match(state.authorsError, /needs a name/);
  const latest=body+'\nA paragraph typed later.';
  const result=updateMetadata(latest,{version:state.version,yaml:state.yaml.replace('literal: A research group','name: A research group'),yamlChanged:true,fields:{title:'Second'},authors:state.authors});
  assert.ok(result.endsWith('Initial text.\nA paragraph typed later.'));
  assert.equal(markdownAuthors(result)[0].name,'A research group');
});
