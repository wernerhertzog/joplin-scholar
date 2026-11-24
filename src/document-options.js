'use strict';

const DOCUMENT_OPTIONS_KEY = 'joplin-scholar.document-options';
const choices = {
  lineNumbers: ['default', 'on', 'off'],
  affiliations: ['default', 'below', 'end'],
  spacing: ['default', 'single', 'onehalf', 'double'],
  sections: ['default', 'on', 'off'],
  paperSize: ['default', 'a4', 'letter'],
};
function normalizeDocumentOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid document options.');
  const result = {};
  for (const [key, allowed] of Object.entries(choices)) {
    const value = input[key] ?? 'default';
    if (!allowed.includes(value)) throw new Error(`Invalid document option: ${key}.`);
    result[key] = value;
  }
  return result;
}

module.exports = {DOCUMENT_OPTIONS_KEY, normalizeDocumentOptions};
