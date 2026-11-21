'use strict';
const styles = require('./styles/styles.json');
const STYLE_KEY = 'joplin-scholar.citation-style';
const labels = {
  'apa': 'APA 7th edition',
  'apa-6th-edition': 'APA 6th edition',
  'modern-language-association': 'MLA 9th edition',
  'chicago-author-date': 'Chicago 18th: author-date',
  'chicago-notes-bibliography': 'Chicago 18th: notes and bibliography',
  'harvard-cite-them-right': 'Harvard: Cite Them Right',
  'ieee': 'IEEE',
  'nlm-citation-sequence': 'NLM / Vancouver',
  'american-medical-association': 'AMA 11th edition',
  'american-chemical-society': 'ACS Guide 2026',
  'american-sociological-association': 'ASA 6th/7th edition',
  'american-political-science-association': 'APSA',
  'american-anthropological-association': 'American Anthropological Association',
  'american-geophysical-union': 'American Geophysical Union',
  'american-heart-association': 'American Heart Association',
  'american-institute-of-physics': 'AIP 4th edition',
  'association-for-computing-machinery': 'ACM',
  'cse-citation-sequence': 'CSE 9th: citation sequence',
  'nature': 'Nature',
  'science': 'Science',
  'cell': 'Cell',
  'the-new-england-journal-of-medicine': 'New England Journal of Medicine',
  'bluebook-law-review': 'Bluebook Law Review',
  'oscola': 'OSCOLA 4th edition',
};
const aliases = {mla:'modern-language-association', harvard:'harvard-cite-them-right', vancouver:'nlm-citation-sequence', ama:'american-medical-association', acs:'american-chemical-society', asa:'american-sociological-association', apsa:'american-political-science-association', aip:'american-institute-of-physics', acm:'association-for-computing-machinery'};
function styleId(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/\.csl$/, '');
  return Object.hasOwn(styles, key) ? key : aliases[key] || null;
}
module.exports = { STYLE_KEY, labels, styleId, styles };
