'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

test('packages the manifest icons used by the Joplin plugin directory', async () => {
  const root=path.join(__dirname,'..');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'publish/joplin-scholar.json'),'utf8'));
  const archive=require('node:child_process').execFileSync('tar',['-tf',path.join(root,'publish/joplin-scholar.jpl')],{encoding:'utf8'}).split('\n');
  for (const size of [16,32,48,128]) {
    const file=manifest.icons[String(size)];
    assert.ok(archive.includes(file), `Missing ${file} from plugin archive`);
    const png=await fs.readFile(path.join(root,'dist',file));
    assert.equal(png.readUInt32BE(16),size); assert.equal(png.readUInt32BE(20),size);
  }
});

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
  let callbacks = {}, sent = [], note = { id: 'a', title: 'First', body: 'Text' }, start, clipboard = '', panelHtml = '', panelVisible = true;
  const commands = {}, toolbarButtons = [], cssFiles = [];
  const authorData = new Map(), migratedData = new Map(), styleData = new Map(), documentStyleData = new Map(), documentOptionsData = new Map();
  const storeFor = key => key.endsWith('authors-migrated') ? migratedData : key.endsWith('citation-style') ? styleData : key.endsWith('document-style') ? documentStyleData : key.endsWith('document-options') ? documentOptionsData : authorData;
  global.joplin = {
    plugins: { register: x => { start = x.onStart; }, installationDir:async()=>path.join(__dirname,'../dist') },
    contentScripts:{register:async()=>{}},
    settings: { registerSection: async()=>{}, registerSettings: async()=>{}, values: async()=>({ pandoc:fake, engine:'xelatex', delay:500 }), onChange: async fn=>{callbacks.settings=fn;} },
    views: { panels: { create:async()=> 'p', setHtml:async(_,html)=>{panelHtml=html;}, addScript:async()=>{}, postMessage:(_,m)=>sent.push(m), onMessage:async(_,fn)=>{callbacks.message=fn;}, visible:async()=>panelVisible, show:async(_,value)=>{panelVisible=value;} }, menuItems: {create:async()=>{}}, toolbarButtons:{create:async(...args)=>toolbarButtons.push(args)}, dialogs: {showOpenDialog:async()=>[root]} },
    window:{loadChromeCssFile:async file=>cssFiles.push(file)},
    commands: {register:async command=>{commands[command.name]=command;}, execute:async(command,opts)=>{if(command==='editor.execCommand'){const [expected,oldHead,newHead]=opts.args;if(note.body!==expected)return {ok:false,reason:'changed'};note.body=newHead+note.body.slice(oldHead.length);return {ok:true};}}}, data:{ userDataGet:async(_t,id,key)=>storeFor(key).get(id), userDataSet:async(_t,id,key,value)=>storeFor(key).set(id,value) }, clipboard:{writeText:async value=>{clipboard=value;}},
    workspace:{ selectedNote:async()=>({...note}), onNoteChange:async fn=>{callbacks.change=fn;}, onNoteSelectionChange:async fn=>{callbacks.selection=fn;} },
  };
  try {
    delete require.cache[require.resolve('../dist/index.js')]; require('../dist/index.js'); await start();
    assert.ok(panelHtml.indexOf('id="citation-style"') > panelHtml.indexOf('class="status-row"'));
    assert.ok(panelHtml.indexOf('id="document-style"') < panelHtml.indexOf('id="citation-style"'));
    assert.match(panelHtml, /class="brand-icon" src="data:image\/png;base64,/);
    assert.doesNotMatch(panelHtml, /figure-panel/);
    assert.doesNotMatch(panelHtml, /table-panel/);
    assert.match(panelHtml, /Document options/);
    assert.deepEqual(toolbarButtons, [['toggleJoplinScholarToolbar', 'toggleJoplinScholar', 'noteToolbar']]);
    assert.equal(commands.toggleJoplinScholar.label, 'Toggle Joplin Scholar');
    assert.match(commands.toggleJoplinScholar.iconName, /scholar-toolbar-icon/);
    assert.equal(cssFiles[0], path.join(__dirname,'../dist/toolbar.css'));
    await commands.toggleJoplinScholar.execute();
    assert.equal(panelVisible, false);
    await commands.toggleJoplinScholar.execute();
    assert.equal(panelVisible, true);
    await callbacks.message({type:'ready'});
    await delay(200);
    note = {id:'b',title:'Second',body:'Different'}; callbacks.selection();
    for (let i=0; i<50 && !sent.some(m=>m.type==='pdf'); i++) await delay(100);
    assert.ok(sent.some(m=>m.type==='metadata' && m.noteId==='b' && m.metadata.fields.title==='Second' && m.metadata.titleFromNote));
    const previews = sent.filter(m=>m.type==='pdf');
    assert.equal(previews.length, 1); assert.equal(previews[0].title, 'Second');
    if (process.platform !== 'win32') {
      await callbacks.message({type:'openPdf'});
      openedSnapshot = await fs.readFile(recordFile, 'utf8');
      assert.equal(await fs.readFile(openedSnapshot, 'utf8'), '%PDF-FAKE');
      assert.ok(sent.some(message => message.type === 'pdfOpened'));
      await callbacks.message({type:'detach'});
      const detachedUrl = await fs.readFile(recordFile, 'utf8');
      const stream = await fetch(detachedUrl + 'events');
      assert.equal(stream.status, 200);
      for (let i=0; i<30 && panelVisible; i++) await delay(50);
      assert.equal(panelVisible, false);
      const count = sent.filter(m=>m.type==='pdf').length;
      callbacks.change();
      for (let i=0; i<50 && sent.filter(m=>m.type==='pdf').length===count; i++) await delay(100);
      assert.ok(sent.filter(m=>m.type==='pdf').length > count, 'edits compile while the main panel is hidden');
      await fetch(detachedUrl+'return', {method:'POST', headers:{Origin:new URL(detachedUrl).origin}});
      for (let i=0; i<30 && !panelVisible; i++) await delay(50);
      assert.equal(panelVisible, true);
      await stream.body.cancel();
    }
    const {inspectMetadata}=require('../src/metadata-editor');
    let metadata=inspectMetadata(note.body);
    await callbacks.message({type:'saveMetadata', noteId:'b', version:metadata.version, revision:1, authorsChanged:true, authors:[{name:'Alice', affiliations:['UZH'], email:'alice@example.org', corresponding:true},{name:'Bob',email:'bob@example.org',corresponding:true}]});
    assert.equal(require('../src/paper-data').markdownAuthors(note.body)[1].name, 'Bob');
    assert.equal(migratedData.get('b'), true);
    await callbacks.message({type:'saveMetadata', noteId:'a', revision:2, authors:[]});
    assert.ok(sent.some(m=>m.type==='metadataSaveError'));
    await callbacks.message({type:'copyFootnote', text:'A note'});
    assert.equal(clipboard, '{{fn: A note}}');
    await callbacks.message({type:'setStyle', noteId:'b', value:'apa'});
    assert.equal(styleData.get('b'), 'apa');
    await callbacks.message({type:'setStyle', noteId:'a', value:'ieee'});
    assert.equal(styleData.has('a'), false);
    await callbacks.message({type:'setDocumentStyle', noteId:'b', value:'manuscript'});
    assert.equal(documentStyleData.get('b'), 'manuscript');
    await callbacks.message({type:'setDocumentStyle', noteId:'a', value:'compact'});
    assert.equal(documentStyleData.has('a'), false);
    await callbacks.message({type:'setDocumentStyle', noteId:'b', value:'invalid'});
    assert.equal(documentStyleData.get('b'), 'manuscript');
    assert.ok(sent.some(m=>m.type==='documentStyleError'));
    assert.ok(sent.some(m=>m.type==='documentStyle' && m.noteId==='b' && m.value==='manuscript'));
    await callbacks.message({type:'setDocumentOptions', noteId:'b', value:{lineNumbers:'on',affiliations:'end',spacing:'double',sections:'on',paperSize:'a4'}});
    assert.equal(documentOptionsData.get('b').lineNumbers, 'on');
    await callbacks.message({type:'setDocumentOptions', noteId:'a', value:{lineNumbers:'on'}});
    assert.equal(documentOptionsData.has('a'), false);
    await callbacks.message({type:'setDocumentOptions', noteId:'b', value:{lineNumbers:'invalid'}});
    assert.equal(documentOptionsData.get('b').lineNumbers, 'on');
    callbacks.change();
    for (let i=0; i<50 && sent.filter(m=>m.type==='pdf').length<2; i++) await delay(100);
    assert.ok(sent.filter(m=>m.type==='pdf').length >= 2);
    await callbacks.message({ type:'export', format:'pdf' });
    assert.equal(await fs.readFile(path.join(root, 'Second', 'Second.pdf'), 'utf8'), '%PDF-FAKE');
    note.body = '---\nauthor: [Markdown Person]\n---\nBody';
    const previousPreviews = sent.filter(m=>m.type==='pdf').length;
    callbacks.change();
    for (let i=0; i<30 && !sent.some(m=>m.type==='metadata' && m.metadata?.authors[0]?.name==='Markdown Person'); i++) await delay(100);
    assert.ok(sent.some(m=>m.type==='metadata' && m.metadata?.authors[0]?.name==='Markdown Person'));
    metadata=inspectMetadata(note.body);
    note.body=note.body.replace('Markdown Person','Changed Person');
    await callbacks.message({type:'saveMetadata', noteId:'b', version:metadata.version, revision:3, authorsChanged:true, authors:[{name:'Should not overwrite'}]});
    assert.match(note.body,/Changed Person/);
    assert.ok(sent.some(m=>m.type==='metadataSaveError' && /metadata changed/.test(m.message)));
    for (let i=0; i<40 && sent.filter(m=>m.type==='pdf').length === previousPreviews; i++) await delay(100);
    assert.ok(sent.filter(m=>m.type==='pdf').length > previousPreviews);
    note.body = '---\ncsl: ieee\n---\nBody';
    await callbacks.message({type:'setStyle', noteId:'b', value:'apa'});
    assert.ok(sent.some(m=>m.type==='styleError' && /defined|YAML/.test(m.message)));
    note = {id:'legacy',title:'Legacy',body:'# Existing note\n\nKeep this text.'};
    authorData.set('legacy',[{name:'Old Author',affiliations:['Research Lab'],corresponding:true,email:'old@example.org'}]);
    callbacks.selection();
    for (let i=0; i<30 && !sent.some(m=>m.type==='metadata' && m.noteId==='legacy'); i++) await delay(50);
    const loaded=sent.findLast(m=>m.type==='metadata' && m.noteId==='legacy').metadata;
    assert.equal(loaded.legacy,true);
    await callbacks.message({type:'saveMetadata',noteId:'legacy',version:loaded.version,authors:loaded.authors,authorsChanged:false,revision:0});
    assert.match(note.body,/Old Author/);
    assert.match(note.body,/# Existing note\n\nKeep this text/);
    assert.equal(migratedData.get('legacy'),true);
    assert.equal(authorData.get('legacy')[0].name,'Old Author', 'the legacy backup remains intact');
    panelVisible=false;
    await delay(1200);
  } finally {
    delete global.joplin;
    process.env.PATH = oldPath;
    if (oldRecord === undefined) delete process.env.SCHOLAR_TEST_OPEN_RECORD; else process.env.SCHOLAR_TEST_OPEN_RECORD = oldRecord;
    if (openedSnapshot) await fs.rm(path.dirname(openedSnapshot), {recursive:true, force:true});
    await fs.rm(root, {recursive:true,force:true});
  }
});

