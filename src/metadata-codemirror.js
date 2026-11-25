'use strict';

// Replace only the front matter in the live editor, atomically checking the
// entire document first. Joplin's selectedNote API can lag behind unsaved text.
function replacement(text, expected, oldHead, newHead) {
  if (typeof text !== 'string' || text !== expected || !text.startsWith(oldHead)) return {ok:false, reason:'changed'};
  return {ok:true, from:0, to:oldHead.length, insert:newHead};
}

function citationChanges(text, expected, head, expectedHead, reference, targetChange) {
  if (text !== expected || head !== expectedHead) return {ok:false, reason:'changed'};
  if (!Number.isInteger(head) || head < 0 || head > text.length || typeof reference !== 'string' || !reference) return {ok:false, reason:'invalid'};
  const changes = [{from:head, to:head, insert:reference}];
  let cursor = head + reference.length;
  if (targetChange) {
    const {from, to, insert} = targetChange;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > text.length || typeof insert !== 'string') return {ok:false, reason:'invalid'};
    if (head >= from && head <= to) return {ok:false, reason:'overlap'};
    changes.push({from,to,insert});
    if (to < head) cursor += insert.length - (to-from);
  }
  return {ok:true, changes:changes.sort((a,b)=>a.from-b.from), cursor};
}

module.exports = {
  default: () => ({
    plugin: codeMirror => {
      if (codeMirror.cm6) {
        codeMirror.registerCommand('scholar__citationSnapshot', () => {
          const view = codeMirror.editor;
          if (!view || view.editable === false) return {ok:false, reason:'readonly'};
          return {ok:true, text:view.state.doc.toString(), head:view.state.selection.main.head};
        });
        codeMirror.registerCommand('scholar__insertCitation', (expected, expectedHead, reference, targetChange) => {
          const view = codeMirror.editor;
          if (!view || view.editable === false) return {ok:false, reason:'readonly'};
          const result = citationChanges(view.state.doc.toString(), expected, view.state.selection.main.head, expectedHead, reference, targetChange);
          if (!result.ok) return result;
          view.dispatch({changes:result.changes, selection:{anchor:result.cursor}});
          view.focus();
          return {ok:true};
        });
        codeMirror.registerCommand('scholar__replaceMetadata', (expected, oldHead, newHead) => {
          const view = codeMirror.editor;
          if (!view || view.editable === false) return {ok:false, reason:'readonly'};
          const change = replacement(view.state.doc.toString(), expected, oldHead, newHead);
          if (!change.ok) return change;
          view.dispatch({changes:{from:change.from, to:change.to, insert:change.insert}});
          return {ok:true};
        });
      } else {
        codeMirror.defineExtension('scholar__citationSnapshot', function() {
          if (this.getOption('readOnly')) return {ok:false, reason:'readonly'};
          return {ok:true, text:this.getValue(), head:this.indexFromPos(this.getCursor('head'))};
        });
        codeMirror.defineExtension('scholar__insertCitation', function(expected, expectedHead, reference, targetChange) {
          if (this.getOption('readOnly')) return {ok:false, reason:'readonly'};
          const result = citationChanges(this.getValue(), expected, this.indexFromPos(this.getCursor('head')), expectedHead, reference, targetChange);
          if (!result.ok) return result;
          this.operation(() => {
            for (const edit of [...result.changes].reverse()) this.replaceRange(edit.insert, this.posFromIndex(edit.from), this.posFromIndex(edit.to), '+scholarCitation');
            this.setCursor(this.posFromIndex(result.cursor));
          });
          this.focus();
          return {ok:true};
        });
        codeMirror.defineExtension('scholar__replaceMetadata', function(expected, oldHead, newHead) {
          if (this.getOption('readOnly')) return {ok:false, reason:'readonly'};
          const change = replacement(this.getValue(), expected, oldHead, newHead);
          if (!change.ok) return change;
          this.replaceRange(change.insert, {line:0, ch:0}, this.posFromIndex(change.to), '+scholarMetadata');
          return {ok:true};
        });
      }
    },
  }),
};
