'use strict';

// Standard LaTeX permits only four nested itemize/enumerate lists. Block
// quotes and definition lists also use LaTeX list depth, so count them too.
const MAX_LIST_DEPTH = 20;
const CONTAINERS = new Set(['BulletList', 'OrderedList', 'DefinitionList', 'BlockQuote']);
function mayContainLists(markdown) {
  return /^[ \t]*(?:[-+*:]|(?:\d+|[A-Za-z]+|#)[.)])(?=[ \t])|^[ \t]*>/m.test(String(markdown || ''));
}
function maximumListDepth(node, depth = 0) {
  if (Array.isArray(node)) return node.reduce((max, child) => Math.max(max, maximumListDepth(child, depth)), depth);
  if (!node || typeof node !== 'object') return depth;
  if (node.t === 'Code' || node.t === 'CodeBlock' || node.t === 'RawBlock' || node.t === 'RawInline') return depth;
  const current = depth + (CONTAINERS.has(node.t) ? 1 : 0);
  return Object.values(node).reduce((max, child) => Math.max(max, maximumListDepth(child, current)), current);
}
function deepListPreamble() {
  const lines = [
    '% Support deeply nested Markdown lists.',
    '\\makeatletter',
    '\\@ifpackageloaded{enumitem}{}{\\usepackage{enumitem}}',
    '\\makeatother',
    `\\setlistdepth{${MAX_LIST_DEPTH}}`,
    `\\renewlist{itemize}{itemize}{${MAX_LIST_DEPTH}}`,
    `\\renewlist{enumerate}{enumerate}{${MAX_LIST_DEPTH}}`,
  ];
  const bullets = ['\\textbullet', '\\textendash', '\\textasteriskcentered', '\\textperiodcentered'];
  const numbers = ['\\arabic*.', '\\alph*)', '\\roman*.', '\\Alph*.'];
  for (let i = 1; i <= MAX_LIST_DEPTH; i++) {
    const bullet = bullets[(i - 1) % bullets.length];
    const number = numbers[(i - 1) % numbers.length];
    const margin = i > 4 ? ',leftmargin=1.4em' : '';
    lines.push(`\\setlist[itemize,${i}]{label=${bullet}${margin}}`);
    lines.push(`\\setlist[enumerate,${i}]{label=${number}${margin}}`);
  }
  return lines.join('\n') + '\n';
}
module.exports = {MAX_LIST_DEPTH, mayContainLists, maximumListDepth, deepListPreamble};
