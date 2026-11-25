'use strict';
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const { latexAuthors, latexAffiliations, markdownAuthors, markdownMetadata, formatFootnotes } = require('./paper-data');
const { exportBibliography } = require('./zotero');
const { styles, styleId } = require('./citation-styles');
const { hasBookdownEquations, transformEquations } = require('./equations');
const { hasCrossReferences, transformCrossReferences } = require('./cross-references');
const { layoutDefaults, documentStyles, documentStyleId } = require('./document-styles');
const { normalizeDocumentOptions } = require('./document-options');
const { authorCommands, extractAbstract, ieeeTables, publisherTemplate } = require('./publisher-styles');
const { MAX_LIST_DEPTH, mayContainLists, maximumListDepth, deepListPreamble } = require('./nested-lists');
const { resolveProject } = require('./projects');
const {zipSync, strToU8} = require('fflate');
const MARKDOWN_FORMAT = 'markdown+tex_math_single_backslash';

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

async function readPandocDocument(dir, options) {
  let ast;
  try {
    const result = await run(options.pandoc || 'pandoc', ['paper.md', `--from=${MARKDOWN_FORMAT}`, '--to=json'], {cwd:dir, env:processEnvironment(), timeout:30000, maxBuffer:20 * 1024 * 1024});
    ast = JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Pandoc could not be found. Install Pandoc or set its full path in Joplin Scholar settings.');
    throw new Error(`Could not read the note. ${String(error.stderr || error.message).trim().slice(-3000)}`);
  }
  return ast;
}

