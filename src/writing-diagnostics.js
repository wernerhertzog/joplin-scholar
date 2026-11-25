'use strict';
const MarkdownIt=require('markdown-it');
const {splitFrontMatter}=require('./metadata-editor');
const parser=new MarkdownIt({html:true});
function writingWarning(body) {
  let text=String(body || '');
  try { text=splitFrontMatter(text).tail; } catch (_) { return ''; }
  for (const token of parser.parse(text,{})) {
    if (token.type !== 'inline') continue;
    const prose=token.content.replace(/(`+)[\s\S]*?\1/g,'');
    if (/\\\[[^\n\]]*@[^\n\]]*\\\]/.test(prose)) return 'This note contains an escaped citation. Joplin’s rich-text editor may have changed the Markdown; check citations in the Markdown editor.';
  }
  return '';
}
module.exports={writingWarning};
