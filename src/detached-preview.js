'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { openWithDefault } = require('./open-pdf');

// This server belongs to one preview session. It never exposes Joplin's API;
// only the same messages accepted by the Scholar panel cross the bridge.
function createDetachedPreview({html, directory, onMessage, onConnect, onDisconnect, open = openWithDefault, timerApi = {setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args)}}) {
  const token = crypto.randomBytes(32).toString('hex');
  const prefix = `/${token}/`;
  const clients = new Set();
  let server, origin, disconnectTimer, expiryTimer, started = false, ended = false;
  const allowed = new Set(['ready','refresh','openPdf','export','createExample','setDocumentStyle','setStyle','copyTable','saveAuthors','pickCitation','copyFootnote']);
  const assets = {'panel.css':'text/css; charset=utf-8', 'panel.js':'text/javascript; charset=utf-8', 'worker.js':'text/javascript; charset=utf-8'};
  const bridge = `window.scholarDetached = true;
  let listener = () => {}, connected = false, pending = [];
  const events = new EventSource('events');
  const post = message => fetch('message', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(message)}).catch(() => {});
  events.onopen = () => { connected = true; const queued = pending; pending = []; if (!queued.some(message => message.type === 'ready')) queued.unshift({type:'ready'}); for (const message of queued) void post(message); };
  events.onmessage = event => { try { listener(JSON.parse(event.data)); } catch (error) { console.error(error); } };
  events.onerror = () => { connected = false; const s = document.querySelector('#status'); if (s) s.textContent = 'Connection lost. Reconnecting…'; };
  window.webviewApi = { onMessage(fn) { listener = fn; }, postMessage(message) {
    if (connected) return post(message); pending.push(message);
  }};
  window.scholarReturn = () => { fetch('return', {method:'POST'}).finally(() => window.close()); };`;
  const launcher = `document.querySelector('button').addEventListener('click', () => {
    const popup = window.open('view', 'joplin-scholar-preview', 'popup,width=1000,height=800');
    const status = document.querySelector('[role=status]');
    if (!popup) { status.textContent = 'Your browser blocked the window. Allow pop-ups and try again.'; return; }
    status.textContent = 'Scholar opened in a separate window. You can close this tab.';
    popup.focus();
  });`;
  const header = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const page = (body, scripts) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Joplin Scholar</title><link rel="stylesheet" href="panel.css"></head><body>${body}${scripts.map(src => `<script src="${src}"></script>`).join('')}</body></html>`;
  const finish = async () => {
    if (ended) return;
    ended = true; timerApi.clearTimeout(disconnectTimer); timerApi.clearTimeout(expiryTimer);
    for (const client of clients) client.end();
    clients.clear();
    server?.close();
    await onDisconnect(started);
  };
  async function serve(req, res) {
    const reply = (code, type, body) => { res.writeHead(code, {...header, 'Content-Type':type}); res.end(body); };
    const reject = () => reply(404, 'text/plain', 'Not found');
    if (ended || req.headers.host !== new URL(origin).host || !req.url?.startsWith(prefix)) return reject();
    if (req.headers.origin && req.headers.origin !== origin) return reject();
    const route = req.url.slice(prefix.length);
    if (req.method === 'GET' && route === '') return reply(200, 'text/html; charset=utf-8', page('<main class="app"><h1>Joplin Scholar</h1><p>Open the live preview in its own window, then move it wherever you like.</p><p><button type="button">Open Scholar window</button></p><p role="status"></p></main>', ['launcher.js']));
    if (req.method === 'GET' && route === 'view') return reply(200, 'text/html; charset=utf-8', page(html, ['bridge.js','worker.js','panel.js']));
    if (req.method === 'GET' && route === 'bridge.js') return reply(200, 'text/javascript; charset=utf-8', bridge);
    if (req.method === 'GET' && route === 'launcher.js') return reply(200, 'text/javascript; charset=utf-8', launcher);
    if (req.method === 'GET' && Object.hasOwn(assets, route)) {
      try { return reply(200, assets[route], await fs.readFile(path.join(directory, route))); } catch (_) { return reject(); }
    }
    if (req.method === 'GET' && route === 'events') {
      timerApi.clearTimeout(disconnectTimer); timerApi.clearTimeout(expiryTimer);
      res.writeHead(200, {...header, 'Content-Type':'text/event-stream', 'Connection':'keep-alive'});
      res.write(': connected\n\n'); clients.add(res);
      if (!started) { started = true; Promise.resolve(onConnect()).catch(() => {}); }
      req.on('close', () => { clients.delete(res); if (!clients.size && !ended) { disconnectTimer = timerApi.setTimeout(() => void finish(), 3000); disconnectTimer?.unref?.(); } });
      return;
    }
    if (req.method === 'POST' && route === 'return' && req.headers.origin === origin) { reply(200, 'text/plain', 'OK'); void finish(); return; }
    if (req.method === 'POST' && route === 'message' && req.headers.origin === origin && /^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
      let data = '', tooLarge = false;
      for await (const chunk of req) { data += chunk; if (data.length > 1024 * 1024) { tooLarge = true; break; } }
      if (tooLarge) return reply(413, 'text/plain', 'Too large');
      try {
        const message = JSON.parse(data);
        if (!message || !allowed.has(message.type)) return reject();
        reply(200, 'text/plain', 'OK');
        Promise.resolve(onMessage(message)).catch(() => {});
      } catch (_) { return reject(); }
      return;
    }
    return reject();
  }
  return {
    get connected() { return started && !ended; },
    send(message) { const data = `data: ${JSON.stringify(message)}\n\n`; for (const client of clients) client.write(data); },
    async open() {
      try {
        if (!server) {
          server = http.createServer((req, res) => { void serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
          await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
          origin = `http://127.0.0.1:${server.address().port}`;
          expiryTimer = timerApi.setTimeout(() => void finish(), 120000); expiryTimer?.unref?.();
        }
        await open(origin + prefix);
      } catch (error) { await finish(); throw error; }
    },
    close:finish,
  };
}
module.exports = { createDetachedPreview };
