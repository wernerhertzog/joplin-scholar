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

test('citation insertion labels a target and inserts at the cursor in one checked CodeMirror 6 transaction', () => {
  let text='![Chart](chart.png)\n\nSee ', head=text.length, dispatches=0;
  const commands = {};
  const view={editable:true,state:{doc:{toString:()=>text},selection:{main:{get head(){return head;}}}},focus:()=>{},dispatch:({changes,selection})=>{
    dispatches++;
    for (const edit of [...changes].reverse()) text=text.slice(0,edit.from)+edit.insert+text.slice(edit.to);
    head=selection.anchor;
  }};
  script.plugin({cm6:true,editor:view,registerCommand:(name,fn)=>{commands[name]=fn;}});
  const snapshot=commands.scholar__citationSnapshot(), target={from:19,to:19,insert:'{#fig:chart}'};
  assert.equal(snapshot.text,text);
  assert.deepEqual(commands.scholar__insertCitation(snapshot.text,snapshot.head,'Figure \\@ref(fig:chart)',target),{ok:true});
  assert.equal(dispatches,1);
  assert.equal(text,'![Chart](chart.png){#fig:chart}\n\nSee Figure \\@ref(fig:chart)');
  assert.equal(head,text.length);
  assert.deepEqual(commands.scholar__insertCitation(snapshot.text,snapshot.head,'Unsafe',target),{ok:false,reason:'changed'});
  const current=commands.scholar__citationSnapshot();
  assert.deepEqual(commands.scholar__insertCitation(current.text,current.head-1,'Unsafe',null),{ok:false,reason:'changed'});
  assert.equal(dispatches,1);
});

test('citation insertion also works with CodeMirror 5 and does not replace selected text', () => {
  let text='Heading\n\nText', head=text.length, operations=0;
  const commands={};
  script.plugin({defineExtension:(name,fn)=>{commands[name]=fn;}});
  const editor={getOption:()=>false,getValue:()=>text,getCursor:()=>head,indexFromPos:position=>position,posFromIndex:index=>index,focus:()=>{},setCursor:position=>{head=position;},operation:fn=>{operations++;fn();},replaceRange:(insert,from,to)=>{text=text.slice(0,from)+insert+text.slice(to);}};
  const snapshot=commands.scholar__citationSnapshot.call(editor);
  assert.deepEqual(commands.scholar__insertCitation.call(editor,snapshot.text,snapshot.head,' Section \\@ref(sec:heading)',{from:7,to:7,insert:' {#sec:heading}'}),{ok:true});
  assert.equal(text,'Heading {#sec:heading}\n\nText Section \\@ref(sec:heading)');
  assert.equal(head,text.length);
  assert.equal(operations,1);
});