async function bibliographyFromZotero(dir, options, document = null, embeddedIds = new Set()) {
  const ast = document || await readPandocDocument(dir, options);
  const keys = citationKeys(ast).filter(key => !embeddedIds.has(key));
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
  if (/\{\{include-note:/i.test(note.body || '')) note = await resolveProject(note, data);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'joplin-scholar-'));
  try {
    await stageNote(note, data, dir);
    const metadata = markdownMetadata(note.body);
    const style = documentStyles[documentStyleId(options.documentStyle) || 'default'];
    const documentOptions = normalizeDocumentOptions(options.documentOptions);
    const classMatches = !metadata?.documentclass || metadata.documentclass === style.metadata.documentclass;
    const adapter = classMatches && !options.template ? style.adapter : null;
    if (documentOptions.affiliations !== 'default' && (options.template || (adapter && adapter !== 'ieee'))) throw new Error('Affiliation placement is controlled by this publisher style or custom template. Choose Style default, or switch to a general document style.');
    if (documentOptions.spacing !== 'default' && adapter === 'acm') throw new Error('The ACM class controls line spacing. Choose Style default for spacing, or switch to a general document style.');
    if (style.adapter === 'springer' && classMatches) {
      let classFile = options.springerClass;
      if (!classFile) {
        try { classFile = (await run('kpsewhich', ['sn-jnl.cls'], {env:processEnvironment(), timeout:10000})).stdout.trim(); } catch (_) {}
      }
      if (!classFile) throw new Error('Springer Nature needs sn-jnl.cls. Download the official journal template package and set the class file path in Joplin Scholar settings: https://www.springernature.com/gp/authors/campaigns/latex-author-support');
      try { await fs.copyFile(classFile, path.join(dir, 'sn-jnl.cls')); }
      catch (error) { throw new Error(`Could not read the Springer Nature class file: ${error.message}`); }
    }
    // Older graphicx releases do not recognize Pandoc's image alt key.
    // Define it only if absent; newer releases retain their accessibility support.
    const equations = hasBookdownEquations(note.body);
    const crossReferences = hasCrossReferences(note.body);
    const layout = layoutDefaults(options.documentStyle, metadata);
    if (documentOptions.spacing !== 'default') layout.linestretch = {single:1, onehalf:1.5, double:2}[documentOptions.spacing];
    if (documentOptions.sections !== 'default') layout.numbersections = documentOptions.sections === 'on';
    if (documentOptions.paperSize !== 'default') layout.papersize = documentOptions.paperSize;
    let parsed = null, document = null;
    if (adapter || equations || crossReferences || mayContainLists(note.body)) parsed = await readPandocDocument(dir, options);
    const depth = parsed ? maximumListDepth(parsed.blocks || []) : 0;
    if (depth > MAX_LIST_DEPTH) throw new Error(`This note has ${depth} nested list or quote levels. Joplin Scholar supports up to ${MAX_LIST_DEPTH} levels.`);
    const compat = '\\usepackage{graphicx}\n\\makeatletter\n\\@ifundefined{KV@Gin@alt}{\\define@key{Gin}{alt}{}}{}\n\\makeatother\n';
    // Book classes do not necessarily define an abstract environment.
    const bookAbstract = style.chapterStyle && classMatches ? '\\makeatletter\n\\@ifundefined{abstract}{\\newenvironment{abstract}{\\chapter*{Abstract}}{}}{}\n\\makeatother\n' : '';
    const bookPreamble = classMatches && style.preamble === 'classicthesis' ? '\\providecolor{Maroon}{cmyk}{0,0.87,0.68,0.32}\n\\providecolor{RoyalBlue}{cmyk}{1,0.5,0,0}\n\\ifPDFTeX\\else\n\\let\\scholarSetMonoFont\\setmonofont\n\\renewcommand{\\setmonofont}[2][]{}\n\\fi\n\\usepackage[palatino=false,beramono=false]{classicthesis}\n\\ifPDFTeX\\else\\let\\setmonofont\\scholarSetMonoFont\\fi\n' : '';
    const lineNumbers = documentOptions.lineNumbers === 'on' ? '\\usepackage{lineno}\n\\AtBeginDocument{\\linenumbers}\n' : documentOptions.lineNumbers === 'off' ? '\\makeatletter\n\\AtBeginDocument{\\@ifundefined{nolinenumbers}{}{\\nolinenumbers}}\n\\makeatother\n' : '';
    await fs.writeFile(path.join(dir, 'scholar-compat.tex'), compat + bookPreamble + bookAbstract + lineNumbers + (depth > 4 ? deepListPreamble() : ''));
    if (equations || crossReferences || adapter) {
      document = equations ? transformEquations(parsed) : parsed;
      if (crossReferences) transformCrossReferences(document, {sectionsNumbered:metadata?.numbersections ?? layout.numbersections ?? false, sectionDepth:metadata?.secnumdepth ?? layout.secnumdepth ?? 5, chapterStyle:!!style.chapterStyle && classMatches});
      if (adapter) extractAbstract(document);
      const classOptions = metadata?.classoption ?? style.metadata.classoption ?? [];
      const oneColumn = (Array.isArray(classOptions) ? classOptions : [classOptions]).includes('onecolumn');
      if (adapter === 'ieee' && !oneColumn) ieeeTables(document);
      await fs.writeFile(path.join(dir, 'paper.json'), JSON.stringify(document), 'utf8');
    }
    const args = [document ? 'paper.json' : 'paper.md', document ? '--from=json' : `--from=${MARKDOWN_FORMAT}`, '--standalone', '--include-in-header=scholar-compat.tex'];
    if (style.chapterStyle && classMatches) args.push('--top-level-division=chapter');
    if (Object.keys(layout).length) {
      await fs.writeFile(path.join(dir, 'scholar-layout.json'), JSON.stringify(layout), 'utf8');
      // Input YAML overrides these defaults, including when the input is Pandoc JSON.
      args.push('--metadata-file=scholar-layout.json');
    }
    if (!metadata || !metadata.title) args.push(`--metadata=title:${note.title || 'Untitled'}`);
    const inlineAuthors = markdownAuthors(note.body);
    const selectedAuthors = inlineAuthors === null ? (options.authors || []) : inlineAuthors;
    const authors = latexAuthors(selectedAuthors, {affiliationsAtEnd:documentOptions.affiliations === 'end'});
    if (authors || inlineAuthors !== null) args.push('--variable', `author=${authors}`);
    if (documentOptions.affiliations === 'end') {
      const affiliations = latexAffiliations(selectedAuthors, {chapter:!!style.chapterStyle && classMatches});
      if (affiliations) {
        await fs.writeFile(path.join(dir, 'scholar-affiliations.tex'), affiliations, 'utf8');
        args.push('--include-after-body=scholar-affiliations.tex');
      }
    }
    if (adapter) {
      let base;
      try { base = (await run(options.pandoc || 'pandoc', ['--print-default-template=latex'], {env:processEnvironment(), timeout:30000})).stdout; }
      catch (error) { throw new Error(`Could not load Pandoc's LaTeX template: ${error.message}`); }
      const template = publisherTemplate(base, adapter);
      await fs.writeFile(path.join(dir, 'scholar-publisher.latex'), template, 'utf8');
      if (adapter === 'revtex' && base.includes('$common.latex()$')) {
        let common;
        try { common = (await run(options.pandoc || 'pandoc', ['--print-default-data-file=templates/common.latex'], {env:processEnvironment(), timeout:30000})).stdout; }
        catch (error) { throw new Error(`Could not load Pandoc's LaTeX support: ${error.message}`); }
        common = common.replace(/\\usepackage\{caption\}\s*\n\\captionsetup\[table\]\{skip=6pt\}\s*\n/, '');
        await fs.writeFile(path.join(dir, 'scholar-common.latex'), common, 'utf8');
      }
      args.push('--template=scholar-publisher.latex');
      const commands = authorCommands(adapter, selectedAuthors);
      if (commands) args.push('--variable', `scholar-authors=${commands}`);
    }
    const source = options.bibliographySource || 'auto';
    if (!['auto', 'zotero', 'file'].includes(source)) throw new Error('Select a valid bibliography source in Joplin Scholar settings.');
    const inlineReferences = Array.isArray(metadata?.references) ? metadata.references : [];
    const embeddedIds = new Set(inlineReferences.filter(reference => reference && reference.id != null).map(reference => String(reference.id)));
    const emptyBibliography = Array.isArray(metadata?.bibliography) && !metadata.bibliography.length;
    const metadataBibliography = !emptyBibliography && source !== 'zotero' && !options.bibliography && !!metadata?.bibliography;
    // Keep self-contained notes independent of global settings, but look up
    // newly added citations that are not among the embedded CSL records.
    let inlineOnly = false;
    if (inlineReferences.length && emptyBibliography) {
      const ast = document || parsed || await readPandocDocument(dir, options);
      inlineOnly = citationKeys(ast).every(key => embeddedIds.has(key));
    }
    if (source === 'file' && !options.bibliography && !metadataBibliography && !inlineOnly) throw new Error('Choose a bibliography file in Joplin Scholar settings for citations not included in the note.');
    const bibliography = inlineOnly ? '' : source === 'zotero' || (source === 'auto' && !options.bibliography && !metadataBibliography)
      ? await bibliographyFromZotero(dir, options, document || parsed, embeddedIds) : options.bibliography;
    if (bibliography) args.push('--citeproc', `--bibliography=${bibliography}`);
    else if (metadataBibliography || inlineReferences.length) args.push('--citeproc');
    if (bibliography || metadataBibliography || inlineReferences.length) {
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
      const missingClass = /File [`']([^`'\n]+\.cls)['`] not found/i.exec(details);
      if (missingClass) throw new Error(`The LaTeX class ${missingClass[1]} is not installed. Install its TeX package in your LaTeX distribution. ${details.slice(-4000)}`);
      const missingPackage = /File [`']([^`'\n]+\.sty)['`] not found/i.exec(details);
      if (missingPackage) throw new Error(`The LaTeX package ${missingPackage[1]} is not installed. Install it in your TeX distribution. ${details.slice(-4000)}`);
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
      try { await fs.copyFile(path.join(result.dir, 'sn-jnl.cls'), path.join(dest, 'sn-jnl.cls')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return path.join(dest, filename);
  } catch (error) { await fs.rm(dest, { recursive: true, force: true }); throw error; }
}
async function exportBundle(result, parent) {
  if (result.format !== 'tex') throw new Error('A submission bundle requires LaTeX output.');
  const texFile = await exportResult(result, parent), folder = path.dirname(texFile);
  try {
    const files = {};
    async function collect(dir, prefix = '') {
      for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
        const name = prefix + entry.name, full = path.join(dir,entry.name);
        if (entry.isDirectory()) await collect(full, name + '/');
        else if (entry.isFile()) files[name] = new Uint8Array(await fs.readFile(full));
      }
    }
    await collect(folder);
    files['README.txt'] = strToU8('Joplin Scholar submission bundle\n\nUpload this ZIP as a new project in Overleaf or extract it locally. Select the included .tex file as the main document and compile with XeLaTeX at least twice. The required LaTeX classes and packages must be available in your TeX installation or Overleaf project.\n\nCitations and the bibliography have already been rendered by Pandoc; this is not an editable BibTeX/BibLaTeX project. Check the PDF and journal requirements before submitting.\n');
    const zip = path.join(folder, `${result.name}.zip`);
    await fs.writeFile(zip, zipSync(files, {level:6}));
    return zip;
  } catch (error) { await fs.rm(folder, {recursive:true,force:true}); throw error; }
}
module.exports = { compile, clean, exportResult, exportBundle, safeName, stageNote, processEnvironment, expandTocMarkers, formatAbstract, citationKeys, bibliographyFromZotero, readPandocDocument };
