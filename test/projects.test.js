'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {unzipSync}=require('fflate');
const {execFileSync}=require('node:child_process');
const {resolveProject}=require('../src/projects');
const {compile,clean,exportBundle}=require('../src/compiler');
const a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('assembles nested notes in order, skips child YAML and preserves code examples',async()=>{
  const notes={[a]:{id:a,body:'---\ntitle: Child\n---\n\n# First\n\n{{include-note:'+b+'}}'},[b]:{id:b,body:'# Second'}};
  const data={get:async ([,id])=>notes[id]};
  const root={id:'root',body:'---\ntitle: Paper\n---\n\n{{include-note:'+a+'}}\n\n```\n{{include-note:'+b+'}}\n```'};
  const result=await resolveProject(root,data);
  assert.ok(result.body.indexOf('# First')<result.body.indexOf('# Second'));
  assert.doesNotMatch(result.body,/title: Child/);
  assert.match(result.body,/```\n\{\{include-note:/);
  assert.equal(root.body.includes('# First'),false);
  notes[b].body='{{include-note:'+a+'}}';
  await assert.rejects(resolveProject(root,data),/circular/);
  await assert.rejects(resolveProject(root,{get:async()=>{throw new Error('missing');}}),/Could not load included note/);
});

test('creates an Overleaf ZIP with the generated source and image', {skip:!process.env.SCHOLAR_TEST_PANDOC},async()=>{
  const id='1234567890abcdef1234567890abcdef', root=await fs.mkdtemp(path.join(os.tmpdir(),'scholar-bundle-test-'));
  let result;
  try {
    result=await compile({id:'paper',title:'Paper',body:`# Results\n\n![Sample](:/${id})`},{resourcePath:async()=>path.join(__dirname,'figure.png')},{pandoc:process.env.SCHOLAR_TEST_PANDOC},'tex');
    const archive=await exportBundle(result,root), files=unzipSync(new Uint8Array(await fs.readFile(archive)));
    assert.ok(files['Paper.tex']); assert.ok(files[`assets/${id}.png`]); assert.ok(files['README.txt']);
    assert.match(Buffer.from(files['Paper.tex']).toString(),/\\includegraphics/);
    const extracted=path.join(root,'extracted');
    for (const [name,bytes] of Object.entries(files)) { const file=path.join(extracted,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,bytes); }
    for (let i=0;i<2;i++) execFileSync('/Library/TeX/texbin/xelatex',['-interaction=nonstopmode','-halt-on-error','Paper.tex'],{cwd:extracted,timeout:60000,stdio:'ignore'});
    assert.equal((await fs.readFile(path.join(extracted,'Paper.pdf'))).subarray(0,5).toString(),'%PDF-');
  } finally {await clean(result);await fs.rm(root,{recursive:true,force:true});}
});
