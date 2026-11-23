'use strict';

const DOCUMENT_STYLE_KEY = 'joplin-scholar.document-style';
// Citation styles remain separate from document layouts.
const documentStyles = {
  default: {label:'Default / note settings', metadata:{}},
  article: {label:'Standard article', metadata:{documentclass:'article', fontsize:'11pt', geometry:'margin=1in', linestretch:1.15}},
  manuscript: {label:'Double-spaced manuscript', metadata:{documentclass:'article', fontsize:'12pt', geometry:'margin=1in', linestretch:2}},
  compact: {label:'Compact article', metadata:{documentclass:'article', fontsize:'10pt', geometry:'margin=0.75in', linestretch:1}},
  report: {label:'Report', metadata:{documentclass:'report', fontsize:'11pt', geometry:'margin=1in', linestretch:1.15}},
  book: {label:'Standard book', metadata:{documentclass:'book', fontsize:'11pt'}, chapterStyle:true},
  komabook: {label:'KOMA-Script book', metadata:{documentclass:'scrbook', fontsize:'11pt'}, chapterStyle:true},
  komareport: {label:'KOMA-Script report', metadata:{documentclass:'scrreprt', fontsize:'11pt'}, chapterStyle:true},
  memoir: {label:'Memoir book', metadata:{documentclass:'memoir', fontsize:'11pt'}, chapterStyle:true},
  classicthesis: {label:'ClassicThesis', metadata:{documentclass:'scrbook', fontsize:'11pt'}, chapterStyle:true, preamble:'classicthesis'},
  tufte: {label:'Tufte book', metadata:{documentclass:'tufte-book', classoption:['nols','nobib','notitlepage']}, chapterStyle:true},
  koma: {label:'KOMA-Script article', metadata:{documentclass:'scrartcl', fontsize:'11pt'}},
  apa7: {label:'APA 7 manuscript', metadata:{documentclass:'apa7', classoption:['man']}, adapter:'apa7'},
  elsevier: {label:'Elsevier article', metadata:{documentclass:'elsarticle', classoption:['preprint']}, adapter:'elsevier'},
  ieee: {label:'IEEE journal article', metadata:{documentclass:'IEEEtran', classoption:['journal'], numbersections:true}, adapter:'ieee'},
  acm: {label:'ACM manuscript', metadata:{documentclass:'acmart', classoption:['manuscript','nonacm'], numbersections:true}, adapter:'acm'},
  revtex: {label:'REVTeX physics manuscript', metadata:{documentclass:'revtex4-2', classoption:['aps','preprint'], numbersections:true}, adapter:'revtex'},
  springer: {label:'Springer Nature journal', metadata:{documentclass:'sn-jnl', classoption:['pdflatex','sn-basic'], numbersections:true}, adapter:'springer'},
};
function documentStyleId(value) {
  return typeof value === 'string' && Object.hasOwn(documentStyles, value) ? value : null;
}
const layoutFields = ['documentclass','classoption','fontsize','geometry','linestretch','margin-left','margin-right','margin-top','margin-bottom'];
function layoutOverrides(metadata) {
  return layoutFields.filter(field => Object.hasOwn(metadata || {}, field));
}
function layoutDefaults(id, metadata) {
  const style = documentStyles[documentStyleId(id) || 'default'];
  const defaults = {...style.metadata};
  // Publisher class options cannot safely be applied to a different class.
  if ((style.adapter || style.chapterStyle) && metadata?.documentclass && metadata.documentclass !== defaults.documentclass) {
    delete defaults.classoption;
    delete defaults.numbersections;
  }
  // Pandoc gives geometry precedence over individual margin fields. When the
  // note supplies any margin field, leave the preset geometry out altogether.
  if (layoutOverrides(metadata).some(field => field === 'geometry' || field.startsWith('margin-'))) delete defaults.geometry;
  return defaults;
}
module.exports = {DOCUMENT_STYLE_KEY, documentStyles, documentStyleId, layoutDefaults, layoutOverrides};
