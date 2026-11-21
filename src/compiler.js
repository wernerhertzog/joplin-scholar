'use strict';
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const { latexAuthors, markdownAuthors, markdownMetadata, formatFootnotes } = require('./paper-data');
const { exportBibliography } = require('./zotero');
const { styles, styleId } = require('./citation-styles');

function citationKeys(document) {
  const keys = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.t === 'Cite' && Array.isArray(node.c?.[0])) {
      for (const citation of node.c[0]) if (typeof citation.citationId === 'string') keys.add(citation.citationId);
    }
    for (const value of Object.values(node)) visit(value);
  }
  visit(document);
  return [...keys];
}

async function bibliographyFromZotero(dir, options) {
  let ast;
  try {
    const result = await run(options.pandoc || 'pandoc', ['paper.md', '--from=markdown', '--to=json'], {cwd:dir, env:processEnvironment(), timeout:30000, maxBuffer:20 * 1024 * 1024});
    ast = JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Pandoc could not be found. Install Pandoc or set its full path in Joplin Scholar settings.');
    throw new Error(`Could not read citations from the note. ${String(error.stderr || error.message).trim().slice(-3000)}`);
  }
  const keys = citationKeys(ast);
  if (keys.includes('*')) throw new Error('Listing every Zotero item with nocite: @* is not supported in direct mode. Use a bibliography file for this paper.');
  if (!keys.length) return '';
  const content = await exportBibliography(keys, options.zoteroLibrary || '', options.zoteroEndpoint);
  const file = path.join(dir, 'zotero-references.bib');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

function processEnvironment() {
  const extra = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin'] : ['/usr/local/bin', '/usr/bin'];
  return { ...process.env, PATH: [...extra, process.env.PATH || ''].join(path.delimiter) };
}
function safeName(name) {
  return (name || 'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 90) || 'Untitled';
}
// Convert the first Abstract heading and its contents into a LaTeX abstract.
// Separate raw blocks let Pandoc still process Markdown, math, and citations.
function formatAbstract(markdown) {
  const lines = markdown.split('\n');
  const output = [];
  let fence = null, inComment = false, inAbstract = false, found = false;
  const begin = '```{=latex}\n\\begin{abstract}\n```';
  const end = '```{=latex}\n\\end{abstract}\n```';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      output.push(line);
      continue;
    }
    if (!fence && /^ {0,3}<!--/.test(line)) {
      if (!line.includes('-->')) inComment = true;
      output.push(line);
      continue;
    }
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && /^\s*$/.test(fenceMatch[2])) fence = null;
      output.push(line);
      continue;
    }
    if (fence) { output.push(line); continue; }
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/.exec(line);
    const setext = /^ {0,3}\S/.test(line) && i + 1 < lines.length && /^ {0,3}(?:=+|-+)[ \t]*\r?$/.test(lines[i + 1]);
    const label = heading ? heading[1].trim() : setext ? line.trim() : null;
    const toc = /^ {0,3}(?:\[(?:toc|lof|lot)\]|\[\[toc\]\]|\[\[_toc_\]\]|\$\{toc\})[ \t\r]*$/i.test(line.replace(/\\([\[\]])/g, '$1'));
    if (inAbstract && (heading || setext || toc)) {
      output.push('', end, '');
      inAbstract = false;
    }
    if (!found && label && /^abstract$/i.test(label)) {
      found = true;
      inAbstract = true;
      output.push('', begin, '');
      if (setext) i++;
      continue;
    }
    output.push(line);
  }
  if (inAbstract) output.push('', end, '');
  return output.join('\n');
}
// Joplin expands these markers in its viewer; Pandoc does not. Translate only
// standalone markers outside fenced/indented code and HTML comments.
function expandTocMarkers(markdown) {
  let fence = null;
  let inComment = false;
  return markdown.split('\n').map(line => {
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      return line;
    }
    if (!fence && /^ {0,3}<!--/.test(line)) {
      if (!line.includes('-->')) inComment = true;
      return line;
    }
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (match) {
      const marker = match[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length && /^\s*$/.test(match[2])) fence = null;
      return line;
    }
    if (fence) return line;
    // Rich-text editing can escape square brackets when converting to Markdown.
    const unescaped = line.replace(/\\([\[\]])/g, '$1');
    if (/^ {0,3}(?:\[toc\]|\[\[toc\]\]|\[\[_toc_\]\]|\$\{toc\})[ \t\r]*$/i.test(unescaped)) return '\n\\tableofcontents\n';
    if (/^ {0,3}\[lof\][ \t\r]*$/i.test(unescaped)) return '\n\\listoffigures\n';
    if (/^ {0,3}\[lot\][ \t\r]*$/i.test(unescaped)) return '\n\\listoftables\n';
    return line;
  }).join('\n');
}
async function stageNote(note, data, dir) {
  const source = note.body || '';
  const header = source.match(/^\uFEFF?---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  const prefix = header ? header[0] : '';
  let body = prefix + expandTocMarkers(formatAbstract(formatFootnotes(source.slice(prefix.length))));
  // Only rewrite images. Joplin note links and other attachments are not Pandoc images.
  const matches = [...body.matchAll(/(!\[(?:\\.|[^\]\\])*\]\(\s*)<?:\/([a-f0-9]{32})>?(?=\s|\))/gi)];
  if (matches.length) await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const staged = new Map();
  for (const match of matches) {
    const id = match[2].toLowerCase();
    if (staged.has(id)) continue;
    try {
      const source = await data.resourcePath(id);
      const ext = path.extname(source).replace(/[^.a-zA-Z0-9]/g, '') || '.bin';
      const relative = `assets/${id}${ext}`;
      await fs.copyFile(source, path.join(dir, relative));
      staged.set(id, relative);
    } catch (e) { throw new Error(`Could not read image ${id}. Make sure the attachment is downloaded. ${e.message}`); }
  }
  body = body.replace(/(!\[(?:\\.|[^\]\\])*\]\(\s*)<?:\/([a-f0-9]{32})>?(?=\s|\))/gi, (_, prefix, id) => `${prefix}${staged.get(id.toLowerCase())}`);
  await fs.writeFile(path.join(dir, 'paper.md'), body, 'utf8');
}
async function compile(note, data, options, format) {
  if (!note || !note.id) throw new Error('Select a note to preview.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'joplin-scholar-'));
  try {
    await stageNote(note, data, dir);
    // Older graphicx releases do not recognize Pandoc's image alt key.
    // Define it only if absent; newer releases retain their accessibility support.
    await fs.writeFile(path.join(dir, 'scholar-compat.tex'), '\\usepackage{graphicx}\n\\makeatletter\n\\@ifundefined{KV@Gin@alt}{\\define@key{Gin}{alt}{}}{}\n\\makeatother\n');
    const args = ['paper.md', '--from=markdown', '--standalone', '--include-in-header=scholar-compat.tex'];
    const metadata = markdownMetadata(note.body);
    if (!metadata || !metadata.title) args.push(`--metadata=title:${note.title || 'Untitled'}`);
    const inlineAuthors = markdownAuthors(note.body);
    const authors = latexAuthors(inlineAuthors === null ? (options.authors || []) : inlineAuthors);
    if (authors || inlineAuthors !== null) args.push('--variable', `author=${authors}`);
    const source = options.bibliographySource || 'auto';
    if (!['auto', 'zotero', 'file'].includes(source)) throw new Error('Select a valid bibliography source in Joplin Scholar settings.');
    const metadataBibliography = source !== 'zotero' && !options.bibliography && !!metadata?.bibliography;
    if (source === 'file' && !options.bibliography && !metadataBibliography) throw new Error('Choose a bibliography file in Joplin Scholar settings.');
    const bibliography = source === 'zotero' || (source === 'auto' && !options.bibliography && !metadataBibliography)
      ? await bibliographyFromZotero(dir, options) : options.bibliography;
    if (bibliography) args.push('--citeproc', `--bibliography=${bibliography}`);
    else if (metadataBibliography) args.push('--citeproc');
    if (bibliography || metadataBibliography) {
      // YAML takes precedence; built-in names are also accepted without a path.
      const selected = metadata?.csl || (options.citationStyle && options.citationStyle !== 'default' ? options.citationStyle : options.csl);
      if (selected && typeof selected !== 'string') throw new Error('The csl field must be a style name or CSL file path.');
      const builtin = styleId(selected);
      if (builtin) {
        const stylePath = path.join(dir, 'scholar-style.csl');
        await fs.writeFile(stylePath, styles[builtin], 'utf8');
        args.push(`--csl=${stylePath}`);
      } else if (selected) args.push(`--csl=${selected}`);
    }
    if (options.template) args.push(`--template=${options.template}`);
    if (format === 'pdf') args.push(`--pdf-engine=${options.engine || 'xelatex'}`);
    args.push('-o', `paper.${format === 'pdf' ? 'pdf' : 'tex'}`);
    try {
      await run(options.pandoc || 'pandoc', args, { cwd: dir, env: processEnvironment(), timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Pandoc could not be found. Install Pandoc or set its full path in Joplin Scholar settings.');
      const details = String(error.stderr || error.stdout || error.message).trim();
      throw new Error(`Could not generate ${format.toUpperCase()}. ${details.slice(-6000)}`);
    }
    const output = await fs.readFile(path.join(dir, `paper.${format === 'pdf' ? 'pdf' : 'tex'}`));
    return { dir, output, name: safeName(note.title), format };
  } catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
}
async function clean(result) { if (result && result.dir) await fs.rm(result.dir, { recursive: true, force: true }); }
async function exportResult(result, parent) {
  // An export gets its own directory so LaTeX image paths remain portable and existing files are never overwritten.
  let dest, n = 1;
  while (!dest) {
    const candidate = path.join(parent, `${result.name}${n === 1 ? '' : ` (${n})`}`);
    try { await fs.mkdir(candidate); dest = candidate; } catch (error) { if (error.code !== 'EEXIST') throw error; n++; }
  }
  try {
    const filename = `${result.name}.${result.format === 'pdf' ? 'pdf' : 'tex'}`;
    await fs.writeFile(path.join(dest, filename), result.output);
    if (result.format === 'tex') {
      try { await fs.cp(path.join(result.dir, 'assets'), path.join(dest, 'assets'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return path.join(dest, filename);
  } catch (error) { await fs.rm(dest, { recursive: true, force: true }); throw error; }
}
module.exports = { compile, clean, exportResult, safeName, stageNote, processEnvironment, expandTocMarkers, formatAbstract, citationKeys, bibliographyFromZotero };
