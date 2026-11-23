'use strict';
const { normalizeAuthors, escapeLatex } = require('./paper-data');

function authorCommands(style, input) {
  const authors = normalizeAuthors(input || []);
  const affiliations = [...new Set(authors.flatMap(author => author.affiliations))];
  const link = (text, url) => url ? `\\href{${escapeLatex(url)}}{${escapeLatex(text)}}` : escapeLatex(text);
  const affiliationUrls = new Map();
  for (const author of authors) if (author.affiliationUrl && author.affiliations[0] && !affiliationUrls.has(author.affiliations[0])) affiliationUrls.set(author.affiliations[0], author.affiliationUrl);
  const institution = value => link(value, affiliationUrls.get(value));
  const numbered = author => author.affiliations.map(affiliation => affiliations.indexOf(affiliation) + 1);
  const correspondence = author => `Corresponding author: ${escapeLatex(author.name)}${author.email ? ` (${escapeLatex(author.email)})` : ''}`;
  if (style === 'apa7') {
    const names = authors.map(author => `{${link(author.name, author.url)}}`).join(',');
    const indices = authors.map(author => `{${numbered(author).join(',')}}`).join(',');
    const institutions = affiliations.map(value => `{${institution(value)}}`).join(',');
    const notes = authors.flatMap(author => [...author.notes.map(escapeLatex), ...(author.corresponding ? [correspondence(author)] : [])]);
    return `${authors.length ? `\\authorsnames${affiliations.length ? `[${indices}]` : ''}{${names}}` : '\\authorsnames{\\mbox{}}'}\n\\authorsaffiliations{${institutions || '\\mbox{}'}}\n${notes.length ? `\\authornote{${notes.join('\\\\ ')}}` : ''}`;
  }
  if (style === 'acm') return authors.map(author => {
    const lines = [`\\author{${link(author.name, author.url)}}`];
    for (const affiliation of author.affiliations) lines.push(`\\affiliation{\\institution{${institution(affiliation)}}\\country{}}`);
    for (const note of author.notes) lines.push(`\\authornote{${escapeLatex(note)}}`);
    if (author.corresponding) lines.push(`\\authornote{${correspondence(author)}}`);
    return lines.join('\n');
  }).join('\n');
  if (style === 'revtex') return authors.map(author => {
    const lines = [`\\author{${link(author.name, author.url)}}`];
    for (const affiliation of author.affiliations) lines.push(`\\affiliation{${institution(affiliation)}}`);
    for (const note of author.notes) lines.push(`\\thanks{${escapeLatex(note)}}`);
    if (author.corresponding) { lines.push('\\thanks{Corresponding author}'); if (author.email) lines.push(`\\email{${escapeLatex(author.email)}}`); }
    return lines.join('\n');
  }).join('\n');
  if (style === 'elsevier') {
    let noteId = 0;
    const notes = [];
    const names = authors.map(author => {
      let name = link(author.name, author.url);
      for (const note of author.notes) { noteId++; name += `\\fnref{n${noteId}}`; notes.push(`\\fntext[n${noteId}]{${escapeLatex(note)}}`); }
      if (author.corresponding) name += '\\corref{cor1}';
      const indices = numbered(author).map(i => `a${i}`).join(',');
      return `\\author${indices ? `[${indices}]` : ''}{${name}}`;
    });
    const corresponding = authors.find(author => author.corresponding);
    return [...names, ...affiliations.map((affiliation, i) => `\\address[a${i+1}]{${institution(affiliation)}}`), ...(corresponding ? [`\\cortext[cor1]{${correspondence(corresponding)}}`] : []), ...notes].join('\n');
  }
  if (style === 'springer') {
    const names = authors.map(author => {
      const indices = numbered(author).join(',');
      const lines = [`\\author${author.corresponding ? '*' : ''}${indices ? `[${indices}]` : ''}{${link(author.name, author.url)}}`];
      if (author.corresponding && author.email) lines.push(`\\email{${escapeLatex(author.email)}}`);
      for (const note of author.notes) lines.push(`\\footnotetext{${escapeLatex(note)}}`);
      return lines.join('\n');
    });
    return [...names, ...affiliations.map((affiliation, i) => `\\affil[${i+1}]{${institution(affiliation)}}`)].join('\n');
  }
  return '';
}

// Pandoc already parsed Scholar's fenced raw abstract markers. Move the
// enclosed Markdown blocks into metadata so each class can place them itself.
function extractAbstract(document) {
  const blocks = document.blocks || [];
  const isMarker = (block, marker) => block?.t === 'RawBlock' && block.c?.[0] === 'latex' && block.c?.[1]?.trim() === marker;
  const start = blocks.findIndex(block => isMarker(block, '\\begin{abstract}'));
  if (start < 0) return document;
  const end = blocks.findIndex((block, index) => index > start && isMarker(block, '\\end{abstract}'));
  if (end < 0) throw new Error('Could not identify the end of the abstract.');
  if (document.meta?.abstract) throw new Error('Use either YAML abstract metadata or an Abstract heading, not both.');
  document.meta = document.meta || {};
  document.meta.abstract = {t:'MetaBlocks', c:blocks.slice(start + 1, end)};
  document.blocks = [...blocks.slice(0, start), ...blocks.slice(end + 1)];
  return document;
}

