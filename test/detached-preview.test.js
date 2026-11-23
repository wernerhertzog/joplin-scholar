'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDetachedPreview } = require('../src/detached-preview');

test('detached preview opens a real window, updates, handles controls and restores the panel', {skip:!process.env.SCHOLAR_TEST_BROWSER}, async () => {
  const {chromium} = require('playwright-core');
  const root = path.join(__dirname, '..');
  const template = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8').match(/const panelHtml = `([\s\S]*?)`;/)[1];
  const html = new Function('styleLabels', 'documentStyles', 'logoData', 'return `' + template + '`')(require('../src/citation-styles').labels, require('../src/document-styles').documentStyles, '');
  const pdf = fs.readFileSync(path.join(root, 'examples/joplin-scholar-example.pdf')).toString('base64');
  let url, connected = 0, disconnected = 0;
  const messages = [];
  const detached = createDetachedPreview({html, directory:path.join(root,'dist'), open:async value=>{url=value;}, onConnect:async()=>{connected++;}, onDisconnect:async()=>{disconnected++;}, onMessage:async message=>{
    messages.push(message);
    if (message.type === 'ready') {
      detached.send({type:'authors', noteId:'n1', authors:[]});
      detached.send({type:'documentStyle', noteId:'n1', value:'default', overrides:[]});
      detached.send({type:'style', noteId:'n1', value:'default'});
      detached.send({type:'pdf', base64:pdf});
    }
    if (message.type === 'saveAuthors') detached.send({type:'authorsSaved', noteId:message.noteId, revision:message.revision});
  }});
  const browser = await chromium.launch({headless:true, executablePath:process.env.SCHOLAR_TEST_BROWSER});
  try {
    await detached.open();
    assert.equal((await fetch(url.replace(/\/[a-f0-9]{64}\//, '/wrong/'))).status, 404);
    assert.equal((await fetch(url+'message', {method:'POST', headers:{'Content-Type':'application/json','Origin':'https://evil.example'}, body:'{"type":"refresh"}'})).status, 404);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(url);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button',{name:'Open Scholar window'}).click()]);
    popup.on('pageerror', error=>errors.push(error.message));
    await popup.locator('.pdf-page canvas').first().waitFor({timeout:20000});
    assert.equal(connected, 1);
    assert.equal(detached.connected, true);
    assert.equal(await popup.locator('#status').textContent(), 'Preview up to date');
    assert.equal(await popup.locator('#document-style').isEnabled(), true);
    await popup.getByRole('button',{name:'Rebuild preview'}).click();
    await popup.waitForTimeout(100);
    assert.ok(messages.some(message=>message.type==='refresh'));
    await popup.locator('#document-style').selectOption('manuscript');
    await popup.waitForTimeout(100);
    assert.ok(messages.some(message=>message.type==='setDocumentStyle' && message.noteId==='n1' && message.value==='manuscript'));
    detached.send({type:'clear'});
    await popup.waitForFunction(()=>document.querySelectorAll('.pdf-page').length===0);
    detached.send({type:'pdf', base64:pdf});
    await popup.locator('.pdf-page canvas').first().waitFor({timeout:20000});
    await popup.getByRole('button',{name:'Authors', exact:true}).click();
    await popup.getByRole('button',{name:'Add author'}).click();
    await popup.locator('.author-name').fill('Alice');
    await popup.getByRole('button',{name:'Return to Joplin'}).click();
    assert.match(await popup.locator('#authors-status').textContent(), /Save your author changes/);
    await popup.getByRole('button',{name:'Save authors'}).click();
    await popup.waitForFunction(()=>document.querySelector('#authors-status').textContent === 'Authors saved.');
    await popup.getByRole('button',{name:'Return to Joplin'}).click();
    await popup.waitForEvent('close');
    for (let i=0; i<30 && !disconnected; i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(disconnected, 1);
    assert.equal(detached.connected, false);
    assert.deepEqual(errors, []);
  } finally { await detached.close(); await browser.close(); }
});

test('closing a disconnected preview restores the panel and expires its private connection', async () => {
  let url, restored = 0;
  const detached = createDetachedPreview({html:'', directory:__dirname, open:async value=>{url=value;}, onMessage:async()=>{}, onConnect:async()=>{}, onDisconnect:async started=>{if (started) restored++;}});
  try {
    await detached.open();
    const controller = new AbortController();
    const stream = await fetch(url+'events', {signal:controller.signal});
    assert.equal(stream.status, 200);
    assert.equal(detached.connected, true);
    controller.abort();
    for (let i=0; i<50 && !restored; i++) await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(restored, 1);
    assert.equal(detached.connected, false);
    const closedStatus = await fetch(url).then(response=>response.status, ()=>null);
    assert.ok(closedStatus === null || closedStatus === 404);
  } finally { await detached.close(); }
});

test('opens and restores the preview when timers return numeric handles', async () => {
  let url, restored = 0, nextId = 0;
  const callbacks = new Map();
  const timerApi = {
    setTimeout(callback) { const id = ++nextId; callbacks.set(id, callback); return id; },
    clearTimeout(id) { callbacks.delete(id); },
  };
  const detached = createDetachedPreview({html:'', directory:__dirname, timerApi, open:async value=>{url=value;}, onMessage:async()=>{}, onConnect:async()=>{}, onDisconnect:async started=>{if (started) restored++;}});
  try {
    await detached.open();
    assert.equal(callbacks.size, 1, 'the launcher expiry timer is scheduled');
    const controller = new AbortController();
    const stream = await fetch(url+'events', {signal:controller.signal});
    assert.equal(stream.status, 200);
    assert.equal(callbacks.size, 0, 'connecting cancels launcher expiry');
    controller.abort();
    for (let i=0; i<50 && !callbacks.size; i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(callbacks.size, 1, 'disconnect schedules the restore timer');
    callbacks.values().next().value();
    for (let i=0; i<50 && !restored; i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(restored, 1);
    assert.equal(detached.connected, false);
  } finally { await detached.close(); }
});

test('opens and cleans up using Chromium timer functions', {skip:!process.env.SCHOLAR_TEST_BROWSER}, async () => {
  const {chromium} = require('playwright-core');
  const browser = await chromium.launch({headless:true, executablePath:process.env.SCHOLAR_TEST_BROWSER});
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(__dirname, '../src/detached-preview.js'), 'utf8');
    const result = await page.evaluate(async source => {
      const server = {once() {}, listen(_port, _host, callback) { callback(); }, address() { return {port:12345}; }, close() { this.closed = true; }};
      const modules = {
        http:{createServer:()=>server},
        crypto:{randomBytes:()=>({toString:()=> 'secret'})},
        'fs/promises':{}, path:{}, './open-pdf':{openWithDefault:async()=>{}},
      };
      const module = {exports:{}};
      new Function('require','module','exports',source)(name=>modules[name], module, module.exports);
      let opened, disconnected = false;
      const preview = module.exports.createDetachedPreview({html:'', directory:'', onMessage:()=>{}, onConnect:()=>{}, onDisconnect:()=>{disconnected=true;}, open:async url=>{opened=url;}});
      await preview.open();
      await preview.close();
      return {opened, disconnected, closed:server.closed};
    }, source);
    assert.equal(result.opened, 'http://127.0.0.1:12345/secret/');
    assert.equal(result.disconnected, true);
    assert.equal(result.closed, true);
  } finally { await browser.close(); }
});
