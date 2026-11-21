'use strict';

// Keep the document open and retain the last bitmap while resizing it in CSS.
// Only pages close to the viewport need a new high-resolution bitmap.
class PdfPreview {
  constructor({element, getDocument, TextLayer, onError, onReady}) {
    this.element = element;
    this.getDocument = getDocument;
    this.TextLayer = TextLayer;
    this.onError = onError;
    this.onReady = onReady;
    this.zoom = 1;
    this.state = null;
    this.loadId = 0;
    this.loading = null;
    this.timer = null;
    this.deferUntil = 0;
    this.element.addEventListener('scroll', () => this.schedule(25), {passive:true});
  }

  cancelPendingLoad() {
    this.loadId++;
    const task = this.loading;
    this.loading = null;
    if (task) void task.destroy().catch(() => {});
  }

  cancelPaints(state) {
    if (!state) return;
    for (const page of state.pages) {
      page.token++;
      if (page.task) page.task.cancel();
    }
  }

  cancelText(state) {
    if (!state) return;
    for (const page of state.pages) {
      page.textToken++;
      if (page.textTask) page.textTask.cancel();
    }
  }

  clear() {
    this.cancelPendingLoad();
    clearTimeout(this.timer);
    const old = this.state;
    this.state = null;
    if (old) { this.cancelPaints(old); this.cancelText(old); void old.doc.destroy().catch(() => {}); }
    this.element.innerHTML = '<div id="placeholder">Your typeset paper will appear here.</div>';
  }

