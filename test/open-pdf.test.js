'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {openPdfSnapshot} = require('../src/open-pdf');

test('opens independent private PDF snapshots and cleans up failed opens', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-open-test-'));
  try {
    const content = Buffer.from('%PDF-test content');
    let opened;
    const file = await openPdfSnapshot(content, {parent, open:async value => {opened = value;}});
    assert.equal(opened, file);
    assert.deepEqual(await fs.readFile(file), content);
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const second = await openPdfSnapshot(Buffer.from('%PDF-new'), {parent, open:async()=>{}});
    assert.notEqual(file, second);
    assert.deepEqual(await fs.readFile(file), content);
    const count = (await fs.readdir(parent)).length;
    await assert.rejects(openPdfSnapshot(content, {parent, open:async()=>{throw new Error('no viewer');}}), /no viewer/);
    assert.equal((await fs.readdir(parent)).length, count);
    await assert.rejects(openPdfSnapshot(Buffer.from('invalid'), {parent}), /valid PDF/);
  } finally { await fs.rm(parent, {recursive:true, force:true}); }
});
