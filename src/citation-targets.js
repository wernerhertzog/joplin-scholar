'use strict';
const MarkdownIt = require('markdown-it');
const {splitFrontMatter} = require('./metadata-editor');

const parser = new MarkdownIt({html:true});
const prefixFor = {fig:'figure', tab:'table', sec:'section'};
const attrAtEnd = /\s*\{([^{}]*)\}(?=\s*(?:#+\s*)?$)/;
const idInAttrs = /(?:^|\s)#([^\s{}]+)/;

function lineData(text) {
  const lines = [], starts = [];
  const re = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match;
  while ((match = re.exec(text)) && match[0]) {
    starts.push(match.index);
    lines.push(match[0].replace(/(?:\r\n|\n|\r)$/, ''));
  }
  if (!lines.length || /[\r\n]$/.test(text)) { starts.push(text.length); lines.push(''); }
  return {lines, starts};
}

function targetList(text) {
  text = String(text || '');
  const {head} = splitFrontMatter(text);
  const source = head.replace(/[^\r\n]/g, ' ') + text.slice(head.length);
  const {lines, starts} = lineData(text);
  const tokens = parser.parse(source, {}), targets = [];
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const used = new Set([...text.matchAll(/(?:^|[\s{])#([A-Za-z0-9][A-Za-z0-9:/_-]*)/g)].map(match=>match[1]));
  const allocate = kind => {
    let n = 1, label;
    do { label = `${kind}:${prefixFor[kind]}-${n++}`; } while (used.has(label));
    used.add(label); return label;
  };
  function identify(kind, lineIndex, labelPosition, title, extra = {}) {
    const line = lines[lineIndex] || '';
    const match = attrAtEnd.exec(line);
    const id = match && idInAttrs.exec(match[1]);
    let label, refId, change = null;
    if (id) {
      const value = id[1];
      if (!/^[A-Za-z0-9][A-Za-z0-9:/_-]*$/.test(value)) return;
      label = value;
      refId = value.startsWith(`${kind}:`) ? value : `${kind}-id:${value}`;
    } else {
      label = allocate(kind); refId = label;
      if (match) {
        const close = match.index + match[0].lastIndexOf('}');
        change = {from:starts[lineIndex]+close, to:starts[lineIndex]+close, insert:` #${label}`};
      } else {
        const at = labelPosition == null ? line.length : labelPosition;
        change = {from:starts[lineIndex]+at, to:starts[lineIndex]+at, insert:`${kind === 'fig' ? '' : ' '}{#${label}}`};
      }
    }
    targets.push({kind, title:title.trim() || `${prefixFor[kind][0].toUpperCase()}${prefixFor[kind].slice(1)}`, line:lineIndex, label, refId, change, ...extra});
  }
  const captions = new Map();
  let abstractSeen = false;
  for (let i=0; i<tokens.length; i++) {
    const token = tokens[i], inline = tokens[i+1];
    if (token.type === 'paragraph_open' && token.map && token.map[1] === token.map[0]+1 && inline?.type === 'inline' && /^Table:\s*/i.test(inline.content)) captions.set(token.map[0], inline.content.replace(/^Table:\s*/i,'').replace(attrAtEnd,'').trim());
  }
  const isBlank = line => /^\s*(?:>\s*)*$/.test(line || '');
  for (let i=0; i<tokens.length; i++) {
    const token = tokens[i], inline = tokens[i+1];
    if (token.type === 'heading_open' && token.map && inline?.type === 'inline') {
      const raw = inline.content.replace(attrAtEnd,'').replace(/\s+#+\s*$/, '').trim();
      // The first Abstract heading is transformed into an abstract environment.
      if (!abstractSeen && /^abstract\s*#*$/i.test(inline.content.trim())) {
        abstractSeen = true;
        targets.push({kind:'sec',title:raw,line:token.map[0],unnumbered:true});
        continue;
      }
      const line = lines[token.map[0]], closing = /\s+#+\s*$/.exec(line);
      const unnumbered = /\{[^{}]*\.unnumbered\b/.test(line);
      identify('sec', token.map[0], closing ? closing.index : line.length, raw, {level:Number(token.tag.slice(1)), unnumbered});
    }
    if (token.type === 'paragraph_open' && token.map && token.map[1] === token.map[0]+1 && inline?.type === 'inline') {
      const children = inline.children || [], images = children.filter(child=>child.type === 'image');
      if (images.length !== 1 || children.some(child=>child.type !== 'image' && (child.type !== 'text' || !/^\s*(?:\{[^{}]*\})?\s*$/.test(child.content)))) continue;
      const line = lines[token.map[0]];
      const title = images[0].content.trim();
      if (title) identify('fig', token.map[0], line.trimEnd().length, title);
      else {
        const empty = /!\[\s*\]/.exec(line);
        if (!empty) continue;
        const count = targets.length;
        identify('fig', token.map[0], line.trimEnd().length, 'Image without a caption', {addedFigureCaption:true});
        if (targets.length === count) continue;
        const target = targets[targets.length-1], local = target.change;
        let updated = line;
        if (local) updated = updated.slice(0,local.from-starts[token.map[0]]) + local.insert + updated.slice(local.to-starts[token.map[0]]);
        updated = updated.slice(0,empty.index+2) + 'Figure' + updated.slice(empty.index+2);
        target.change = {from:starts[token.map[0]],to:starts[token.map[0]]+line.length,insert:updated};
      }
    }
    if (token.type === 'table_open' && token.map) {
      const first = token.map[0], last = token.map[1]-1;
      let before=first-1, after=last+1;
      while (before>=0 && isBlank(lines[before])) before--;
      while (after<lines.length && isBlank(lines[after])) after++;
      const captionLine = captions.has(after) ? after : captions.has(before) ? before : null;
      if (captionLine != null) identify('tab', captionLine, lines[captionLine].length, captions.get(captionLine));
      else if (token.level === 0) {
        const label = allocate('tab');
        const at = starts[last] + lines[last].length;
        targets.push({kind:'tab', title:'Table without a caption', line:first, label, refId:label, change:{from:at,to:at,insert:`${newline}${newline}Table: {#${label}}`}, addedCaption:true});
      }
    }
  }
  targets.sort((a,b)=>a.line-b.line);
  return targets.map((target,index)=>({...target,index}));
}

module.exports = {targetList};
