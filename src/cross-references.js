'use strict';

// Pandoc attaches these identifiers to the actual caption or heading and
// writes the corresponding LaTeX label. Only references require rewriting.
const LABEL = /^[A-Za-z0-9][A-Za-z0-9:/_-]*$/;
const KINDS = {fig:'Figure', tab:'Table', sec:'Section'};

function hasCrossReferences(markdown) {
  return /\\@ref\((?:fig|tab|sec)(?:-id)?:/.test(String(markdown || ''));
}

function transformCrossReferences(document, {sectionsNumbered = false, sectionDepth = 5, chapterStyle = false} = {}) {
  const labels = new Map(), rawLabels = new Map(), allLabels = new Map(), refs = new Map();
  function addLabel(id, kind, info = {}) {
    if (!id) return;
    if (!LABEL.test(id)) {
      if (id.startsWith(`${kind}:`)) throw new Error(`Invalid ${KINDS[kind].toLowerCase()} label "${id}". Use letters, numbers, colon, slash, underscore, or hyphen.`);
      return;
    }
    allLabels.set(id, (allLabels.get(id) || 0) + 1);
    const key = `${kind}:${id}`;
    if (rawLabels.has(key)) throw new Error(`Duplicate ${KINDS[kind].toLowerCase()} label "${id}".`);
    rawLabels.set(key, {...info, id});
    if (id.startsWith(`${kind}:`)) labels.set(id, {...info, id});
  }
  function scan(node) {
    if (Array.isArray(node)) { for (const child of node) scan(child); return; }
    if (!node || typeof node !== 'object' || ['Code', 'CodeBlock', 'RawBlock', 'RawInline', 'Math'].includes(node.t)) return;
    if (node.t === 'Figure') addLabel(node.c?.[0]?.[0], 'fig');
    if (node.t === 'Table') addLabel(node.c?.[0]?.[0], 'tab');
    if (node.t === 'Header') addLabel(node.c?.[1]?.[0], 'sec', {level:node.c[0], unnumbered:node.c[1][1].includes('unnumbered')});
    // Pandoc before 3.0 represents a standalone captioned figure as a Para
    // containing an Image whose title begins with "fig:".
    if (node.t === 'Para' && node.c?.length === 1 && node.c[0]?.t === 'Image' && node.c[0].c?.[2]?.[1]?.startsWith('fig:')) addLabel(node.c[0].c[0][0], 'fig');
    for (const value of Object.values(node)) scan(value);
  }
  function replace(node) {
    if (Array.isArray(node)) return node.flatMap(child => {
      if (child?.t !== 'Str' || typeof child.c !== 'string') return [replace(child)];
      const pattern = /@ref\((fig|tab|sec)(-id)?:([^()\s]+)\)/g, pieces = [], text = child.c;
      let match, last = 0;
      while ((match = pattern.exec(text))) {
        if (match.index > 0 && /[\w@]/.test(text[match.index - 1])) continue;
        const [, kind, raw, suffix] = match, id = `${kind}${raw || ''}:${suffix}`;
        if (!LABEL.test(suffix)) throw new Error(`Invalid ${KINDS[kind].toLowerCase()} label "${id}". Use letters, numbers, colon, slash, underscore, or hyphen.`);
        if (match.index > last) pieces.push({t:'Str', c:text.slice(last, match.index)});
        const target = raw ? rawLabels.get(`${kind}:${suffix}`) : labels.get(id);
        if (!target) throw new Error(`${KINDS[kind]} reference "${id}" has no matching labelled ${KINDS[kind].toLowerCase()}.`);
        refs.set(id, {kind, target});
        pieces.push({t:'RawInline', c:['latex', `\\ref{${target.id}}`]});
        last = match.index + match[0].length;
      }
      if (!pieces.length) return [child];
      if (last < text.length) pieces.push({t:'Str', c:text.slice(last)});
      return pieces;
    });
    if (!node || typeof node !== 'object' || ['Code', 'CodeBlock', 'RawBlock', 'RawInline', 'Math', 'Cite'].includes(node.t)) return node;
    for (const key of Object.keys(node)) node[key] = replace(node[key]);
    return node;
  }
  scan(document.blocks || []);
  document.blocks = replace(document.blocks || []);
  for (const [id, {kind, target}] of refs) {
    if (allLabels.get(target.id) > 1) throw new Error(`Duplicate document label "${target.id}".`);
    if (kind === 'sec' && (!sectionsNumbered || target.unnumbered || target.level > Number(sectionDepth) + (chapterStyle ? 1 : 0))) throw new Error(`Section reference "${id}" points to an unnumbered heading. Enable section numbering in Document options and use a numbered heading within the numbering depth.`);
  }
  return document;
}

module.exports = {hasCrossReferences, transformCrossReferences};
