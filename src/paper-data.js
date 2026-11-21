'use strict';
const YAML = require('yaml');

const AUTHOR_KEY = 'joplin-scholar.authors';
function cleanText(value, max = 500) {
  return String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.href;
  } catch { throw new Error('Author and affiliation URLs must begin with http:// or https://.'); }
}
function normalizeAuthors(input) {
  if (!Array.isArray(input) || input.length > 50) throw new Error('Authors must be a list of at most 50 people.');
  const authors = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') throw new Error('Invalid author entry.');
    const name = cleanText(row.name, 200), email = cleanText(row.email, 320);
    const rawAffiliations = Array.isArray(row.affiliations) ? row.affiliations : String(row.affiliations || '').split('\n');
    if (rawAffiliations.length > 30) throw new Error('Use no more than 30 affiliations for an author.');
    const affiliations = [...new Set(rawAffiliations.map(a => cleanText(a)).filter(Boolean))];
    const corresponding = row.corresponding === true;
    const notes = Array.isArray(row.notes) ? row.notes.map(note => cleanText(note, 2000)).filter(Boolean) : [];
    const url = cleanUrl(row.url), affiliationUrl = cleanUrl(row.affiliationUrl);
    if (!name && (email || affiliations.length || corresponding || notes.length || url || affiliationUrl)) throw new Error('Enter a name for each author.');
    if (name) authors.push({ name, email, affiliations, corresponding, notes, url, affiliationUrl });
  }
  if (authors.filter(a => a.corresponding).length > 1) throw new Error('Choose only one corresponding author.');
  return authors;
}
// R Markdown permits title footnotes such as `Jane Doe^[University, email]`.
function authorInlineNotes(value) {
  let name = '', i = 0;
  const notes = [];
  while (i < value.length) {
    if (value[i] !== '^' || value[i + 1] !== '[') { name += value[i++]; continue; }
    let j = i + 2, depth = 1, content = '';
    for (; j < value.length && depth; j++) {
      const ch = value[j];
      if (ch === '\\' && j + 1 < value.length) { content += ch + value[++j]; continue; }
      if (ch === '[') depth++;
      if (ch === ']') { depth--; if (!depth) break; }
      content += ch;
    }
    if (depth) { name += value.slice(i); break; }
    notes.push(content);
    i = j + 1;
  }
  return { name: name.trim(), notes };
}
// Parse Pandoc-style YAML without rewriting the user's note or unrelated metadata.
function markdownMetadata(markdown) {
  const lines = String(markdown || '').replace(/^\uFEFF/, '').split('\n');
  if (!/^---[ \t\r]*$/.test(lines[0] || '')) return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t\r]*$/.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return null;
  const header = lines.slice(1, end).join('\n');
  let metadata;
  try {
    const doc = YAML.parseDocument(header, { uniqueKeys: true });
    if (doc.errors.length) throw doc.errors[0];
    metadata = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    if (/^(?:author|authors)\s*:/m.test(header)) throw new Error(`Invalid author metadata: ${error.message}`);
    return null;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata;
}
// `null` means no Markdown author metadata; an empty array intentionally clears it.
function markdownAuthors(markdown) {
  const metadata = markdownMetadata(markdown);
  if (!metadata) return null;
  const hasAuthor = Object.prototype.hasOwnProperty.call(metadata, 'author');
  const hasAuthors = Object.prototype.hasOwnProperty.call(metadata, 'authors');
  if (!hasAuthor && !hasAuthors) return null;
  if (hasAuthor && hasAuthors) throw new Error('Use either author or authors in the Markdown metadata, not both.');
  const raw = hasAuthors ? metadata.authors : metadata.author;
  const entries = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const authors = entries.map(entry => {
    if (typeof entry === 'string') return { ...authorInlineNotes(entry), affiliations: [], email: '', corresponding: false };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each Markdown author must be a name or an object with a name.');
    if (typeof entry.name !== 'string') throw new Error('Each Markdown author needs a name.');
    if (entry.email != null && typeof entry.email !== 'string') throw new Error('An author email must be text.');
    if (entry.url != null && typeof entry.url !== 'string') throw new Error('An author URL must be text.');
    if (entry.affiliation_url != null && typeof entry.affiliation_url !== 'string') throw new Error('An affiliation URL must be text.');
    if (entry.corresponding != null && typeof entry.corresponding !== 'boolean') throw new Error('Set corresponding to true or false.');
    if (entry.affiliation != null && entry.affiliations != null) throw new Error('Use affiliation or affiliations for each author, not both.');
    const affiliations = entry.affiliations ?? entry.affiliation ?? [];
    if (typeof affiliations !== 'string' && (!Array.isArray(affiliations) || affiliations.some(a => typeof a !== 'string'))) throw new Error('Affiliations must be text or a list of text.');
    return {...authorInlineNotes(entry.name), email: entry.email || '', corresponding: entry.corresponding === true, affiliations: typeof affiliations === 'string' ? [affiliations] : affiliations, url:entry.url || '', affiliationUrl:entry.affiliation_url || ''};
  });
  return normalizeAuthors(authors);
}
function escapeLatex(text) {
  const map = { '\\':'\\textbackslash{}', '{':'\\{', '}':'\\}', '#':'\\#', '$':'\\$', '%':'\\%', '&':'\\&', '_':'\\_', '^':'\\textasciicircum{}', '~':'\\textasciitilde{}' };
  return String(text).replace(/[\\{}#$%&_^~]/g, char => map[char]);
}
function latexAuthors(input) {
  const authors = normalizeAuthors(input || []);
  if (!authors.length) return '';
  const affiliations = [], affiliationUrls = new Map();
  for (const author of authors) for (const [index, affiliation] of author.affiliations.entries()) {
    if (!affiliations.includes(affiliation)) affiliations.push(affiliation);
    if (index === 0 && author.affiliationUrl && !affiliationUrls.has(affiliation)) affiliationUrls.set(affiliation, author.affiliationUrl);
  }
  const link = (text, url) => url ? `\\href{${escapeLatex(url)}}{${escapeLatex(text)}}` : escapeLatex(text);
  const names = authors.map(author => {
    const indices = author.affiliations.map(a => affiliations.indexOf(a) + 1);
    let value = link(author.name, author.url);
    if (indices.length) value += `\\textsuperscript{${indices.join(',')}}`;
    for (const note of author.notes) value += `\\thanks{${escapeLatex(note)}}`;
    if (author.corresponding) value += `\\thanks{Corresponding author: ${escapeLatex(author.name)}${author.email ? ` (${escapeLatex(author.email)})` : ''}}`;
    return value;
  });
  const lines = affiliations.map((affiliation, i) => `{\\small \\textsuperscript{${i + 1}}${link(affiliation, affiliationUrls.get(affiliation))}}`);
  return [...[names.join(' \\quad ')], ...lines].join(' \\\\[0.5ex] ');
}
// Keep literal examples in fenced and indented code, HTML comments, and inline code.
function formatFootnotes(markdown) {
  let fence = null, inComment = false;
  return markdown.split('\n').map(line => {
    if (inComment) { if (line.includes('-->')) inComment = false; return line; }
    if (!fence && /^ {0,3}<!--/.test(line)) { if (!line.includes('-->')) inComment = true; return line; }
    const f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (f) {
      const marker = f[1];
      if (!fence) fence = {char: marker[0], length: marker.length};
      else if (marker[0] === fence.char && marker.length >= fence.length && /^\s*$/.test(f[2])) fence = null;
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    return line.replace(/(`+)([\s\S]*?)\1|\{\{fn:\s*([^{}\n]+?)\s*\}\}/gi, (whole, ticks, code, text) => {
      if (ticks || !text || !text.trim()) return whole;
      const escaped = text.trim().replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      return `^[${escaped}]`;
    });
  }).join('\n');
}
module.exports = { AUTHOR_KEY, normalizeAuthors, markdownAuthors, markdownMetadata, latexAuthors, escapeLatex, formatFootnotes };
