'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

test('plugin rebuilds on edits, avoids stale note previews, and exports the selected note', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-plugin-'));
  const fake = path.join(root, 'pandoc');
  await fs.writeFile(fake, '#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = "--to=json" ]; then printf "{\\\"blocks\\\":[]}"; exit 0; fi; done\nsleep 1\nwhile [ "$1" != "-o" ]; do shift; done\nprintf "%%PDF-FAKE" > "$2"\n', { mode: 0o755 });
  const oldPath = process.env.PATH, oldRecord = process.env.SCHOLAR_TEST_OPEN_RECORD;
  const recordFile = path.join(root, 'opened-file');
  if (process.platform !== 'win32') {
    const opener = path.join(root, process.platform === 'darwin' ? 'open' : 'xdg-open');
    await fs.writeFile(opener, '#!/bin/sh\nprintf "%s" "$1" > "$SCHOLAR_TEST_OPEN_RECORD"\n', {mode:0o755});
    process.env.PATH = `${root}${path.delimiter}${oldPath}`;
    process.env.SCHOLAR_TEST_OPEN_RECORD = recordFile;
  }
  let openedSnapshot;
  let callbacks = {}, sent = [], note = { id: 'a', title: 'First', body: 'Text' }, start, clipboard = '', panelHtml = '';
  const authorData = new Map(), styleData = new Map();
  global.joplin = {
    plugins: { register: x => { start = x.onStart; } },
    settings: { registerSection: async()=>{}, registerSettings: async()=>{}, values: async()=>({ pandoc:fake, engine:'xelatex', delay:500 }), onChange: async fn=>{callbacks.settings=fn;} },
    views: { panels: { create:async()=> 'p', setHtml:async(_,html)=>{panelHtml=html;}, addScript:async()=>{}, postMessage:(_,m)=>sent.push(m), onMessage:async(_,fn)=>{callbacks.message=fn;}, visible:async()=>true, show:async()=>{} }, menuItems: {create:async()=>{}}, dialogs: {showOpenDialog:async()=>[root]} },
    commands: {register:async()=>{}}, data:{ userDataGet:async(_t,id,key)=>(key.endsWith('citation-style') ? styleData : authorData).get(id), userDataSet:async(_t,id,key,value)=>(key.endsWith('citation-style') ? styleData : authorData).set(id,value) }, clipboard:{writeText:async value=>{clipboard=value;}},
    workspace:{ selectedNote:async()=>({...note}), onNoteChange:async fn=>{callbacks.change=fn;}, onNoteSelectionChange:async fn=>{callbacks.selection=fn;} },
  };
  try {
    delete require.cache[require.resolve('../dist/index.js')]; require('../dist/index.js'); await start();
    assert.ok(panelHtml.indexOf('id="citation-style"') > panelHtml.indexOf('class="status-row"'));
    assert.doesNotMatch(panelHtml, /figure-panel/);
    await callbacks.message({type:'ready'});
    await delay(200);
    note = {id:'b',title:'Second',body:'Different'}; callbacks.selection();
    for (let i=0; i<50 && !sent.some(m=>m.type==='pdf'); i++) await delay(100);
    const previews = sent.filter(m=>m.type==='pdf');
    assert.equal(previews.length, 1); assert.equal(previews[0].title, 'Second');
    if (process.platform !== 'win32') {
      await callbacks.message({type:'openPdf'});
      openedSnapshot = await fs.readFile(recordFile, 'utf8');
      assert.equal(await fs.readFile(openedSnapshot, 'utf8'), '%PDF-FAKE');
      assert.ok(sent.some(message => message.type === 'pdfOpened'));
    }
    await callbacks.message({type:'saveAuthors', noteId:'b', revision:1, authors:[{name:'Alice', affiliations:['UZH'], email:'alice@example.org', corresponding:true}]});
    assert.equal(authorData.get('b')[0].name, 'Alice');
    await callbacks.message({type:'saveAuthors', noteId:'a', revision:2, authors:[{name:'Wrong note'}]});
    assert.equal(authorData.has('a'), false);
    assert.ok(sent.some(m=>m.type==='authorsSaveError'));
    await callbacks.message({type:'copyFootnote', text:'A note'});
    assert.equal(clipboard, '{{fn: A note}}');
    await callbacks.message({type:'setStyle', noteId:'b', value:'apa'});
    assert.equal(styleData.get('b'), 'apa');
    await callbacks.message({type:'setStyle', noteId:'a', value:'ieee'});
    assert.equal(styleData.has('a'), false);
    await callbacks.message({type:'copyTable', rows:[['Name','Value'],['A','10']], caption:'Results'});
    assert.match(clipboard, /Table: Results/);
    callbacks.change();
    for (let i=0; i<50 && sent.filter(m=>m.type==='pdf').length<2; i++) await delay(100);
    assert.equal(sent.filter(m=>m.type==='pdf').length, 2);
    await callbacks.message({ type:'export', format:'pdf' });
    assert.equal(await fs.readFile(path.join(root, 'Second', 'Second.pdf'), 'utf8'), '%PDF-FAKE');
    note.body = '---\nauthor: [Markdown Person]\n---\nBody';
    const previousPreviews = sent.filter(m=>m.type==='pdf').length;
    callbacks.change();
    for (let i=0; i<30 && !sent.some(m=>m.type==='authors' && m.source==='markdown'); i++) await delay(100);
    assert.ok(sent.some(m=>m.type==='authors' && m.source==='markdown' && m.authors[0].name==='Markdown Person'));
    await callbacks.message({type:'saveAuthors', noteId:'b', revision:3, authors:[{name:'Should not overwrite'}]});
    assert.equal(authorData.get('b')[0].name, 'Alice');
    assert.ok(sent.some(m=>m.type==='authorsSaveError' && /defined in Markdown/.test(m.message)));
    for (let i=0; i<40 && sent.filter(m=>m.type==='pdf').length === previousPreviews; i++) await delay(100);
    assert.ok(sent.filter(m=>m.type==='pdf').length > previousPreviews);
    note.body = '---\ncsl: ieee\n---\nBody';
    await callbacks.message({type:'setStyle', noteId:'b', value:'apa'});
    assert.ok(sent.some(m=>m.type==='styleError' && /defined|YAML/.test(m.message)));
  } finally {
    delete global.joplin;
    process.env.PATH = oldPath;
    if (oldRecord === undefined) delete process.env.SCHOLAR_TEST_OPEN_RECORD; else process.env.SCHOLAR_TEST_OPEN_RECORD = oldRecord;
    if (openedSnapshot) await fs.rm(path.dirname(openedSnapshot), {recursive:true, force:true});
    await fs.rm(root, {recursive:true,force:true});
  }
});
