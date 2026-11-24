'use strict';
const { compile, clean, exportResult } = require('./compiler');
const { AUTHOR_KEY, normalizeAuthors, markdownAuthors, markdownMetadata } = require('./paper-data');
const { MIGRATED_KEY, inspectMetadata, updateMetadata, splitFrontMatter } = require('./metadata-editor');
const { STYLE_KEY, labels: styleLabels, styleId } = require('./citation-styles');
const { DOCUMENT_STYLE_KEY, documentStyles, documentStyleId, layoutOverrides } = require('./document-styles');
const { DOCUMENT_OPTIONS_KEY, normalizeDocumentOptions } = require('./document-options');
const { copyCitation } = require('./zotero');
const { openPdfSnapshot } = require('./open-pdf');
const { createDetachedPreview } = require('./detached-preview');
const fs = require('fs/promises');
const path = require('path');

joplin.plugins.register({ onStart: async function() {
  await joplin.contentScripts.register('codeMirrorPlugin', 'scholarMetadataEditor', './metadata-codemirror.js');
  await joplin.settings.registerSection('scholar', { label: 'Joplin Scholar', iconName: 'fas fa-graduation-cap' });
  await joplin.settings.registerSettings({
    pandoc: { section: 'scholar', type: 2, value: '', public: true, label: 'Pandoc executable', description: 'Leave blank to search the usual locations, or enter the full path.' },
    engine: { section: 'scholar', type: 2, value: 'xelatex', public: true, label: 'PDF engine', description: 'For example xelatex, pdflatex, or the full path to an installed engine.' },
    bibliographySource: { section: 'scholar', type: 2, value: 'auto', public: true, isEnum: true, options: {auto:'Automatic: file or note metadata, otherwise Zotero', zotero:'Zotero directly', file:'Bibliography file'}, label: 'Bibliography source', description: 'Direct Zotero uses the running Zotero application and Better BibTeX.' },
    bibliography: { section: 'scholar', type: 2, value: '', public: true, label: 'Bibliography file', description: 'Optional absolute path to a .bib or CSL JSON file.' },
    zoteroLibrary: { section: 'scholar', type: 2, value: '', public: true, label: 'Zotero library ID (optional)', description: 'Leave blank for My Library. Set a numeric library ID to use one group library.' },
    csl: { section: 'scholar', type: 2, value: '', public: true, label: 'Citation style file', description: 'Optional absolute path to a .csl file (requires a bibliography).' },
    template: { section: 'scholar', type: 2, value: '', public: true, label: 'Pandoc LaTeX template', description: 'Optional absolute path to a Pandoc-compatible LaTeX template.' },
    springerClass: { section: 'scholar', type: 2, value: '', public: true, label: 'Springer Nature class file', description: 'Path to sn-jnl.cls from Springer Nature’s journal template package, unless it is installed in TeX.' },
    delay: { section: 'scholar', type: 1, value: 1800, public: true, label: 'Preview delay in milliseconds', description: 'Wait this long after editing before rebuilding the preview.' },
  });
  let logoData = '';
  try { logoData = (await fs.readFile(path.join(await joplin.plugins.installationDir(), 'assets/icon-48.png'))).toString('base64'); } catch (_) { /* Keep the panel usable if the optional icon is missing. */ }
  const panel = await joplin.views.panels.create('joplinScholar.preview');
  const panelHtml = `<main class="app">
    <header class="toolbar" aria-label="Joplin Scholar controls">
      <h1>${logoData ? `<img class="brand-icon" src="data:image/png;base64,${logoData}" alt="" aria-hidden="true">` : ''}Joplin Scholar</h1>
      <button id="refresh" type="button" title="Rebuild preview" aria-label="Rebuild preview">↻</button>
      <button id="open-pdf" type="button" title="Open the current preview in your default PDF viewer" disabled>Open PDF</button>
      <button id="detach-preview" type="button" title="Open Scholar in a separate window">Detach</button>
      <details class="export-menu" id="export-menu"><summary>Export</summary><div class="export-options"><button id="export-pdf" type="button">PDF</button><button id="export-tex" type="button">LaTeX</button></div></details>
      <button id="create-example" type="button" title="Create an example paper in the selected notebook">Example paper</button>
      <span class="toolbar-separator" aria-hidden="true"></span>
      <button class="tool-toggle" type="button" aria-expanded="false" aria-controls="document-options-panel">Document options</button>
      <button class="tool-toggle" type="button" aria-expanded="false" aria-controls="metadata-panel">Document metadata</button>
      <button class="tool-toggle" type="button" aria-expanded="false" aria-controls="citation-panel">Cite</button>
      <button class="tool-toggle" type="button" aria-expanded="false" aria-controls="footnote-panel">Footnote</button>
    </header>
    <p id="example-status" class="hint" role="status" aria-live="polite" hidden></p>
    <section class="paper-controls" id="document-options-panel" aria-label="Document options" hidden><div class="form-inner document-options">
      <label>Line numbers <select id="option-lineNumbers" disabled><option value="default">Style default</option><option value="on">Continuous</option><option value="off">Off</option></select></label>
      <label>Affiliations <select id="option-affiliations" disabled><option value="default">Style default</option><option value="below">Below authors</option><option value="end">End of paper</option></select></label>
      <label>Line spacing <select id="option-spacing" disabled><option value="default">Style default</option><option value="single">Single</option><option value="onehalf">1.5</option><option value="double">Double</option></select></label>
      <label>Section numbering <select id="option-sections" disabled><option value="default">Style default</option><option value="on">On</option><option value="off">Off</option></select></label>
      <label>Paper size <select id="option-paperSize" disabled><option value="default">Style default</option><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
      <p id="document-options-status" class="hint" role="status">Select a note.</p>
    </div></section>
    <section class="paper-controls" id="metadata-panel" aria-label="Document metadata" hidden><div class="form-inner">
      <p class="hint">Changes are written to YAML at the start of this note. Put each affiliation on a separate line.</p>
      <div class="metadata-fields"><label>Title <input id="metadata-title" type="text" aria-describedby="metadata-title-hint" disabled></label><label>Subtitle <input id="metadata-subtitle" type="text" disabled></label><label>Date <input id="metadata-date" type="text" disabled></label></div><p id="metadata-title-hint" class="hint">The document title defaults to the Joplin note title. Editing it sets a separate title in YAML.</p>
      <strong>Authors and affiliations</strong><div id="authors-list"></div><div class="actions"><button id="add-author" type="button" disabled>Add author</button></div>
      <details><summary>Full YAML (all metadata fields)</summary><p class="hint">Edit or add any YAML metadata, including abstracts, keywords, references and custom fields. Save changes to update the note.</p><label for="metadata-yaml">YAML metadata</label><textarea id="metadata-yaml" rows="10" spellcheck="false" disabled></textarea></details>
      <div class="actions"><button id="save-metadata" type="button" disabled>Save metadata</button><button id="reload-metadata" type="button" disabled>Reload metadata</button></div><p id="authors-status" class="hint" role="status">Select a note.</p>
    </div></section>
    <section class="paper-controls" id="citation-panel" aria-label="Add a citation" hidden><div class="form-inner"><p class="hint">Open Zotero’s picker, then paste the citation into your note. Requires Zotero with Better BibTeX.</p><button id="pick-citation" type="button">Choose from Zotero</button><p id="citation-status" class="hint" role="status">Scholar can retrieve references directly from Zotero, or use a bibliography file.</p><code id="citation-result" class="citation-result" hidden></code></div></section>
    <section class="paper-controls" id="footnote-panel" aria-label="Add a footnote" hidden><div class="form-inner"><label for="footnote-text">Footnote text</label><textarea id="footnote-text" rows="2" placeholder="Type the footnote here"></textarea><button id="copy-footnote" type="button">Copy footnote</button><p id="footnote-status" class="hint" role="status">Paste it into the note where the number should appear. In Markdown you can also use [^1] and a matching [^1]: definition.</p></div></section>
    <div class="status-row"><div class="style-control"><label for="document-style">Document style</label><select id="document-style" aria-describedby="document-style-status" disabled>${Object.entries(documentStyles).map(([id, style]) => `<option value="${id}">${style.label}</option>`).join('')}</select></div><div class="style-control"><label for="citation-style">Citation style</label><select id="citation-style" aria-describedby="style-status" disabled><option value="default">Default / configured CSL</option>${Object.entries(styleLabels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div><p id="status" role="status" aria-live="polite">Select a note to begin.</p><div class="zoom" aria-label="Preview zoom"><button id="zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-fit" type="button" title="Fit to width" aria-label="Fit to width">100%</button><button id="zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button></div></div><p id="document-style-status" class="hint" role="status" hidden></p><p id="style-status" class="hint" role="status" hidden></p><details id="errors" hidden><summary>Show details</summary><pre id="error-text"></pre></details><div id="preview" tabindex="0" aria-label="PDF preview. Scroll to move through the paper; hold Shift and scroll to zoom." title="Scroll through the paper; hold Shift while scrolling to zoom"><div id="placeholder">Your typeset paper will appear here.</div></div></main>`;
  await joplin.views.panels.setHtml(panel, panelHtml);
  let detached = null;
  const send = message => { joplin.views.panels.postMessage(panel, message); detached?.send(message); };
  let generation = 0, timer = null, compiling = false, requested = false, selectedId = null, lastPdf = null, webviewReady = false, authorLoadId = 0, authorView = null, choosingCitation = false, creatingExample = false, openingDetached = false, styleLoadId = 0, documentStyleLoadId = 0, documentOptionsLoadId = 0;
  async function options() { const o = await joplin.settings.values(['pandoc', 'engine', 'bibliographySource', 'bibliography', 'zoteroLibrary', 'csl', 'template', 'springerClass', 'delay']); for (const k of ['pandoc','engine','bibliographySource','bibliography','zoteroLibrary','csl','template','springerClass']) o[k] = String(o[k] || '').trim(); return o; }
  async function authorsFor(noteId) { if (await joplin.data.userDataGet(1, noteId, MIGRATED_KEY)) return []; return normalizeAuthors((await joplin.data.userDataGet(1, noteId, AUTHOR_KEY)) || []); }
  async function styleFor(noteId) { const value = await joplin.data.userDataGet(1, noteId, STYLE_KEY); return styleId(value) || 'default'; }
  async function documentStyleFor(noteId) { return documentStyleId(await joplin.data.userDataGet(1, noteId, DOCUMENT_STYLE_KEY)) || 'default'; }
  async function documentOptionsFor(noteId) { return normalizeDocumentOptions((await joplin.data.userDataGet(1, noteId, DOCUMENT_OPTIONS_KEY)) || {}); }
  async function loadDocumentOptions() {
    const loadId = ++documentOptionsLoadId;
    try {
      const note = await joplin.workspace.selectedNote();
      const value = note ? await documentOptionsFor(note.id) : normalizeDocumentOptions();
      const metadata = note ? markdownMetadata(note.body) : null;
      const styleId = note ? await documentStyleFor(note.id) : 'default';
      const settings = await joplin.settings.values(['template']);
      if (loadId !== documentOptionsLoadId || (await joplin.workspace.selectedNote())?.id !== note?.id) return;
      const style = documentStyles[styleId];
      const adapter = (!metadata?.documentclass || metadata.documentclass === style.metadata.documentclass) && style.adapter;
      const customTemplate = !!String(settings.template || '').trim();
      const locked = customTemplate || (!!adapter && adapter !== 'ieee');
      const overrides = ['linestretch','numbersections','papersize'].filter(key => Object.hasOwn(metadata || {}, key));
      for (const key of ['geometry','classoption']) if (/a4paper|letterpaper|papersize|paperwidth|paperheight/i.test(JSON.stringify(metadata?.[key] || ''))) overrides.push(key);
      send({type:'documentOptions', noteId:note?.id || null, value, locked, customTemplate, spacingLocked:adapter === 'acm', overrides});
    } catch (error) { if (loadId === documentOptionsLoadId) send({type:'documentOptionsError', message:error.message}); }
  }
  async function loadDocumentStyle() {
    const loadId = ++documentStyleLoadId;
    try {
      const note = await joplin.workspace.selectedNote();
      const value = note ? await documentStyleFor(note.id) : 'default';
      const metadata = note ? markdownMetadata(note.body) : null;
      const settings = await joplin.settings.values(['template']);
      if (loadId !== documentStyleLoadId || (await joplin.workspace.selectedNote())?.id !== note?.id) return;
      send({type:'documentStyle', noteId:note?.id || null, value, overrides:layoutOverrides(metadata), customTemplate:!!String(settings.template || '').trim()});
    } catch (error) { if (loadId === documentStyleLoadId) send({type:'documentStyleError', message:error.message}); }
  }
  async function loadStyle() {
    const loadId = ++styleLoadId;
    try {
      const note = await joplin.workspace.selectedNote();
      const metadata = note ? markdownMetadata(note.body) : null;
      const value = note ? await styleFor(note.id) : 'default';
      if (loadId !== styleLoadId || (await joplin.workspace.selectedNote())?.id !== note?.id) return;
      send({type:'style', noteId:note?.id || null, value, metadata:metadata?.csl || '', metadataStyle:styleId(metadata?.csl)});
    } catch (error) { if (loadId === styleLoadId) send({type:'styleError', message:error.message}); }
  }
  async function loadAuthors(force = false) {
    const loadId = ++authorLoadId;
    try {
      const note = await joplin.workspace.selectedNote();
      if (!note) { if (loadId === authorLoadId) { authorView = null; send({type:'metadata', noteId:null}); } return; }
      const legacy = await authorsFor(note.id);
      const metadata = inspectMetadata(note.body, legacy, note.title);
      const signature = JSON.stringify([note.id, metadata]);
      if (loadId === authorLoadId && (await joplin.workspace.selectedNote())?.id === note.id && (force || signature !== authorView?.signature)) {
        authorView = {noteId:note.id, signature};
        send({type:'metadata', noteId:note.id, metadata});
      }
    } catch (error) { if (loadId === authorLoadId) { authorView = null; send({type:'metadataError', message:`Could not load metadata: ${error.message}`}); } }
  }
  function schedule(immediate = false, selectionChanged = false) {
    generation++; const scheduledVersion = generation; clearTimeout(timer);
    if (selectionChanged) { selectedId = null; lastPdf = null; send({ type: 'clear' }); }
    if (webviewReady) send({ type: 'waiting' });
    const next = async () => { requested = true; void drain(); };
    if (immediate) void next(); else void options().then(o => { if (scheduledVersion === generation) timer = setTimeout(next, Math.max(500, Math.min(30000, Number(o.delay) || 1800))); });
  }
  async function drain() {
    if (compiling) return;
    compiling = true;
    try {
      while (requested) {
        requested = false;
        const version = generation;
        if (!detached?.connected && !await joplin.views.panels.visible(panel)) continue;
        const note = await joplin.workspace.selectedNote();
        if (version !== generation) continue;
        if (!note) { selectedId = null; lastPdf = null; send({ type: 'clear', message: 'Select a note to begin.' }); continue; }
        if (selectedId !== note.id) { selectedId = note.id; lastPdf = null; send({ type: 'clear' }); }
        send({ type: 'building', title: note.title });
        let result;
        try {
          const config = await options();
          config.authors = markdownAuthors(note.body) === null ? await authorsFor(note.id) : [];
          config.citationStyle = await styleFor(note.id);
          config.documentStyle = await documentStyleFor(note.id);
          config.documentOptions = await documentOptionsFor(note.id);
          result = await compile(note, joplin.data, config, 'pdf');
          if (version === generation) { lastPdf = { base64: result.output.toString('base64'), title: note.title }; send({ type: 'pdf', ...lastPdf }); }
        } catch (error) {
          if (version === generation) send({ type: 'error', message: error.message });
        } finally { await clean(result); }
      }
    } finally { compiling = false; if (requested) void drain(); }
  }
  async function doExport(format) {
    try {
      const dirs = await joplin.views.dialogs.showOpenDialog({ title: 'Choose where to save the paper', properties: ['openDirectory', 'createDirectory'] });
      if (!dirs || !dirs.length) return;
      const note = await joplin.workspace.selectedNote();
      if (!note) throw new Error('Select a note before exporting.');
      send({ type: 'exporting', format });
      let result;
      try {
        const config = await options();
        config.authors = markdownAuthors(note.body) === null ? await authorsFor(note.id) : [];
        config.citationStyle = await styleFor(note.id);
        config.documentStyle = await documentStyleFor(note.id);
        config.documentOptions = await documentOptionsFor(note.id);
        result = await compile(note, joplin.data, config, format);
        const file = await exportResult(result, dirs[0]);
        send({ type: 'exported', file });
      } finally { await clean(result); }
    } catch (error) { send({ type: 'error', message: error.message }); }
  }
  async function createExample() {
    if (creatingExample) return;
    creatingExample = true;
    send({type:'exampleCreating'});
    let resource, note;
    try {
      const folder = await joplin.workspace.selectedFolder();
      if (!folder?.id) throw new Error('Select a notebook first.');
      const installDir = await joplin.plugins.installationDir();
      const template = await fs.readFile(path.join(installDir, 'joplin-scholar-example.md'), 'utf8');
      const marker = '(example-workflow.png)';
      if (!template.includes(marker)) throw new Error('The bundled example is incomplete.');
      resource = await joplin.data.post(['resources'], null, {title:'Joplin Scholar example workflow.png'}, [{path:path.join(installDir, 'example-workflow.png')}]);
      if (!/^[a-f0-9]{32}$/i.test(resource?.id || '')) throw new Error('Could not create the example image.');
      note = await joplin.data.post(['notes'], null, {parent_id:folder.id, title:'Writing a Paper with Joplin Scholar', body:template.replace(marker, `(:/${resource.id})`)});
      if (!note?.id) throw new Error('Could not create the example note.');
      try {
        await joplin.commands.execute('openNote', note.id);
        send({type:'exampleCreated', message:'Example paper created in the selected notebook.'});
      } catch (error) {
        send({type:'exampleCreated', message:'Example paper created in the selected notebook. Open it from the note list.'});
      }
    } catch (error) {
      if (resource?.id && !note?.id) { try { await joplin.data.delete(['resources', resource.id]); } catch (_) {} }
      send({type:'exampleError', message:`Could not create the example paper. ${error.message}`});
    } finally { creatingExample = false; }
  }
  const handleMessage = async message => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'ready') { webviewReady = true; void loadAuthors(true); void loadStyle(); void loadDocumentStyle(); void loadDocumentOptions(); if (lastPdf) send({ type: 'pdf', ...lastPdf }); else schedule(true); }
    if (message.type === 'createExample') await createExample();
    if (message.type === 'detach' && !openingDetached) {
      openingDetached = true;
      try {
        if (!detached) detached = createDetachedPreview({ html:panelHtml, directory:await joplin.plugins.installationDir(), onMessage:handleMessage, onConnect:async () => { await joplin.views.panels.show(panel, false); }, onDisconnect:async wasConnected => { detached = null; if (wasConnected) { await joplin.views.panels.show(panel, true); schedule(true); } } });
        await detached.open();
      } catch (error) { detached = null; send({type:'openPdfError', message:`Could not open a separate window. ${error.message}`}); }
      finally { openingDetached = false; }
    }
    if (message.type === 'setDocumentStyle') {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || note.id !== message.noteId) throw new Error('The selected note changed.');
        const value = documentStyleId(message.value);
        if (!value) throw new Error('Choose a valid document style.');
        await joplin.data.userDataSet(1, note.id, DOCUMENT_STYLE_KEY, value);
        await loadDocumentStyle();
        await loadDocumentOptions();
        if ((await joplin.workspace.selectedNote())?.id === note.id) schedule(true);
      } catch (error) { await loadDocumentStyle(); send({type:'documentStyleError', message:error.message}); }
    }
    if (message.type === 'setStyle') {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || note.id !== message.noteId) throw new Error('The selected note changed.');
        if (markdownMetadata(note.body)?.csl) throw new Error('This note defines its style in YAML; edit the csl field.');
        const value = message.value === 'default' ? 'default' : styleId(message.value);
        if (!value) throw new Error('Choose a valid citation style.');
        await joplin.data.userDataSet(1, note.id, STYLE_KEY, value);
        await loadStyle(); schedule(true);
      } catch (error) { await loadStyle(); send({type:'styleError', message:error.message}); }
    }
    if (message.type === 'setDocumentOptions') {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || note.id !== message.noteId) throw new Error('The selected note changed.');
        const value = normalizeDocumentOptions(message.value);
        await joplin.data.userDataSet(1, note.id, DOCUMENT_OPTIONS_KEY, value);
        await loadDocumentOptions();
        if ((await joplin.workspace.selectedNote())?.id === note.id) schedule(true);
      } catch (error) { await loadDocumentOptions(); send({type:'documentOptionsError', message:error.message}); }
    }
    if (message.type === 'refresh') schedule(true);
    if (message.type === 'openPdf') {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!lastPdf || !note || selectedId !== note.id) throw new Error('Select a note and wait for its PDF preview first.');
        await openPdfSnapshot(Buffer.from(lastPdf.base64, 'base64'));
        send({type:'pdfOpened'});
      } catch (error) { send({type:'openPdfError', message:`Could not open the PDF. ${error.message}`}); }
    }
    if (message.type === 'export' && ['pdf', 'tex'].includes(message.format)) await doExport(message.format);
    if (message.type === 'reloadMetadata') { await loadAuthors(true); }
    if (message.type === 'saveMetadata') {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || note.id !== message.noteId) throw new Error('The selected note changed. Select it again before saving.');
        const legacy = await authorsFor(note.id);
        const current = await joplin.workspace.selectedNote();
        if (!current || current.id !== note.id) throw new Error('The selected note changed. Select it again before saving.');
        const body = updateMetadata(current.body, message, legacy);
        const updated = inspectMetadata(body, [], current.title);
        const latest = await joplin.workspace.selectedNote();
        if (!latest || latest.id !== note.id || latest.body !== current.body) throw new Error('The note changed during saving. Your draft is still in the panel; try again.');
        let applied;
        try {
          applied = await joplin.commands.execute('editor.execCommand', {name:'scholar__replaceMetadata', args:[current.body, splitFrontMatter(current.body).head, splitFrontMatter(body).head]});
        } catch (_) { throw new Error('Open the note in Joplin’s Markdown editor before saving document metadata.'); }
        if (!applied || typeof applied !== 'object') throw new Error('Open the note in Joplin’s Markdown editor before saving document metadata.');
        if (!applied.ok) throw new Error(applied.reason === 'readonly' ? 'This note is read-only.' : 'The note has unsaved changes. Wait for Joplin to save, then try again; your metadata draft is still in the panel.');
        let warning = '';
        try { await joplin.data.userDataSet(1, note.id, MIGRATED_KEY, true); }
        catch (_) { warning = 'Metadata was saved, but older author data could not be marked as migrated. Keep an author field in YAML to prevent older authors from reappearing.'; }
        send({type:'metadataSaved', noteId:note.id, revision:message.revision});
        authorView = {noteId:note.id, signature:JSON.stringify([note.id, updated])};
        send({type:'metadata', noteId:note.id, metadata:updated});
        if (warning) send({type:'metadataNotice', noteId:note.id, message:warning});
        if ((await joplin.workspace.selectedNote())?.id === note.id) schedule();
      } catch (error) { send({type:'metadataSaveError', noteId:message.noteId, message:error.message}); }
    }
    if (message.type === 'pickCitation' && !choosingCitation) {
      choosingCitation = true;
      send({type:'citationPicking'});
      try {
        const citation = await copyCitation(joplin.clipboard);
        if (!citation) send({type:'citationCancelled'});
        else send({type:'citationCopied', citation});
      } catch (error) { send({type:'citationError', message:error.message}); }
      finally { choosingCitation = false; }
    }
    if (message.type === 'copyFootnote') {
      try {
        const text = String(message.text || '').replace(/\s+/g, ' ').trim();
        if (!text) throw new Error('Enter the footnote text first.');
        if (/[{}]/.test(text)) throw new Error('Footnote text cannot contain { or }.');
        if (text.length > 4000) throw new Error('Keep the footnote under 4,000 characters.');
        await joplin.clipboard.writeText(`{{fn: ${text}}}`);
        send({type:'footnoteCopied'});
      } catch (error) { send({type:'footnoteError', message:error.message}); }
    }
  };
  await joplin.views.panels.onMessage(panel, handleMessage);
  await joplin.views.panels.addScript(panel, './panel.css');
  await joplin.views.panels.addScript(panel, './worker.js');
  await joplin.views.panels.addScript(panel, './panel.js');
  await joplin.window.loadChromeCssFile(path.join(await joplin.plugins.installationDir(), 'toolbar.css'));
  await joplin.commands.register({ name: 'toggleJoplinScholar', label: 'Toggle Joplin Scholar', iconName: 'fas fa-graduation-cap scholar-toolbar-icon', execute: async () => { const visible = await joplin.views.panels.visible(panel); await joplin.views.panels.show(panel, !visible); if (!visible) schedule(true); } });
  await joplin.views.toolbarButtons.create('toggleJoplinScholarToolbar', 'toggleJoplinScholar', 'noteToolbar');
  await joplin.views.menuItems.create('toggleJoplinScholarMenu', 'toggleJoplinScholar', 'view');
  await joplin.workspace.onNoteChange(() => { void loadAuthors(); void loadStyle(); void loadDocumentStyle(); void loadDocumentOptions(); schedule(); });
  await joplin.workspace.onNoteSelectionChange(() => { authorView = null; send({type:'metadataLoading'}); send({type:'paperChanged'}); void loadAuthors(); void loadStyle(); void loadDocumentStyle(); void loadDocumentOptions(); schedule(true, true); });
  await joplin.settings.onChange(() => { void loadDocumentStyle(); void loadDocumentOptions(); schedule(true); });
}});
