'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const script=require('../src/metadata-codemirror').default();

test('CodeMirror 6 only changes a matching live note and supports undoable editor transactions', () => {
  let text='---\ntitle: Old\n---\nBody', command;
  const view={editable:true,state:{doc:{toString:()=>text}},dispatch:({changes})=>{text=text.slice(0,changes.from)+changes.insert+text.slice(changes.to);}};
  script.plugin({cm6:true,editor:view,registerCommand:(_name,fn)=>{command=fn;}});
  const original=text, oldHead='---\ntitle: Old\n---\n', newHead='---\ntitle: New\n---\n';
  assert.deepEqual(command(original,oldHead,newHead),{ok:true});
  assert.equal(text,newHead+'Body');
  assert.deepEqual(command(original,oldHead,newHead),{ok:false,reason:'changed'});
  view.editable=false;
  assert.deepEqual(command(text,newHead,oldHead),{ok:false,reason:'readonly'});
});

test('CodeMirror 5 extension refuses stale and read-only notes', () => {
  let command, text='Body', readOnly=false;
  script.plugin({defineExtension:(_name,fn)=>{command=fn;}});
  const editor={getOption:()=>readOnly,getValue:()=>text,posFromIndex:i=>i,replaceRange:(insert,_from,to)=>{text=insert+text.slice(to);}};
  assert.deepEqual(command.call(editor,'Body','','---\ntitle: Test\n---\n'),{ok:true});
  assert.equal(text,'---\ntitle: Test\n---\nBody');
  assert.deepEqual(command.call(editor,'Body','',''),{ok:false,reason:'changed'});
  readOnly=true;
  assert.deepEqual(command.call(editor,text,'',''),{ok:false,reason:'readonly'});
});
