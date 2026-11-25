'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {writingWarning}=require('../src/writing-diagnostics');
test('warns about escaped citations without flagging code examples or YAML',()=>{
  assert.match(writingWarning('A claim \\[@smith2020\\].'),/rich-text/);
  assert.equal(writingWarning('~~~md\n\\[@smith2020\\]\n~~~\n\n`\\[@other\\]`'),'');
  assert.equal(writingWarning('---\nexample: "\\\\[@smith\\\\]"\n---\n\nA claim [@smith].'),'');
});
