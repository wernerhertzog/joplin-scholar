'use strict';
function plain(value, max = 500) { return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
function tableMarkdown(rows, caption) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 21 || !Array.isArray(rows[0]) || rows[0].length < 1 || rows[0].length > 10 || rows.some(row => !Array.isArray(row) || row.length !== rows[0].length)) throw new Error('Choose 1–20 body rows and 1–10 columns.');
  const cell = value => plain(value).replace(/\|/g, '\\|');
  const line = row => `| ${row.map(cell).join(' | ')} |`;
  const lines = [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)];
  const name = plain(caption);
  if (name) lines.push('', `Table: ${name}`);
  return lines.join('\n');
}
module.exports = { tableMarkdown };
