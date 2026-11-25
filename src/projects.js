'use strict';
const {splitFrontMatter} = require('./metadata-editor');

// A standalone marker includes a note at that position. Resolve without ever
// modifying source notes; nested includes share the same cycle and size limits.
async function resolveProject(note, data) {
  let count=0, size=0;
  async function expand(current, chain, root) {
    if (chain.includes(current.id)) throw new Error('Paper project contains a circular note inclusion. Remove the repeated include.');
    if (++count > 100) throw new Error('Paper project has more than 100 included notes.');
    const original=String(current.body || '');
    const parts=splitFrontMatter(original);
    const body=root ? original : parts.tail;
    size+=body.length;
    if (size > 5_000_000) throw new Error('Paper project exceeds the 5 MB source limit.');
    const lines=body.split(/\r?\n/), out=[];
    let fence=null, comment=false;
    for (const line of lines) {
      if (comment) { out.push(line); if (line.includes('-->')) comment=false; continue; }
      if (!fence && /^ {0,3}<!--/.test(line)) { out.push(line); if (!line.includes('-->')) comment=true; continue; }
      const f=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (f) { if (!fence) fence={char:f[1][0],length:f[1].length}; else if (f[1][0]===fence.char && f[1].length>=fence.length && !f[2].trim()) fence=null; out.push(line); continue; }
      const m=!fence && /^ {0,3}\{\{include-note:\s*(?::\/)?([a-f0-9]{32})\s*\}\}\s*$/i.exec(line);
      if (!m) { out.push(line); continue; }
      if (!data || typeof data.get !== 'function') throw new Error('Cannot load an included note. Open the project in Joplin.');
      let child;
      try { child=await data.get(['notes',m[1].toLowerCase()],{fields:['id','title','body']}); }
      catch (_) { throw new Error(`Could not load included note ${m[1]}. Check that it exists and has synced to this device.`); }
      if (!child?.id) throw new Error(`Could not find included note ${m[1]}.`);
      out.push('',await expand(child,[...chain,current.id],false),'');
    }
    return out.join('\n');
  }
  return {...note,body:await expand(note,[],true)};
}
module.exports={resolveProject};
