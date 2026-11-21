'use strict';
const http = require('http');

// Cite As You Write runs on the user's computer; never send library data online.
const DEFAULT_BASE = 'http://127.0.0.1:23119/better-bibtex/cayw';
const DEFAULT_RPC = 'http://127.0.0.1:23119/better-bibtex/json-rpc';
function exportBibliography(keys, libraryId = '', endpoint = DEFAULT_RPC) {
  if (!Array.isArray(keys) || !keys.length) return Promise.resolve('');
  if (libraryId && !/^\d+$/.test(libraryId)) return Promise.reject(new Error('The Zotero library ID must be a number.'));
  const params = [keys, 'Better BibLaTeX'];
  if (libraryId) params.push(Number(libraryId));
  const body = JSON.stringify({jsonrpc:'2.0', id:1, method:'item.export', params});
  return new Promise((resolve, reject) => {
    const request = http.request(endpoint, {method:'POST', headers:{'Content-Type':'application/json', 'Accept':'application/json', 'Content-Length':Buffer.byteLength(body)}}, response => {
      let text = '', tooLarge = false;
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; if (text.length > 20 * 1024 * 1024 && !tooLarge) { tooLarge = true; response.destroy(new Error('Zotero returned an unexpectedly large bibliography.')); } });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Zotero bibliography lookup returned HTTP ${response.statusCode}. Check that Better BibTeX is installed and enabled.`));
        try {
          const result = JSON.parse(text);
          if (result.error) return reject(new Error(`Zotero could not find the cited sources: ${result.error.message || 'unknown error'}`));
          if (result.id !== 1 || typeof result.result !== 'string' || !result.result.trim()) return reject(new Error('Zotero returned an invalid or empty bibliography.'));
          resolve(result.result);
        } catch { reject(new Error('Zotero returned an invalid bibliography response.')); }
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error('Zotero bibliography lookup timed out.')));
    request.on('error', error => {
      if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') reject(new Error('Start Zotero and enable Better BibTeX to load the references directly.'));
      else reject(error);
    });
    request.end(body);
  });
}
function requestPicker(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Accept: 'text/plain' } }, response => {
      let text = '', tooLarge = false;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        if (text.length > 65536 && !tooLarge) { tooLarge = true; response.destroy(new Error('Zotero returned an unexpectedly large response.')); }
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Zotero picker returned HTTP ${response.statusCode}. Check that Better BibTeX is installed and enabled.`));
        resolve(text.trim());
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('The Zotero picker timed out. Please try again.')));
    request.on('error', error => {
      if (error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH') reject(new Error('Start Zotero and install or enable the Better BibTeX plugin, then try again.'));
      else reject(error);
    });
  });
}
async function chooseCitation(base = DEFAULT_BASE) {
  const probe = new URL(base); probe.searchParams.set('probe', '1');
  const state = await requestPicker(probe, 5000);
  if (state.toLowerCase() !== 'ready') throw new Error('The Better BibTeX citation picker is not ready. Check that the plugin is installed and enabled in Zotero.');
  const url = new URL(base); url.searchParams.set('format', 'pandoc'); url.searchParams.set('brackets', '1');
  const citation = await requestPicker(url, 5 * 60 * 1000);
  if (!citation) return null;
  if (!/^\[[^\r\n]*@[^\r\n]*\]$/.test(citation)) throw new Error('Zotero returned an unexpected citation. No text was copied.');
  return citation;
}
async function copyCitation(clipboard, base = DEFAULT_BASE) {
  const citation = await chooseCitation(base);
  if (citation) await clipboard.writeText(citation);
  return citation;
}
module.exports = { chooseCitation, copyCitation, requestPicker, exportBibliography, DEFAULT_BASE, DEFAULT_RPC };
