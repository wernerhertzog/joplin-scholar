import { getDocument, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfPreview } from './pdf-preview';

const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
const errors = document.querySelector('#errors');
const errorText = document.querySelector('#error-text');
const authorsList = document.querySelector('#authors-list');
const authorsStatus = document.querySelector('#authors-status');
const addAuthorButton = document.querySelector('#add-author');
const saveAuthorsButton = document.querySelector('#save-authors');
const footnoteText = document.querySelector('#footnote-text');
const footnoteStatus = document.querySelector('#footnote-status');
let authorNoteId = null, authorRevision = 0, authorsInMarkdown = false;
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
document.addEventListener('click', event => { if (exportMenu.open && !exportMenu.contains(event.target)) exportMenu.open = false; });
document.querySelector('#export-pdf').addEventListener('click', () => { exportMenu.open = false; send({ type: 'export', format: 'pdf' }); });
document.querySelector('#export-tex').addEventListener('click', () => { exportMenu.open = false; send({ type: 'export', format: 'tex' }); });
function readAuthors() {
  return [...authorsList.querySelectorAll('.author-row')].map(row => ({
    name: row.querySelector('.author-name').value,
    email: row.querySelector('.author-email').value,
    affiliations: row.querySelector('.author-affiliations').value.split('\n'),
    corresponding: row.querySelector('.author-corresponding').checked,
  }));
}
function authorChanged() {
  if (!authorNoteId) return;
  authorRevision++;
  authorDrafts.set(authorNoteId, readAuthors());
  authorsStatus.textContent = 'Unsaved changes';
}
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
  const noneLabel = document.createElement('label');
  noneLabel.className = 'corresponding-choice';
  const none = document.createElement('input');
  none.type = 'radio'; none.name = 'corresponding-author'; none.checked = !authors.some(a => a.corresponding);
  none.addEventListener('change', authorChanged);
  noneLabel.append(none, document.createTextNode(' No corresponding author selected'));
  authorsList.appendChild(noneLabel);
  authors.forEach((author, index) => {
    const row = document.createElement('section'); row.className = 'author-row';
    const heading = document.createElement('strong'); heading.textContent = `Author ${index + 1}`; row.appendChild(heading);
    row.appendChild(field('Name', author.name, 'author-name'));
    row.appendChild(field('Affiliations (one per line)', (author.affiliations || []).join('\n'), 'author-affiliations', true));
    row.appendChild(field('Email (shown for corresponding author)', author.email, 'author-email'));
    const choice = document.createElement('label'); choice.className = 'corresponding-choice';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'corresponding-author'; radio.className = 'author-corresponding'; radio.checked = !!author.corresponding;
    choice.append(radio, document.createTextNode(' Corresponding author')); row.appendChild(choice);
    const actions = document.createElement('div'); actions.className = 'actions';
    const move = (label, action, disabled = false) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = disabled; button.addEventListener('click', action); actions.appendChild(button); };
    move('↑', () => { const values = readAuthors(); [values[index - 1], values[index]] = [values[index], values[index - 1]]; renderAuthors(values); authorChanged(); }, index === 0);
    move('↓', () => { const values = readAuthors(); [values[index + 1], values[index]] = [values[index], values[index + 1]]; renderAuthors(values); authorChanged(); }, index === authors.length - 1);
    move('Remove', () => { const values = readAuthors(); values.splice(index, 1); renderAuthors(values); authorChanged(); });
    row.appendChild(actions); row.addEventListener('input', authorChanged); row.addEventListener('change', authorChanged);
    authorsList.appendChild(row);
  });
}
addAuthorButton.addEventListener('click', () => { if (!authorNoteId || authorsInMarkdown) return; const values = readAuthors(); values.push({ name:'', email:'', affiliations:[], corresponding:false }); renderAuthors(values); authorChanged(); });
saveAuthorsButton.addEventListener('click', () => { if (authorNoteId && !authorsInMarkdown) { saveAuthorsButton.disabled = true; authorsStatus.textContent = 'Saving…'; send({ type:'saveAuthors', noteId:authorNoteId, authors:readAuthors(), revision:authorRevision }); } });
document.querySelector('#pick-citation').addEventListener('click', () => send({type:'pickCitation'}));
document.querySelector('#copy-footnote').addEventListener('click', () => { footnoteStatus.textContent = 'Preparing footnote…'; send({ type:'copyFootnote', text:footnoteText.value }); });
const styleSelect = document.querySelector('#citation-style');
const styleStatus = document.querySelector('#style-status');
styleSelect.addEventListener('change', () => { styleSelect.disabled = true; styleStatus.hidden = false; styleStatus.textContent = 'Saving style…'; send({type:'setStyle', noteId:styleNoteId, value:styleSelect.value}); });
const documentStyleSelect = document.querySelector('#document-style');
const documentStyleStatus = document.querySelector('#document-style-status');
let documentStyleNoteId = null;
documentStyleSelect.addEventListener('change', () => { documentStyleSelect.disabled = true; documentStyleStatus.hidden = false; documentStyleStatus.textContent = 'Saving document style…'; send({type:'setDocumentStyle', noteId:documentStyleNoteId, value:documentStyleSelect.value}); });
const grid = document.querySelector('#table-grid');
function makeGrid() {
  const rows = Number(document.querySelector('#table-rows').value), columns = Number(document.querySelector('#table-cols').value);
  const tableStatus = document.querySelector('#table-status');
  if (!Number.isInteger(rows) || rows < 1 || rows > 20 || !Number.isInteger(columns) || columns < 1 || columns > 10) { tableStatus.textContent = 'Choose 1–20 body rows and 1–10 columns.'; return; }
  const previous = [...grid.querySelectorAll('tr')].map(row => [...row.querySelectorAll('input')].map(input => input.value));
  const table = document.createElement('table');
  for (let r = 0; r <= rows; r++) {
    const row = table.insertRow();
    for (let c = 0; c < columns; c++) {
      const cell = row.insertCell(), input = document.createElement('input');
      input.type = 'text'; input.value = previous[r]?.[c] || ''; input.placeholder = r === 0 ? `Header ${c + 1}` : '';
      input.setAttribute('aria-label', r === 0 ? `Header column ${c + 1}` : `Row ${r}, column ${c + 1}`); cell.appendChild(input);
    }
  }
  grid.replaceChildren(table); tableStatus.textContent = '';
}
document.querySelector('#table-resize').addEventListener('click', makeGrid);
document.querySelector('#copy-table').addEventListener('click', () => send({type:'copyTable', rows:[...grid.querySelectorAll('tr')].map(row => [...row.querySelectorAll('input')].map(input => input.value)), caption:document.querySelector('#table-caption').value}));
makeGrid();
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
  if (message.type === 'paperChanged') { styleNoteId = null; styleSelect.disabled = true; styleStatus.hidden = true; documentStyleNoteId = null; documentStyleSelect.disabled = true; documentStyleStatus.hidden = true; }
  if (message.type === 'documentStyle') {
    documentStyleNoteId = message.noteId;
    documentStyleSelect.value = message.value;
    documentStyleSelect.disabled = !message.noteId;
    const notices = [];
    if (message.value !== 'default' && message.overrides?.length) notices.push(`YAML overrides: ${message.overrides.join(', ')}.`);
    if (message.value !== 'default' && message.customTemplate) notices.push('The custom template may ignore these settings.');
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
  if (message.type === 'tableCopied') document.querySelector('#table-status').textContent = 'Copied. Paste into the Markdown editor.';
  if (message.type === 'tableError') document.querySelector('#table-status').textContent = message.message;
  if (message.type === 'authorsLoading') { authorNoteId = null; authorsList.replaceChildren(); saveAuthorsButton.disabled = true; addAuthorButton.disabled = true; authorsStatus.textContent = 'Loading authors…'; }
  if (message.type === 'authors') { authorNoteId = message.noteId; authorRevision = 0; authorsInMarkdown = message.source === 'markdown'; const draft = authorsInMarkdown ? null : authorDrafts.get(authorNoteId); renderAuthors(draft || message.authors); if (authorsInMarkdown) for (const element of authorsList.querySelectorAll('input,textarea,button')) element.disabled = true; saveAuthorsButton.disabled = !authorNoteId || authorsInMarkdown; addAuthorButton.disabled = !authorNoteId || authorsInMarkdown; authorsStatus.textContent = !authorNoteId ? 'Select a note.' : authorsInMarkdown ? 'Authors are defined in Markdown. Edit the metadata at the start of the note; panel authors remain saved separately.' : draft ? 'Unsaved changes' : 'Authors saved with this note.'; }
  if (message.type === 'authorsError') { authorNoteId = null; saveAuthorsButton.disabled = true; addAuthorButton.disabled = true; authorsStatus.textContent = message.message; }
  if (message.type === 'authorsSaved' && authorNoteId === message.noteId) { saveAuthorsButton.disabled = false; if (authorRevision === message.revision) { authorDrafts.delete(authorNoteId); authorsStatus.textContent = 'Authors saved.'; } else authorsStatus.textContent = 'Saved; newer changes are not yet saved.'; }
  if (message.type === 'authorsSaveError' && authorNoteId === message.noteId) { saveAuthorsButton.disabled = false; authorsStatus.textContent = message.message; }
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
