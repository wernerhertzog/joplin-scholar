'use strict';

// Bookdown's escaped markers are parsed by Pandoc into ordinary strings or
// raw TeX. Work on the parsed document so code examples remain untouched.
const LABEL = /^[A-Za-z0-9][A-Za-z0-9:/_-]*$/;
const MARKER = /\(\s*\\?#eq:([^()\s]+)\s*\)/g;
const ENVIRONMENT = /\\begin\{(equation|align|gather|multline|flalign|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g;

function hasBookdownEquations(markdown) {
  return /\\@ref\(eq:|\(\s*\\?#eq:/.test(String(markdown || ''));
}

function transformEquations(document) {
  const labels = new Set(), refs = new Set();
  function addLabel(label) {
    if (!LABEL.test(label)) throw new Error(`Invalid equation label "eq:${label}". Use letters, numbers, colon, slash, underscore, or hyphen.`);
    if (labels.has(label)) throw new Error(`Duplicate equation label "eq:${label}".`);
    labels.add(label);
  }
  function transformMath(text, starred = false) {
    // TeX comments cannot introduce labels. Preserve the comment unchanged.
    return text.split(/(\r?\n)/).map(line => {
      if (/^\r?\n$/.test(line)) return line;
      let comment = line.length;
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue;
        let slashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
        if (slashes % 2 === 0) { comment = i; break; }
      }
      const source = line.slice(0, comment), tail = line.slice(comment);
      for (const match of source.matchAll(/\\label\{eq:([^{}\s]+)\}/g)) addLabel(match[1]);
      return source.replace(MARKER, (_, label) => {
        if (starred) throw new Error(`Equation label "eq:${label}" is in an unnumbered environment.`);
        addLabel(label);
        return `\\label{eq:${label}}`;
      }) + tail;
    }).join('');
  }
  function rawEnvironments(text) {
    return text.replace(ENVIRONMENT, (whole, name, star, body) => `\\begin{${name}${star}}${transformMath(body, !!star)}\\end{${name}${star}}`);
  }
  function scanLabels(node) {
    if (Array.isArray(node)) { for (const child of node) scanLabels(child); return; }
    if (!node || typeof node !== 'object') return;
    if (node.t === 'Code' || node.t === 'CodeBlock') return;
    if ((node.t === 'RawBlock' || node.t === 'RawInline') && ['tex', 'latex'].includes(node.c?.[0])) {
      node.c[1] = rawEnvironments(node.c[1]);
      return;
    }
    if (node.t === 'Math' && node.c?.[0]?.t === 'DisplayMath' && MARKER.test(node.c[1])) {
      MARKER.lastIndex = 0;
      const body = node.c[1];
      if (/^\s*\\begin\{(?:equation|align|gather|multline|flalign|eqnarray)\*?\}/.test(body)) {
        node.t = 'RawInline'; node.c = ['latex', rawEnvironments(body)];
      } else {
        node.t = 'RawInline'; node.c = ['latex', `\\begin{equation}\n${transformMath(body)}\n\\end{equation}`];
      }
      return;
    }
    MARKER.lastIndex = 0;
    for (const value of Object.values(node)) scanLabels(value);
  }
  function replaceReferences(node) {
    if (Array.isArray(node)) {
      return node.flatMap(child => {
        if (child && child.t === 'Str' && typeof child.c === 'string') {
          const pieces = [], text = child.c;
          const pattern = /@ref\(eq:([^()\s]+)\)/g;
          let last = 0, match;
          while ((match = pattern.exec(text))) {
            if (match.index > 0 && /[\w@]/.test(text[match.index - 1])) continue;
            if (!LABEL.test(match[1])) throw new Error(`Invalid equation label "eq:${match[1]}". Use letters, numbers, colon, slash, underscore, or hyphen.`);
            if (match.index > last) pieces.push({t:'Str', c:text.slice(last, match.index)});
            refs.add(match[1]);
            pieces.push({t:'RawInline', c:['latex', `\\eqref{eq:${match[1]}}`]});
            last = match.index + match[0].length;
          }
          if (!pieces.length) return [child];
          if (last < text.length) pieces.push({t:'Str', c:text.slice(last)});
          return pieces;
        }
        return [replaceReferences(child)];
      });
    }
    if (!node || typeof node !== 'object' || ['Code', 'CodeBlock', 'RawBlock', 'RawInline', 'Math'].includes(node.t)) return node;
    // Avoid changing citation text, which Pandoc separately renders with citeproc.
    if (node.t === 'Cite') return node;
    for (const key of Object.keys(node)) node[key] = replaceReferences(node[key]);
    return node;
  }
  scanLabels(document.blocks || []);
  document.blocks = replaceReferences(document.blocks || []);
  for (const ref of refs) if (!labels.has(ref)) throw new Error(`Equation reference "eq:${ref}" has no matching label.`);
  return document;
}

module.exports = {hasBookdownEquations, transformEquations};
