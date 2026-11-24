'use strict';
const YAML = require('yaml');
const crypto = require('crypto');
const {normalizeAuthors, markdownAuthors} = require('./paper-data');

const MIGRATED_KEY = 'joplin-scholar.authors-migrated';
const SIMPLE_FIELDS = ['title', 'subtitle', 'date'];

function splitFrontMatter(body) {
  body = String(body || '');
  const opening = /^(\uFEFF?---[ \t]*\r?\n)/.exec(body);
  if (!opening) return {head:'', yaml:'', tail:body, opening:'', closing:'', newline:body.includes('\r\n') ? '\r\n' : '\n'};
  const start = opening[0].length;
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  close.lastIndex = start;
  const match = close.exec(body);
  if (!match) throw new Error('The YAML metadata starts with --- but has no closing --- or .... Fix it in the note before using Document metadata.');
  const end = match.index + match[0].length;
  return {head:body.slice(0,end), yaml:body.slice(start,match.index), tail:body.slice(end), opening:opening[0], closing:match[0], newline:opening[0].endsWith('\r\n') ? '\r\n' : '\n'};
}
function parseYaml(source) {
  const doc = YAML.parseDocument(source, {uniqueKeys:true});
  if (doc.errors.length) throw new Error(`Invalid YAML metadata: ${doc.errors[0].message}`);
  if (doc.directives?.docStart || doc.directives?.docEnd || doc.directives?.yaml?.explicit) throw new Error('Enter metadata without YAML document markers or directives; Scholar adds the surrounding --- lines.');
  if (doc.contents && !YAML.isMap(doc.contents)) throw new Error('Document metadata must be a YAML mapping.');
  if (!doc.contents) doc.contents = doc.createNode({});
  return doc;
}
function headVersion(head) { return crypto.createHash('sha256').update(head).digest('hex'); }
function serialize(doc, parts) {
  let yaml = doc.toString({lineWidth:0});
  if (parts.newline === '\r\n') yaml = yaml.replace(/\n/g, '\r\n');
  const open = parts.opening || `---${parts.newline}`;
  const close = parts.closing || `---${parts.newline}`;
  return open + yaml + close + parts.tail;
}
function inspectMetadata(body, legacyAuthors = [], noteTitle = '') {
  const parts = splitFrontMatter(body), doc = parseYaml(parts.yaml);
  const metadata = doc.toJS({maxAliasCount:100}) || {};
  let existing, authorsError = '';
  try { existing = markdownAuthors(body); }
  catch (error) { existing = []; authorsError = error.message; }
  const legacy = existing === null && legacyAuthors.length > 0;
  const authors = (existing === null ? normalizeAuthors(legacyAuthors) : existing).map((author, index) => ({...author, sourceIndex:index}));
  const fields = {}, complex = [];
  for (const key of SIMPLE_FIELDS) {
    const value = metadata[key];
    if (value == null || typeof value === 'string' || typeof value === 'number') fields[key] = value == null ? '' : String(value);
    else { fields[key] = ''; complex.push(key); }
  }
  const titleFromNote = !metadata.title && !complex.includes('title');
  if (titleFromNote) fields.title = String(noteTitle || '');
  return {yaml:parts.yaml, version:headVersion(parts.head), fields, titleFromNote, complex, authors, legacy, authorsError};
}
function authorsToNode(doc, authors, oldNode, oldAuthors) {
  const oldItems = !oldNode ? [] : YAML.isSeq(oldNode) ? oldNode.items : [oldNode];
  const seq = doc.createNode([]), used = new Set();
  if (YAML.isSeq(oldNode)) for (const key of ['comment','commentBefore','spaceBefore','flow']) if (oldNode[key] != null) seq[key] = oldNode[key];
  for (const row of authors) {
    const normalized = normalizeAuthors([row]);
    if (!normalized.length) continue;
    const author = normalized[0], i = Number.isInteger(row.sourceIndex) ? row.sourceIndex : -1;
    if (i >= 0 && used.has(i)) throw new Error('An author entry was duplicated. Reload the metadata and try again.');
    if (i >= 0) used.add(i);
    const previous = oldAuthors?.[i];
    let node = oldItems[i];
    if (YAML.isAlias(node)) throw new Error('This author uses a YAML alias. Edit it in Full YAML to preserve the alias.');
    if (previous && node && JSON.stringify(author) === JSON.stringify(previous)) { seq.items.push(node); continue; }
    const isMap = YAML.isMap(node);
    if (!isMap) node = doc.createNode({});
    const nameWithNotes = author.name + author.notes.map(note => `^[${note.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}]`).join('');
    if (!previous || author.name !== previous.name || JSON.stringify(author.notes) !== JSON.stringify(previous.notes) || !isMap) node.set('name', nameWithNotes);
    if (!previous || JSON.stringify(author.affiliations) !== JSON.stringify(previous.affiliations) || !isMap) {
      node.delete('affiliation');
      if (author.affiliations.length) node.set('affiliations', author.affiliations); else node.delete('affiliations');
    }
    for (const [key, value] of [['email',author.email],['corresponding',author.corresponding],['url',author.url],['affiliation_url',author.affiliationUrl]]) {
      const before = key === 'affiliation_url' ? previous?.affiliationUrl : previous?.[key];
      if (!previous || value !== before || !isMap) {
        if (value) node.set(key, value); else node.delete(key);
      }
    }
    seq.items.push(node);
  }
  return seq;
}
function updateMetadata(body, {version, yaml, yamlChanged = false, fields = {}, authors, authorsChanged = false}, legacyAuthors = []) {
  const parts = splitFrontMatter(body);
  if (headVersion(parts.head) !== version) throw new Error('The note metadata changed while you were editing. Copy your changes, then reload metadata before saving.');
  let originalAuthors;
  try { originalAuthors = markdownAuthors(body); }
  catch (error) { if (authorsChanged) throw new Error(`Edit these authors in Full YAML: ${error.message}`); originalAuthors = []; }
  const legacy = originalAuthors === null && legacyAuthors.length > 0;
  const original = parseYaml(parts.yaml);
  if (yamlChanged && typeof yaml !== 'string') throw new Error('Enter YAML metadata.');
  const doc = yamlChanged ? parseYaml(yaml) : original;
  const changedInYaml = key => yamlChanged && YAML.stringify(original.get(key)) !== YAML.stringify(doc.get(key));
  for (const [key, value] of Object.entries(fields)) {
    if (!SIMPLE_FIELDS.includes(key) || typeof value !== 'string') throw new Error(`Invalid metadata field: ${key}.`);
    if (changedInYaml(key)) throw new Error(`The ${key} field was changed in both places. Save one edit at a time.`);
    const existing = doc.get(key);
    if (existing != null && typeof existing === 'object') throw new Error(`Edit the ${key} field in Full YAML.`);
    if (value.trim()) doc.set(key, value.trim()); else doc.delete(key);
  }
  if (doc.has('author') && doc.has('authors')) throw new Error('Use either author or authors in the metadata, not both.');
  if (authorsChanged && (changedInYaml('author') || changedInYaml('authors'))) throw new Error('Authors were changed in both places. Save one edit at a time.');
  if (authorsChanged || (legacy && !doc.has('author') && !doc.has('authors'))) {
    if (!Array.isArray(authors)) throw new Error('Invalid authors list.');
    const key = doc.has('authors') ? 'authors' : 'author';
    doc.set(key, authorsToNode(doc, authors, doc.get(key, true), originalAuthors));
  }
  return serialize(doc, parts);
}

module.exports = {MIGRATED_KEY, splitFrontMatter, inspectMetadata, updateMetadata, headVersion};
