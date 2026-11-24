import { getDocument, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfPreview } from './pdf-preview';

const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const errors = document.querySelector('#errors');
const errorText = document.querySelector('#error-text');
const authorsList = document.querySelector('#authors-list');
const authorsStatus = document.querySelector('#authors-status');
const addAuthorButton = document.querySelector('#add-author');
const saveAuthorsButton = document.querySelector('#save-metadata');
const reloadMetadataButton = document.querySelector('#reload-metadata');
const metadataYaml = document.querySelector('#metadata-yaml');
const metadataFields = Object.fromEntries(['title','subtitle','date'].map(key => [key, document.querySelector(`#metadata-${key}`)]));
const footnoteText = document.querySelector('#footnote-text');
const footnoteStatus = document.querySelector('#footnote-status');
let authorNoteId = null, authorRevision = 0, metadataBase = null;
const authorDrafts = new Map();
let styleNoteId = null, previewStatus = 'idle';
const send = message => webviewApi.postMessage(message);
const toolToggles = [...document.querySelectorAll('.tool-toggle')];
const exportMenu = document.querySelector('#export-menu');
function openTool(selected) {
  for (const button of toolToggles) {
    const open = button === selected;
    button.setAttribute('aria-expanded', String(open));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
  }
}
for (const button of toolToggles) button.addEventListener('click', () => openTool(button.getAttribute('aria-expanded') === 'true' ? null : button));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (exportMenu.open) { exportMenu.open = false; exportMenu.querySelector('summary').focus(); return; }
  const open = toolToggles.find(button => button.getAttribute('aria-expanded') === 'true');
  if (open) { openTool(null); open.focus(); }
});
document.querySelector('#refresh').addEventListener('click', () => send({ type: 'refresh' }));
const exampleButton = document.querySelector('#create-example');
const exampleStatus = document.querySelector('#example-status');
exampleButton.addEventListener('click', () => { exampleButton.disabled = true; exampleStatus.hidden = false; exampleStatus.textContent = 'Creating example paper…'; send({type:'createExample'}); });
document.querySelector('#open-pdf').addEventListener('click', () => send({ type: 'openPdf' }));
const detachButton = document.querySelector('#detach-preview');
if (window.scholarDetached) { detachButton.textContent = 'Return to Joplin'; detachButton.title = 'Close this window and restore the Scholar panel'; }
window.addEventListener('beforeunload', event => { if (window.scholarDetached && authorDrafts.size) { event.preventDefault(); event.returnValue = ''; } });
detachButton.addEventListener('click', () => {
  if (authorDrafts.size) {
    openTool(toolToggles.find(button => button.getAttribute('aria-controls') === 'metadata-panel'));
    authorsStatus.textContent = 'Save your metadata changes before moving the preview. If you edited another note, return to it and save those changes too.';
    return;
  }
  if (window.scholarDetached) window.scholarReturn();
  else send({type:'detach'});
});
document.addEventListener('click', event => { if (exportMenu.open && !exportMenu.contains(event.target)) exportMenu.open = false; });
document.querySelector('#export-pdf').addEventListener('click', () => { exportMenu.open = false; send({ type: 'export', format: 'pdf' }); });
document.querySelector('#export-tex').addEventListener('click', () => { exportMenu.open = false; send({ type: 'export', format: 'tex' }); });
function readAuthors() {
  return [...authorsList.querySelectorAll('.author-row')].map(row => ({
    ...row.authorData,
    name: row.querySelector('.author-name').value,
    email: row.querySelector('.author-email').value,
    url: row.querySelector('.author-url').value,
    affiliationUrl: row.querySelector('.author-affiliation-url').value,
    notes: row.querySelector('.author-notes').value.split('\n').map(value => value.trim()).filter(Boolean),
    affiliations: row.querySelector('.author-affiliations').value.split('\n').map(value => value.trim()).filter(Boolean),
    corresponding: row.querySelector('.author-corresponding').checked,
  }));
}
function metadataChanged(authorsChanged = false) {
  if (!authorNoteId || !metadataBase) return;
  authorRevision++;
  const previous = authorDrafts.get(authorNoteId);
  authorDrafts.set(authorNoteId, {base:metadataBase, authors:readAuthors(), fields:Object.fromEntries(Object.entries(metadataFields).map(([key, input])=>[key,input.value])), yaml:metadataYaml.value, authorsChanged:authorsChanged || !!previous?.authorsChanged, revision:authorRevision});
  authorsStatus.textContent = 'Unsaved changes';
}
function authorChanged() { metadataChanged(true); }
for (const input of Object.values(metadataFields)) input.addEventListener('input', () => metadataChanged());
metadataYaml.addEventListener('input', () => metadataChanged());
function field(labelText, value, className, multiline = false) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = className;
  if (multiline) { input.rows = 2; } else input.type = 'text';
  input.value = value || '';
  label.appendChild(input);
  return label;
}
function renderAuthors(authors) {
  authorsList.replaceChildren();
  authors.forEach((author, index) => {
    const row = document.createElement('section'); row.className = 'author-row'; row.authorData = author;
    const heading = document.createElement('strong'); heading.textContent = `Author ${index + 1}`; row.appendChild(heading);
    row.appendChild(field('Name', author.name, 'author-name'));
    row.appendChild(field('Affiliations (one per line)', (author.affiliations || []).join('\n'), 'author-affiliations', true));
    row.appendChild(field('Email (shown for corresponding author)', author.email, 'author-email'));
    row.appendChild(field('Author URL (optional)', author.url, 'author-url'));
    row.appendChild(field('First affiliation URL (optional)', author.affiliationUrl, 'author-affiliation-url'));
    row.appendChild(field('Author notes (one per line)', (author.notes || []).join('\n'), 'author-notes', true));
    const choice = document.createElement('label'); choice.className = 'corresponding-choice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'author-corresponding'; checkbox.checked = !!author.corresponding;
    choice.append(checkbox, document.createTextNode(' Corresponding author')); row.appendChild(choice);
    const actions = document.createElement('div'); actions.className = 'actions';
    const move = (label, action, disabled = false) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = disabled; button.dataset.boundaryDisabled = String(disabled); button.addEventListener('click', action); actions.appendChild(button); };
    move('↑', () => { const values = readAuthors(); [values[index - 1], values[index]] = [values[index], values[index - 1]]; renderAuthors(values); authorChanged(); }, index === 0);
    move('↓', () => { const values = readAuthors(); [values[index + 1], values[index]] = [values[index], values[index + 1]]; renderAuthors(values); authorChanged(); }, index === authors.length - 1);
    move('Remove', () => { const values = readAuthors(); values.splice(index, 1); renderAuthors(values); authorChanged(); });
    row.appendChild(actions); row.addEventListener('input', authorChanged); row.addEventListener('change', authorChanged);
    authorsList.appendChild(row);
  });
}
addAuthorButton.addEventListener('click', () => { if (!authorNoteId) return; const values = readAuthors(); values.push({ name:'', email:'', affiliations:[], corresponding:false }); renderAuthors(values); authorChanged(); });
function setMetadataEnabled(enabled) {
  for (const element of document.querySelectorAll('#metadata-panel input, #metadata-panel textarea, #metadata-panel button')) element.disabled = !enabled;
  if (enabled) for (const button of authorsList.querySelectorAll('button[data-boundary-disabled="true"]')) button.disabled = true;
  if (enabled && metadataBase) for (const key of metadataBase.complex || []) metadataFields[key].disabled = true;
  if (enabled && metadataBase?.authorsError) { addAuthorButton.disabled = true; for (const element of authorsList.querySelectorAll('input,textarea,button')) element.disabled = true; }
}
saveAuthorsButton.addEventListener('click', () => {
  if (!authorNoteId || !metadataBase) return;
  if (!authorDrafts.has(authorNoteId) && !metadataBase.legacy) { authorsStatus.textContent = 'No metadata changes to save.'; return; }
  const draft = authorDrafts.get(authorNoteId) || {base:metadataBase, authors:readAuthors(), fields:Object.fromEntries(Object.entries(metadataFields).map(([key,input])=>[key,input.value])), yaml:metadataYaml.value, authorsChanged:false, revision:authorRevision};
  const fields = Object.fromEntries(Object.entries(draft.fields).filter(([key,value])=>value !== draft.base.fields[key] && !draft.base.complex.includes(key)));
  setMetadataEnabled(false); authorsStatus.textContent = 'Saving…';
  send({type:'saveMetadata', noteId:authorNoteId, version:draft.base.version, yaml:draft.yaml, yamlChanged:draft.yaml !== draft.base.yaml, fields, authors:draft.authors, authorsChanged:draft.authorsChanged, revision:draft.revision});
});
reloadMetadataButton.addEventListener('click', () => {
  if (!authorNoteId) return;
  if (authorDrafts.has(authorNoteId) && !window.confirm('Discard unsaved metadata changes and reload from the note?')) return;
  authorDrafts.delete(authorNoteId); metadataBase = null; setMetadataEnabled(false); authorsStatus.textContent = 'Loading metadata…'; send({type:'reloadMetadata'});
});
document.querySelector('#pick-citation').addEventListener('click', () => send({type:'pickCitation'}));
document.querySelector('#copy-footnote').addEventListener('click', () => { footnoteStatus.textContent = 'Preparing footnote…'; send({ type:'copyFootnote', text:footnoteText.value }); });
const styleSelect = document.querySelector('#citation-style');
const styleStatus = document.querySelector('#style-status');
styleSelect.addEventListener('change', () => { styleSelect.disabled = true; styleStatus.hidden = false; styleStatus.textContent = 'Saving style…'; send({type:'setStyle', noteId:styleNoteId, value:styleSelect.value}); });
const documentStyleSelect = document.querySelector('#document-style');
const documentStyleStatus = document.querySelector('#document-style-status');
let documentStyleNoteId = null;
documentStyleSelect.addEventListener('change', () => { documentStyleSelect.disabled = true; documentStyleStatus.hidden = false; documentStyleStatus.textContent = 'Saving document style…'; send({type:'setDocumentStyle', noteId:documentStyleNoteId, value:documentStyleSelect.value}); });
const documentOptionsKeys = ['lineNumbers', 'affiliations', 'spacing', 'sections', 'paperSize'];
const documentOptionInputs = Object.fromEntries(documentOptionsKeys.map(key => [key, document.querySelector(`#option-${key}`)]));
const documentOptionsStatus = document.querySelector('#document-options-status');
let documentOptionsNoteId = null;
for (const input of Object.values(documentOptionInputs)) input.addEventListener('change', () => {
  if (!documentOptionsNoteId) return;
  const value = Object.fromEntries(documentOptionsKeys.map(key => [key, documentOptionInputs[key].value]));
  for (const element of Object.values(documentOptionInputs)) element.disabled = true;
  documentOptionsStatus.textContent = 'Saving document options…';
  send({type:'setDocumentOptions', noteId:documentOptionsNoteId, value});
});
function showRenderError(error) { status.textContent = 'Could not display the PDF.'; errorText.textContent = error.message; errors.hidden = false; }
function clearError() { errors.hidden = true; errorText.textContent = ''; }
const pdf = new PdfPreview({element:preview, getDocument, TextLayer, onError:showRenderError, onReady:() => {
  if (previewStatus === 'rendering') { previewStatus = 'ready'; status.textContent = 'Preview up to date'; }
}});
function setZoom(value, anchor = null) {
  if (Math.max(.5, Math.min(2.5, value)) === pdf.zoom) return;
  pdf.resize(value, anchor);
  document.querySelector('#zoom-fit').textContent = `${Math.round(pdf.zoom * 100)}%`;
  document.querySelector('#zoom-out').disabled = pdf.zoom <= .5;
  document.querySelector('#zoom-in').disabled = pdf.zoom >= 2.5;
}
function centerAnchor() { const rect = preview.getBoundingClientRect(); return pdf.anchorAt(rect.left + rect.width / 2, rect.top + rect.height / 2); }
document.querySelector('#zoom-out').addEventListener('click', () => setZoom(pdf.zoom - .1, centerAnchor()));
document.querySelector('#zoom-in').addEventListener('click', () => setZoom(pdf.zoom + .1, centerAnchor()));
document.querySelector('#zoom-fit').addEventListener('click', () => setZoom(1, centerAnchor()));
let shiftHeld = false;
window.addEventListener('keydown', event => { if (event.key === 'Shift') shiftHeld = true; });
window.addEventListener('keyup', event => { if (event.key === 'Shift') shiftHeld = false; });
window.addEventListener('blur', () => { shiftHeld = false; });
preview.addEventListener('wheel', event => {
  if (!pdf.state || !(event.shiftKey || shiftHeld)) return;
  const movement = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!movement) return;
  event.preventDefault();
  const delta = movement * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? preview.clientHeight : 1);
  setZoom(pdf.zoom * Math.exp(-delta * .001), pdf.anchorAt(event.clientX, event.clientY));
}, {passive:false});
let previewWidth = preview.clientWidth;
new ResizeObserver(() => {
  if (preview.clientWidth !== previewWidth) {
    previewWidth = preview.clientWidth;
    pdf.resize(pdf.zoom, centerAnchor());
  } else pdf.schedule(0);
}).observe(preview);
webviewApi.onMessage(event => {
  const message = event && event.message && typeof event.message === 'object' ? event.message : event;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'exampleCreating') { exampleButton.disabled = true; exampleStatus.hidden = false; exampleStatus.textContent = 'Creating example paper…'; }
  if (message.type === 'exampleCreated' || message.type === 'exampleError') { exampleButton.disabled = false; exampleStatus.hidden = false; exampleStatus.textContent = message.message; }
  if (message.type === 'paperChanged') { styleNoteId = null; styleSelect.disabled = true; styleStatus.hidden = true; documentStyleNoteId = null; documentStyleSelect.disabled = true; documentStyleStatus.hidden = true; documentOptionsNoteId = null; for (const input of Object.values(documentOptionInputs)) input.disabled = true; documentOptionsStatus.textContent = 'Loading document options…'; }
  if (message.type === 'documentOptions') {
    documentOptionsNoteId = message.noteId;
    for (const key of documentOptionsKeys) { documentOptionInputs[key].value = message.value[key]; documentOptionInputs[key].disabled = !message.noteId; }
    for (const option of documentOptionInputs.affiliations.options) if (option.value !== 'default') option.disabled = !!message.locked;
    for (const option of documentOptionInputs.spacing.options) if (option.value !== 'default') option.disabled = !!message.spacingLocked;
    const notices = [];
    if (message.locked) notices.push('This publisher style or custom template controls affiliation placement. Choose Style default for affiliations.');
    if (message.spacingLocked) notices.push('The ACM class controls line spacing. Choose Style default for spacing.');
    if (message.customTemplate) notices.push('The custom template may ignore other document options.');
    if (message.overrides?.length) notices.push(`YAML takes precedence: ${message.overrides.join(', ')}.`);
    documentOptionsStatus.textContent = !message.noteId ? 'Select a note.' : notices.join(' ') || 'Saved with this note. Changes apply to preview and exports.';
  }
  if (message.type === 'documentOptionsError') { for (const input of Object.values(documentOptionInputs)) input.disabled = !documentOptionsNoteId; documentOptionsStatus.textContent = message.message; }
  if (message.type === 'documentStyle') {
    documentStyleNoteId = message.noteId;
    documentStyleSelect.value = message.value;
    documentStyleSelect.disabled = !message.noteId;
    const notices = [];
    if (message.value !== 'default' && message.overrides?.length) notices.push(`YAML overrides: ${message.overrides.join(', ')}.`);
    if (message.value !== 'default' && message.customTemplate) notices.push('The custom template may ignore these settings.');
    if (message.value === 'springer') notices.push('Requires sn-jnl.cls installed in TeX or configured in Scholar settings.');
    if (message.value === 'ieee') notices.push('Tables use full-width single-column pages.');
    documentStyleStatus.textContent = notices.join(' ');
    documentStyleStatus.hidden = !notices.length;
  }
  if (message.type === 'documentStyleError') { documentStyleSelect.disabled = !documentStyleNoteId; documentStyleStatus.hidden = false; documentStyleStatus.textContent = message.message; }
  if (message.type === 'style') {
    styleNoteId = message.noteId;
    styleSelect.querySelector('option[value="__metadata__"]')?.remove();
    if (message.metadata && !message.metadataStyle) styleSelect.add(new Option(`YAML: ${message.metadata}`, '__metadata__'));
    styleSelect.value = message.metadata ? (message.metadataStyle || '__metadata__') : message.value;
    styleSelect.disabled = !message.noteId || !!message.metadata;
    styleStatus.hidden = !message.metadata;
    styleStatus.textContent = message.metadata ? `Style is set by YAML (csl: ${message.metadata}). Edit the note to change it.` : '';
  }
  if (message.type === 'styleError') { styleStatus.hidden = false; styleStatus.textContent = message.message; }
  if (message.type === 'metadataLoading') { authorNoteId = null; metadataBase = null; authorsList.replaceChildren(); setMetadataEnabled(false); authorsStatus.textContent = 'Loading metadata…'; }
  if (message.type === 'metadata') {
    authorNoteId = message.noteId;
    if (!authorNoteId) { metadataBase = null; setMetadataEnabled(false); authorsStatus.textContent = 'Select a note.'; }
    else {
      const draft = authorDrafts.get(authorNoteId); metadataBase = draft?.base || message.metadata; authorRevision = draft?.revision || 0;
      renderAuthors(draft?.authors || metadataBase.authors);
      for (const [key,input] of Object.entries(metadataFields)) input.value = draft?.fields[key] ?? metadataBase.fields[key];
      metadataYaml.value = draft?.yaml ?? metadataBase.yaml;
      setMetadataEnabled(true);
      authorsStatus.textContent = draft ? (draft.base.version !== message.metadata.version ? 'The note metadata changed. Copy your draft and reload before saving.' : 'Unsaved changes') : metadataBase.authorsError ? `Edit authors in Full YAML: ${metadataBase.authorsError}` : metadataBase.legacy ? 'Older authors are stored separately. Save metadata to add them to this note.' : metadataBase.complex.length ? `Edit ${metadataBase.complex.join(', ')} in Full YAML.` : 'Saved in the note’s YAML metadata.';
    }
  }
  if (message.type === 'metadataError') { metadataBase = null; setMetadataEnabled(false); authorsStatus.textContent = message.message; }
  if (message.type === 'metadataSaved') { const draft = authorDrafts.get(message.noteId); if (draft && draft.revision === message.revision) authorDrafts.delete(message.noteId); if (authorNoteId === message.noteId) { setMetadataEnabled(true); authorsStatus.textContent = message.warning || 'Metadata saved in the note.'; } }
  if (message.type === 'metadataSaveError' && authorNoteId === message.noteId) { setMetadataEnabled(true); authorsStatus.textContent = message.message; }
  if (message.type === 'metadataNotice' && authorNoteId === message.noteId) authorsStatus.textContent = message.message;
  if (message.type === 'citationPicking') { document.querySelector('#pick-citation').disabled = true; document.querySelector('#citation-result').hidden = true; document.querySelector('#citation-status').textContent = 'Choose a source in Zotero…'; }
  if (message.type === 'citationCancelled') { document.querySelector('#pick-citation').disabled = false; document.querySelector('#citation-status').textContent = 'No citation selected.'; }
  if (message.type === 'citationCopied') { document.querySelector('#pick-citation').disabled = false; document.querySelector('#citation-status').textContent = 'Copied. Paste into your note. Keep Zotero open to generate references, or use a configured bibliography file.'; const result = document.querySelector('#citation-result'); result.textContent = message.citation; result.hidden = false; }
  if (message.type === 'citationError') { document.querySelector('#pick-citation').disabled = false; document.querySelector('#citation-status').textContent = `No citation copied. ${message.message}`; }
  if (message.type === 'footnoteCopied') footnoteStatus.textContent = 'Copied. Paste it into the note where the number should appear.';
  if (message.type === 'footnoteError') footnoteStatus.textContent = message.message;
  if (message.type === 'clear') { previewStatus = 'idle'; document.querySelector('#open-pdf').disabled = true; pdf.clear(); clearError(); status.textContent = message.message || 'Preparing preview…'; }
  if (message.type === 'waiting') { previewStatus = 'waiting'; pdf.cancelPendingLoad(); clearError(); status.textContent = 'Waiting for typing to pause…'; }
  if (message.type === 'building') { previewStatus = 'building'; pdf.cancelPendingLoad(); clearError(); status.textContent = 'Building PDF preview…'; }
  if (message.type === 'pdf') { previewStatus = 'rendering'; document.querySelector('#open-pdf').disabled = false; clearError(); status.textContent = 'Rendering preview…'; void pdf.load(message.base64); }
  if (message.type === 'pdfOpened') status.textContent = 'Opened a PDF snapshot.';
  if (message.type === 'openPdfError') { errorText.textContent = message.message; errors.hidden = false; errors.open = true; }
  if (message.type === 'exporting') status.textContent = `Exporting ${message.format === 'tex' ? 'LaTeX' : 'PDF'}…`;
  if (message.type === 'exported') { clearError(); status.textContent = `Saved to ${message.file}`; }
  if (message.type === 'error') { status.textContent = 'Could not build the paper. The last preview is shown if available.'; errorText.textContent = message.message; errors.hidden = false; errors.open = true; }
});
send({ type: 'ready' });
