'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chooseCitation, copyCitation, exportBibliography } = require('../src/zotero');

async function withPicker(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/better-bibtex/cayw`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('opens the Better BibTeX picker and preserves multi-item Pandoc citations', async () => {
  const seen = [];
  await withPicker((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'); seen.push(url.searchParams);
    response.writeHead(200, {'Content-Type':'text/plain'});
    response.end(url.searchParams.has('probe') ? 'ready' : '[@smith2023, p. 42; @doe2020]');
  }, async base => {
    assert.equal(await chooseCitation(base), '[@smith2023, p. 42; @doe2020]');
    assert.equal(seen[0].get('probe'), '1');
    assert.equal(seen[1].get('format'), 'pandoc');
    assert.equal(seen[1].get('brackets'), '1');
  });
});

test('retrieves cited records with Better BibTeX JSON-RPC and reports missing keys', async () => {
  let requestBody;
  await withPicker((request, response) => {
    let body = '';
    request.setEncoding('utf8'); request.on('data', part => body += part);
    request.on('end', () => { requestBody = JSON.parse(body); response.writeHead(200, {'Content-Type':'application/json'}); response.end(JSON.stringify({jsonrpc:'2.0', id:1, result:'@book{smith2023, title={Example}}'})); });
  }, async endpoint => {
    const bib = await exportBibliography(['smith2023'], '42', endpoint);
    assert.match(bib, /smith2023/);
    assert.deepEqual(requestBody, {jsonrpc:'2.0', id:1, method:'item.export', params:[['smith2023'], 'Better BibLaTeX', 42]});
  });
  await withPicker((request, response) => { request.resume(); response.writeHead(200); response.end(JSON.stringify({jsonrpc:'2.0', id:1, error:{code:-32602, message:'not found: missing'}})); }, async endpoint => {
    await assert.rejects(exportBibliography(['missing'], '', endpoint), /not found: missing/);
  });
  await assert.rejects(exportBibliography(['x'], 'not-a-number'), /must be a number/);
});

test('cancel, missing Better BibTeX, and unexpected responses never return a citation', async () => {
  let clipboard = 'existing clipboard';
  const target = { writeText: async value => { clipboard = value; } };
  await withPicker((request, response) => {
    response.writeHead(200); response.end(request.url.includes('probe=') ? 'ready' : '');
  }, async base => { assert.equal(await copyCitation(target, base), null); assert.equal(clipboard, 'existing clipboard'); });
  await withPicker((request, response) => {
    response.writeHead(200); response.end(request.url.includes('probe=') ? 'ready' : '[@smith2023]');
  }, async base => { assert.equal(await copyCitation(target, base), '[@smith2023]'); assert.equal(clipboard, '[@smith2023]'); });
  await withPicker((_request, response) => { response.writeHead(404); response.end('Not found'); }, async base => {
    await assert.rejects(chooseCitation(base), /Better BibTeX/);
  });
  await withPicker((request, response) => { response.writeHead(200); response.end(request.url.includes('probe=') ? 'ready' : '<html>Not a citation</html>'); }, async base => {
    await assert.rejects(chooseCitation(base), /unexpected citation/);
  });
});

test('an unreachable Zotero picker explains how to reconnect', async () => {
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  await assert.rejects(chooseCitation(`http://127.0.0.1:${port}/better-bibtex/cayw`),/Start Zotero.*Better BibTeX/);
});