test('creates and opens an example note with its own attachment, and handles failures', async () => {
  const sent = [], posts = [], deleted = [], opened = [], callbacks = {};
  const resourceId = '1234567890abcdef1234567890abcdef';
  let start, folder = {id:'notebook'}, failNote = false, failOpen = false;
  global.joplin = {
    plugins:{register:x=>{start=x.onStart;},installationDir:async()=>path.join(__dirname,'../dist')},
    contentScripts:{register:async()=>{}},
    settings:{registerSection:async()=>{},registerSettings:async()=>{},onChange:async()=>{}},
    views:{panels:{create:async()=> 'p',setHtml:async()=>{},addScript:async()=>{},postMessage:(_,m)=>sent.push(m),onMessage:async(_,fn)=>{callbacks.message=fn;}},menuItems:{create:async()=>{}},toolbarButtons:{create:async()=>{}}},
    window:{loadChromeCssFile:async()=>{}},
    commands:{register:async()=>{},execute:async(command,id)=>{opened.push([command,id]); if(failOpen) throw Error('navigation unavailable');}},
    data:{post:async(resource,_query,body,files)=>{
      posts.push({resource,body,files});
      if (resource[0] === 'resources') { assert.ok((await fs.stat(files[0].path)).size > 0); return {id:resourceId}; }
      if (failNote) throw Error('storage unavailable');
      return {id:'new-note'};
    },delete:async resource=>deleted.push(resource)},
    workspace:{selectedFolder:async()=>folder,onNoteChange:async()=>{},onNoteSelectionChange:async()=>{}},
  };
  try {
    delete require.cache[require.resolve('../dist/index.js')]; require('../dist/index.js'); await start();
    await callbacks.message({type:'createExample'});
    const created=posts.find(p=>p.resource[0]==='notes');
    assert.equal(created.body.parent_id,'notebook');
    assert.match(created.body.body, new RegExp(`!\\[A compact writing workflow[^\\]]*\\]\\(:/${resourceId}\\)`));
    assert.match(created.body.body, /bibliography: \[\]/);
    assert.match(created.body.body, /\\@ref\(eq:mean\)/);
    assert.deepEqual(opened[0],['openNote','new-note']);
    assert.ok(sent.some(m=>m.type==='exampleCreated'));
    folder=null; await callbacks.message({type:'createExample'});
    assert.ok(sent.some(m=>m.type==='exampleError' && /Select a notebook/.test(m.message)));
    folder={id:'notebook'}; failNote=true; await callbacks.message({type:'createExample'});
    assert.deepEqual(deleted,[['resources',resourceId]]);
    assert.ok(sent.some(m=>m.type==='exampleError' && /storage unavailable/.test(m.message)));
    failNote=false; failOpen=true; await callbacks.message({type:'createExample'});
    assert.ok(sent.some(m=>m.type==='exampleCreated' && /Open it from the note list/.test(m.message)));
    assert.equal(deleted.length,1);
  } finally { delete global.joplin; }
});
