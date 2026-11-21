'use strict';
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

async function openWithDefault(file) {
  if (process.platform === 'darwin') await run('open', [file]);
  else if (process.platform === 'win32') await run('explorer.exe', [file]);
  else await run('xdg-open', [file]);
}

// A separate private snapshot is kept in the system temp directory so that a
// viewer can continue to read it after the command returns or the note changes.
async function openPdfSnapshot(bytes, {parent = os.tmpdir(), open = openWithDefault} = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('No valid PDF preview is available yet.');
  const dir = await fs.mkdtemp(path.join(parent, 'joplin-scholar-preview-'));
  const file = path.join(dir, 'Joplin Scholar Preview.pdf');
  try {
    await fs.writeFile(file, bytes, {mode:0o600});
    await open(file);
    return file;
  } catch (error) { await fs.rm(dir, {recursive:true, force:true}); throw error; }
}
module.exports = { openPdfSnapshot, openWithDefault };
