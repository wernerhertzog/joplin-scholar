'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Small real PDF with a different-sized page, generated without external tools.
function samplePdf(count) {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${count} /Kids [${Array.from({length:count}, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < count; i++) {
    const pageId = 4 + i * 2, contentId = pageId + 1;
    const box = '0 0 612 792', rotation = i === 9 ? '/Rotate 90' : '';
    const content = `BT /F1 18 Tf 60 500 Td (Page ${i + 1}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] ${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  }
  let pdf = '%PDF-1.4\n', offsets = [0];
  for (let id = 1; id < objects.length; id++) { offsets[id] = Buffer.byteLength(pdf); pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}

test('PDF preview scales immediately, scrolls normally and renders nearby pages', {skip: !process.env.SCHOLAR_TEST_BROWSER}, async () => {
  const {chromium} = require('playwright-core');
  const root = path.join(__dirname, '..');
  const template = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8').match(/setHtml\(panel, `([\s\S]*?)`\);/)[1];
  const html = new Function('styleLabels', 'documentStyles', 'logoData', 'return `' + template + '`')(require('../src/citation-styles').labels, require('../src/document-styles').documentStyles, fs.readFileSync(path.join(root, 'assets/icon-48.png')).toString('base64'));
  const browser = await chromium.launch({headless:true, executablePath:process.env.SCHOLAR_TEST_BROWSER});
  const page = await browser.newPage({viewport:{width:520, height:600}, deviceScaleFactor:2});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(html);
    await page.addStyleTag({content:fs.readFileSync(path.join(root, 'src/panel.css'), 'utf8')});
    assert.equal(await page.locator('.brand-icon').evaluate(image => image.naturalWidth), 48);
    await page.evaluate(() => { window.messages = []; window.webviewApi = {postMessage(message){window.messages.push(message);}, onMessage(fn){window.onPluginMessage = fn;}}; });
    await page.addScriptTag({content:fs.readFileSync(path.join(root, 'dist/worker.js'), 'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root, 'dist/panel.js'), 'utf8')});
    await page.getByRole('button', {name:'Example paper'}).click();
    assert.ok(await page.evaluate(() => window.messages.some(message => message.type === 'createExample')));
    assert.equal(await page.locator('#create-example').isDisabled(), true);
    await page.evaluate(() => window.onPluginMessage({type:'exampleError', message:'Select a notebook first.'}));
    assert.equal(await page.locator('#example-status').textContent(), 'Select a notebook first.');
    assert.equal(await page.locator('#create-example').isEnabled(), true);
    await page.evaluate(() => window.onPluginMessage({type:'documentStyle', noteId:'n1', value:'default', overrides:[], customTemplate:false}));
    await page.locator('#document-style').selectOption('manuscript');
    assert.ok(await page.evaluate(() => window.messages.some(message => message.type === 'setDocumentStyle' && message.noteId === 'n1' && message.value === 'manuscript')));
    await page.evaluate(() => window.onPluginMessage({type:'documentStyle', noteId:'n1', value:'manuscript', overrides:['fontsize'], customTemplate:true}));
    assert.match(await page.locator('#document-style-status').textContent(), /YAML overrides: fontsize/);
    assert.match(await page.locator('#document-style-status').textContent(), /custom template/);
    await page.evaluate(() => window.onPluginMessage({type:'paperChanged'}));
    assert.equal(await page.locator('#document-style').isDisabled(), true);
    const exportControl = page.locator('#export-menu summary');
    assert.equal(await page.locator('#export-pdf').isVisible(), false);
    await exportControl.click();
    await page.locator('#export-pdf').click();
    assert.ok(await page.evaluate(() => window.messages.some(message => message.type === 'export' && message.format === 'pdf')));
    assert.equal(await page.locator('#export-pdf').isVisible(), false);
    await exportControl.click();
    await page.locator('#export-tex').click();
    assert.ok(await page.evaluate(() => window.messages.some(message => message.type === 'export' && message.format === 'tex')));
    await exportControl.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#export-menu').evaluate(element => element.open), false);
    const pdf = samplePdf(20);
    await page.evaluate(base64 => window.onPluginMessage({type:'pdf', base64}), pdf);
    await page.locator('.pdf-page canvas').first().waitFor({timeout:15000});
    await page.locator('.pdf-page .textLayer span').first().waitFor({timeout:15000});
    const text = page.locator('.pdf-page .textLayer span').first();
    assert.equal(await text.textContent(), 'Page 1');
    const textBox = await text.boundingBox();
    await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(textBox.x + textBox.width - 1, textBox.y + textBox.height / 2, {steps:8});
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'Page 1', 'the visible PDF text can be selected');
    await page.getByRole('button', {name:'Open PDF'}).click();
    assert.ok(await page.evaluate(() => window.messages.some(message => message.type === 'openPdf')));
    assert.equal(await page.locator('.pdf-page').count(), 20);
    assert.ok(await page.locator('.pdf-page canvas').count() < 10, 'initial rendering should not draw the whole document');
    const initial = await page.evaluate(() => { const e=document.querySelector('.pdf-page'); return {width:e.getBoundingClientRect().width, bitmap:e.querySelector('canvas').width}; });
    const zoomed = await page.evaluate(() => {
      const e=document.querySelector('.pdf-page'), p=document.querySelector('#preview'), r=e.getBoundingClientRect();
      const x=r.left+r.width/2, y=r.top+Math.min(180,r.height/2), before=(y-r.top)/r.height;
      p.dispatchEvent(new WheelEvent('wheel', {deltaY:-180, shiftKey:true, bubbles:true, cancelable:true, clientX:x, clientY:y}));
      const after=e.getBoundingClientRect();
      return {width:after.width, bitmap:e.querySelector('canvas').width, anchorBefore:before, anchorAfter:(y-after.top)/after.height};
    });
    assert.ok(zoomed.width > initial.width * 1.1, 'zoom changes the page size synchronously');
    assert.equal(zoomed.bitmap, initial.bitmap, 'the existing bitmap remains visible during zoom');
    assert.ok(Math.abs(zoomed.anchorBefore - zoomed.anchorAfter) < .02, 'zoom should stay centered on the pointer');
    const horizontalZoom = await page.evaluate(() => {
      const p=document.querySelector('#preview'), before=document.querySelector('#zoom-fit').textContent;
      p.dispatchEvent(new WheelEvent('wheel', {deltaX:-100, deltaY:-.1, shiftKey:true, bubbles:true, cancelable:true, clientX:250, clientY:300}));
      return {before, after:document.querySelector('#zoom-fit').textContent};
    });
    assert.ok(parseInt(horizontalZoom.after, 10) - parseInt(horizontalZoom.before, 10) > 5, 'dominant horizontal movement should control Shift-zoom on macOS');
    const heldShiftZoom = await page.evaluate(() => {
      const p=document.querySelector('#preview'), before=document.querySelector('#zoom-fit').textContent;
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift'}));
      p.dispatchEvent(new WheelEvent('wheel', {deltaX:-60, deltaY:0, bubbles:true, cancelable:true, clientX:250, clientY:300}));
      window.dispatchEvent(new KeyboardEvent('keyup', {key:'Shift'}));
      return {before, after:document.querySelector('#zoom-fit').textContent};
    });
    assert.notEqual(heldShiftZoom.after, heldShiftZoom.before, 'a held Shift key is recognized even if a wheel event omits its modifier');
    await page.waitForFunction(width => document.querySelector('.pdf-page canvas')?.width > width, initial.bitmap, {timeout:15000});
    const zoom = await page.locator('#zoom-fit').textContent();
    await page.mouse.move(250, 300);
    const top = await page.locator('#preview').evaluate(e => e.scrollTop);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(value => document.querySelector('#preview').scrollTop > value, top);
    assert.equal(await page.locator('#zoom-fit').textContent(), zoom, 'normal wheel should scroll without zooming');
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -80);
    await page.waitForFunction(value => document.querySelector('#zoom-fit').textContent !== value, zoom);
    await page.keyboard.up('Shift');
    await page.evaluate(() => {const p=document.querySelector('#preview'); for(let i=0;i<12;i++) p.dispatchEvent(new WheelEvent('wheel',{deltaY:-10, shiftKey:true, bubbles:true, cancelable:true, clientX:250, clientY:300}));});
    const target = await page.locator('#zoom-fit').textContent();
    await page.waitForFunction(expected => {
      const canvas = [...document.querySelectorAll('.pdf-page canvas')].find(e => {const r=e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;});
      return document.querySelector('#zoom-fit').textContent === expected && canvas && Math.abs(canvas.width / canvas.getBoundingClientRect().width - 2) < .02;
    }, target, {timeout:15000});
    const landscape = page.locator('.pdf-page').nth(9);
    await landscape.scrollIntoViewIfNeeded();
    await landscape.locator('canvas').waitFor({timeout:15000});
    const rect = await landscape.boundingBox();
    assert.ok(rect.width > rect.height, 'the page uses its own dimensions');
    await landscape.locator('.textLayer span').first().waitFor({timeout:15000});
    assert.equal(await landscape.locator('.textLayer').getAttribute('data-main-rotation'), '90');
    const rotatedText = landscape.locator('.textLayer span').first();
    await rotatedText.scrollIntoViewIfNeeded();
    const rotatedBox = await rotatedText.boundingBox();
    await page.mouse.move(rotatedBox.x + rotatedBox.width / 2, rotatedBox.y + 1);
    await page.mouse.down();
    await page.mouse.move(rotatedBox.x + rotatedBox.width / 2, rotatedBox.y + rotatedBox.height - 1, {steps:8});
    await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'Page 10', 'text on rotated pages can be selected');
    await page.locator('#preview').evaluate(e => {e.scrollTop=e.scrollHeight;});
    await page.locator('.pdf-page').last().locator('canvas').waitFor({timeout:15000});
    assert.ok(await page.locator('.pdf-page canvas').count() <= 8, 'far-away bitmaps should be released');
    await page.evaluate(base64 => window.onPluginMessage({type:'pdf', base64}), pdf);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Preview up to date', null, {timeout:15000});
    assert.ok(await page.locator('#preview').evaluate(e => e.scrollTop) > 0, 'refresh preserves the reading position');
    await page.evaluate(() => window.onPluginMessage({type:'pdf', base64:'bm90IGEgcGRm'}));
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Could not display'), null, {timeout:15000});
    assert.equal(await page.locator('.pdf-page').count(), 20, 'failed replacement keeps the last successful preview');
    await page.evaluate(base64 => {window.onPluginMessage({type:'pdf', base64}); window.onPluginMessage({type:'clear'});}, pdf);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.pdf-page').count(), 0, 'a stale load must not restore a cleared note');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
