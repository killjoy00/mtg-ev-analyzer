import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A heredoc body written at column 0 inside `run: |` silently ends the YAML block
// scalar. GitHub then cannot parse the workflow: it never runs, and every push
// records a failed run named after the file. No YAML parser ships with this
// repo's toolchain, so check the one invariant that failure breaks: the first
// line leaving a block scalar must itself be YAML structure.
const directory=new URL('../.github/workflows/',import.meta.url);
const indent=line=>line.length-line.trimStart().length;
const structural=/^\s*(?:#|- |-$|[A-Za-z0-9_.'"${}-]+\s*:(?:\s|$))/;

export function blockScalarEscapes(text) {
 const lines=text.split('\n'),problems=[];
 for(let i=0;i<lines.length;i++) {
  const opener=lines[i].match(/^(\s*)(?:- )?([A-Za-z0-9_-]+):\s*[|>][-+]?\s*$/);
  if(!opener)continue;
  const keyIndent=opener[1].length+(lines[i].trimStart().startsWith('- ')?2:0);
  let j=i+1;
  while(j<lines.length&&!lines[j].trim())j++;
  if(j>=lines.length)break;
  const content=indent(lines[j]);
  if(content<=keyIndent)continue;
  for(j++;j<lines.length;j++) {
   if(!lines[j].trim()||indent(lines[j])>=content)continue;
   if(!structural.test(lines[j]))problems.push({line:j+1,text:lines[j].trim(),block:i+1});
   break;
  }
 }
 return problems;
}

test('the block-scalar check catches a column-0 heredoc',()=>{
 const broken=['jobs:','  a:','    steps:','      - run: |','          python - <<\'PY\'','import json','PY','      - run: echo ok',''].join('\n');
 assert.deepEqual(blockScalarEscapes(broken).map(p=>p.text),['import json']);
 const fixed=broken.replace('\nimport json\nPY','\n          import json\n          PY');
 assert.deepEqual(blockScalarEscapes(fixed),[]);
});

test('no workflow line escapes its run block',()=>{
 for(const name of fs.readdirSync(directory).filter(file=>/\.ya?ml$/.test(file))) {
  const problems=blockScalarEscapes(fs.readFileSync(new URL(name,directory),'utf8'));
  assert.deepEqual(problems,[],`${name}: ${problems.map(p=>`line ${p.line} "${p.text}" escapes the block opened at line ${p.block}`).join('; ')}`);
 }
});
