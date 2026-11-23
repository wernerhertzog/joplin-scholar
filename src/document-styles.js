'use strict';

const DOCUMENT_STYLE_KEY = 'joplin-scholar.document-style';
// These are Pandoc defaults, not publisher-specific or citation styles.
const documentStyles = {
  default: {label:'Default / note settings', metadata:{}},
  article: {label:'Standard article', metadata:{documentclass:'article', fontsize:'11pt', geometry:'margin=1in', linestretch:1.15}},
  manuscript: {label:'Double-spaced manuscript', metadata:{documentclass:'article', fontsize:'12pt', geometry:'margin=1in', linestretch:2}},
  compact: {label:'Compact article', metadata:{documentclass:'article', fontsize:'10pt', geometry:'margin=0.75in', linestretch:1}},
  report: {label:'Report', metadata:{documentclass:'report', fontsize:'11pt', geometry:'margin=1in', linestretch:1.15}},
};
function documentStyleId(value) {
  return typeof value === 'string' && Object.hasOwn(documentStyles, value) ? value : null;
}
const layoutFields = ['documentclass','fontsize','geometry','linestretch','margin-left','margin-right','margin-top','margin-bottom'];
function layoutOverrides(metadata) {
  return layoutFields.filter(field => Object.hasOwn(metadata || {}, field));
}
function layoutDefaults(id, metadata) {
  const defaults = {...documentStyles[documentStyleId(id) || 'default'].metadata};
  // Pandoc gives geometry precedence over individual margin fields. When the
  // note supplies any margin field, leave the preset geometry out altogether.
  if (layoutOverrides(metadata).some(field => field === 'geometry' || field.startsWith('margin-'))) delete defaults.geometry;
  return defaults;
}
module.exports = {DOCUMENT_STYLE_KEY, documentStyles, documentStyleId, layoutDefaults, layoutOverrides};
