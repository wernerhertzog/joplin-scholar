'use strict';

// Replace only the front matter in the live editor, atomically checking the
// entire document first. Joplin's selectedNote API can lag behind unsaved text.
function replacement(text, expected, oldHead, newHead) {
  if (typeof text !== 'string' || text !== expected || !text.startsWith(oldHead)) return {ok:false, reason:'changed'};
  return {ok:true, from:0, to:oldHead.length, insert:newHead};
}

module.exports = {
  default: () => ({
    plugin: codeMirror => {
      if (codeMirror.cm6) {
        codeMirror.registerCommand('scholar__replaceMetadata', (expected, oldHead, newHead) => {
          const view = codeMirror.editor;
          if (!view || view.editable === false) return {ok:false, reason:'readonly'};
          const change = replacement(view.state.doc.toString(), expected, oldHead, newHead);
          if (!change.ok) return change;
          view.dispatch({changes:{from:change.from, to:change.to, insert:change.insert}});
          return {ok:true};
        });
      } else {
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