  async load(base64) {
    this.cancelPendingLoad();
    const id = this.loadId;
    let task;
    try {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      task = this.getDocument({data:bytes, isEvalSupported:false});
      this.loading = task;
      const doc = await task.promise;
      const first = await doc.getPage(1);
      if (id !== this.loadId) { void doc.destroy().catch(() => {}); return; }
      this.loading = null;
      const firstSize = first.getViewport({scale:1});
      const old = this.state;
      const top = this.element.scrollTop, left = this.element.scrollLeft;
      if (old) { this.cancelPaints(old); this.cancelText(old); }
      const state = {doc, pages:[], running:0, ready:false};
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < doc.numPages; index++) {
        const previous = old?.pages[index];
        const holder = document.createElement('div');
        holder.className = 'pdf-page';
        holder.setAttribute('role', 'group');
        holder.setAttribute('aria-label', `Page ${index + 1} of ${doc.numPages}`);
        const page = {index, holder, width:previous?.width || firstSize.width, height:previous?.height || firstSize.height,
          canvas:previous?.canvas || null, renderedKey:'', failedKey:'', token:0, task:null, pending:false,
          overlay:null, textWidth:0, textToken:0, textTask:null, textPending:false, textFailed:false, textSource:null};
        if (page.canvas) holder.appendChild(page.canvas);
        state.pages.push(page);
        this.sizePage(page);
        fragment.appendChild(holder);
      }
      this.state = state;
      this.element.replaceChildren(fragment);
      this.element.scrollTop = top; this.element.scrollLeft = left;
      if (old) void old.doc.destroy().catch(() => {});
      this.schedule(0);
    } catch (error) {
      if (id === this.loadId) { this.loading = null; this.onError(error); }
      if (task) void task.destroy().catch(() => {});
    }
  }

  sizePage(page) {
    const fitWidth = Math.max(240, this.element.clientWidth - 32);
    const scale = Math.min(2, fitWidth / page.width) * this.zoom;
    page.holder.style.width = `${page.width * scale}px`;
    page.holder.style.height = `${page.height * scale}px`;
    if (page.overlay) page.overlay.style.transform = `scale(${page.width * scale / page.textWidth})`;
  }

  anchorAt(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY)?.closest('.pdf-page');
    if (!target || !this.element.contains(target)) return null;
    const rect = target.getBoundingClientRect();
    return {target, x:(clientX - rect.left) / rect.width, y:(clientY - rect.top) / rect.height, clientX, clientY};
  }

  resize(zoom, anchor = null) {
    this.zoom = Math.max(.5, Math.min(2.5, zoom));
    const state = this.state;
    if (!state) return;
    this.cancelPaints(state);
    for (const page of state.pages) { this.sizePage(page); page.failedKey = ''; }
    if (anchor && this.element.contains(anchor.target)) {
      const rect = anchor.target.getBoundingClientRect();
      this.element.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX;
      this.element.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY;
    }
    this.deferUntil = Date.now() + 120;
    this.schedule(120);
  }

  schedule(delay) {
    if (!this.state) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renderVisible(), Math.max(delay, this.deferUntil - Date.now(), 0));
  }

  renderVisible() {
    const state = this.state;
    if (!state) return;
    const bounds = this.element.getBoundingClientRect();
    const height = this.element.clientHeight;
    const nearby = [];
    for (const page of state.pages) {
      const rect = page.holder.getBoundingClientRect();
      if (rect.bottom >= bounds.top - height && rect.top <= bounds.bottom + height) {
        const distance = Math.max(bounds.top - rect.bottom, rect.top - bounds.bottom, 0);
        nearby.push({page, distance});
      } else if (page.canvas && !page.pending && (rect.bottom < bounds.top - 4 * height || rect.top > bounds.bottom + 4 * height)) {
        page.canvas.remove(); page.canvas.width = 0; page.canvas.height = 0; page.canvas = null; page.renderedKey = '';
        page.textToken++; if (page.textTask) page.textTask.cancel();
        page.overlay?.remove(); page.overlay = null; page.textWidth = 0; page.textFailed = false; page.textSource = null;
      }
    }
    nearby.sort((a, b) => a.distance - b.distance);
    for (const {page} of nearby) {
      if (page.canvas && !page.overlay && !page.textPending && !page.textFailed && page.textSource) {
        const {pdfPage, viewport, cssWidth} = page.textSource;
        void this.renderText(state, page, pdfPage, viewport, cssWidth);
      }
      if (state.running >= 2) break;
      const key = this.renderKey(page);
      if (!page.pending && page.renderedKey !== key && page.failedKey !== key) void this.paint(state, page);
    }
  }

  renderKey(page) {
    const width = parseFloat(page.holder.style.width), height = parseFloat(page.holder.style.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (width * height)));
    return `${Math.round(width * ratio)}x${Math.round(height * ratio)}`;
  }

  async paint(state, page) {
    const token = ++page.token;
    page.pending = true; state.running++;
    let key = this.renderKey(page);
    try {
      const pdfPage = await state.doc.getPage(page.index + 1);
      if (this.state !== state || token !== page.token) return;
      const native = pdfPage.getViewport({scale:1});
      if (page.width !== native.width || page.height !== native.height) {
        const rect = page.holder.getBoundingClientRect(), before = rect.height;
        page.width = native.width; page.height = native.height; this.sizePage(page);
        if (rect.bottom < this.element.getBoundingClientRect().top) this.element.scrollTop += parseFloat(page.holder.style.height) - before;
      }
      const cssWidth = parseFloat(page.holder.style.width), cssHeight = parseFloat(page.holder.style.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (cssWidth * cssHeight)));
      const viewport = pdfPage.getViewport({scale:cssWidth / native.width});
      key = this.renderKey(page);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.width = Math.max(1, Math.round(viewport.width * ratio)); canvas.height = Math.max(1, Math.round(viewport.height * ratio));
      const task = pdfPage.render({canvasContext:canvas.getContext('2d'), viewport, transform:[ratio, 0, 0, ratio, 0, 0]});
      page.task = task;
      await task.promise;
      if (this.state !== state || token !== page.token) return;
      if (page.canvas) page.canvas.replaceWith(canvas); else page.holder.prepend(canvas);
      page.canvas = canvas; page.renderedKey = key;
      page.textSource = {pdfPage, viewport, cssWidth};
      if (!page.overlay && !page.textPending && !page.textFailed) void this.renderText(state, page, pdfPage, viewport, cssWidth);
      if (!state.ready) { state.ready = true; this.onReady(); }
    } catch (error) {
      if (this.state === state && token === page.token && error.name !== 'RenderingCancelledException') { page.failedKey = key; this.onError(error); }
    } finally {
      page.task = null; page.pending = false; state.running--;
      if (this.state === state) this.schedule(0);
    }
  }

  async renderText(state, page, pdfPage, viewport, cssWidth) {
    if (!this.TextLayer) return;
    const token = ++page.textToken;
    page.textPending = true;
    try {
      const overlay = document.createElement('div'); overlay.className = 'text-overlay';
      overlay.style.width = `${viewport.width}px`; overlay.style.height = `${viewport.height}px`;
      const layer = document.createElement('div'); layer.className = 'textLayer';
      layer.style.setProperty('--scale-factor', viewport.scale);
      overlay.appendChild(layer);
      const task = new this.TextLayer({textContentSource:pdfPage.streamTextContent(), container:layer, viewport});
      page.textTask = task;
      await task.render();
      if (this.state !== state || page.textToken !== token || !page.canvas) return;
      page.overlay = overlay; page.textWidth = cssWidth;
      overlay.style.transform = `scale(${parseFloat(page.holder.style.width) / cssWidth})`;
      page.holder.appendChild(overlay);
    } catch (error) {
      if (this.state === state && token === page.textToken && error.name !== 'AbortException') {
        page.textFailed = true;
        this.onError(new Error(`Could not make page ${page.index + 1} selectable. ${error.message}`));
      }
    } finally { page.textTask = null; page.textPending = false; if (this.state === state && page.canvas && !page.overlay && !page.textFailed) this.schedule(0); }
  }
}

module.exports = { PdfPreview };