// Pandoc emits longtable, which cannot run inside IEEE's two-column layout.
// Keep the table intact and switch to a full-width page around it.
function ieeeTables(document) {
  const containsTable = node => {
    if (!node || typeof node !== 'object') return false;
    if (node.t === 'Table') return true;
    return Object.values(node).some(value => Array.isArray(value) ? value.some(containsTable) : containsTable(value));
  };
  const blocks = [];
  for (const block of document.blocks || []) {
    if (block.t === 'Table') {
      blocks.push({t:'RawBlock', c:['latex','\\onecolumn']}, block, {t:'RawBlock', c:['latex','\\twocolumn']});
    } else {
      if (containsTable(block)) throw new Error('IEEE tables must be outside lists, quotes, and other nested blocks.');
      blocks.push(block);
    }
  }
  document.blocks = blocks;
  return document;
}

function publisherTemplate(base, style) {
  const titleStart = '$if(title)$\n\\title{';
  const titleIndex = base.indexOf(titleStart);
  const begin = base.indexOf('\\begin{document}', titleIndex);
  const modernMarker = '$if(title)$\n\\maketitle\n$if(abstract)$\n\\begin{abstract}\n$abstract$\n\\end{abstract}\n$endif$\n$endif$';
  const legacyMarker = '$if(title)$\n$if(beamer)$\n\\frame{\\titlepage}\n$else$\n\\maketitle\n$endif$\n$if(abstract)$\n\\begin{abstract}\n$abstract$\n\\end{abstract}\n$endif$\n$endif$';
  const marker = base.includes(modernMarker) ? modernMarker : legacyMarker;
  if (titleIndex < 0 || begin < 0 || !base.includes(marker)) throw new Error('This Pandoc version uses an unsupported LaTeX template. Update Pandoc or choose a general document style.');
  if (style === 'acm') {
    base = base.replace('\\usepackage{amsmath,amssymb}', '\\let\\Bbbk\\relax\n\\usepackage{amsmath,amssymb}');
    // The ACM class supplies math fonts; Pandoc's unicode-math conflicts with
    // them on common TeX distributions. Preserve fontspec for Unicode text.
    if (base.includes('$fonts.latex()$')) base = base.replace('$fonts.latex()$', '\\usepackage{iftex}\n\\ifPDFTeX\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\else\n\\usepackage{fontspec}\n\\fi');
    else base = base.replaceAll('\\usepackage{unicode-math}', '\\usepackage{fontspec}').replaceAll('\\usepackage{lmodern}', '% ACM class fonts');
  }
  if (style === 'revtex') base = base.replace('$common.latex()$', '$scholar-common.latex()$');
  if (style === 'springer') base = base.replace('\\usepackage{xcolor}', '\\usepackage{xcolor}\n\\usepackage{etoolbox}');
  if (style === 'ieee') return base;
  const end = base.indexOf('\\begin{document}', base.indexOf(titleStart));
  const before = base.slice(0, base.indexOf(titleStart));
  const after = base.slice(end);
  const title = '$if(title)$\n\\title{$title$$if(subtitle)$: $subtitle$$endif$}\n$endif$';
  const author = '$scholar-authors$';
  let head = '', front = '';
  if (style === 'apa7') {
    head = `${title}\n\\shorttitle{$title$}\n${author}\n$if(abstract)$\\abstract{$abstract$}$endif$\n\\date{$date$}\n`;
    front = '$if(title)$\\maketitle$endif$';
  } else if (style === 'acm') {
    head = `${title}\n${author}\n\\acmConference{}{}{}\n\\settopmatter{printacmref=false}\n\\date{$date$}\n`;
    front = '$if(abstract)$\\begin{abstract}\n$abstract$\n\\end{abstract}$endif$\n$if(title)$\\maketitle$endif$';
  } else if (style === 'revtex') {
    front = `${title}\n${author}\n$if(date)$\\date{$date$}$endif$\n$if(abstract)$\\begin{abstract}\n$abstract$\n\\end{abstract}$endif$\n$if(title)$\\maketitle$endif$`;
  } else if (style === 'elsevier') {
    front = `\\begin{frontmatter}\n${title}\n${author}\n$if(abstract)$\\begin{abstract}\n$abstract$\n\\end{abstract}$endif$\n\\end{frontmatter}`;
  } else if (style === 'springer') {
    front = `\\newcommand{\\scholarCslBibItem}[2][]{\\item\\hypertarget{#2}{}}\n\\ifdefined\\CSLReferences\\AtBeginEnvironment{CSLReferences}{\\let\\bibitem\\scholarCslBibItem}\\fi\n${title}\n${author}\n$if(abstract)$\\abstract{$abstract$}$endif$\n$if(title)$\\maketitle$endif$`;
  } else return base;
  return before + head + after.replace(marker, () => front);
}
module.exports = { authorCommands, extractAbstract, ieeeTables, publisherTemplate };
