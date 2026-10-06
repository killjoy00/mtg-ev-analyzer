import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validatePublicationDiff} from '../scripts/ci-publication-validate.mjs';

const run=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'ignore'});
function fixture(){
  const root=mkdtempSync(path.join(tmpdir(),'publication-ci-'));
  run(root,'init','-q');run(root,'config','user.email','ci@example.test');run(root,'config','user.name','CI');
  writeFileSync(path.join(root,'campaign-links.json'),'[]\n');writeFileSync(path.join(root,'creator-challenges.json'),'[]\n');
  run(root,'add','.');run(root,'commit','-qm','base');
  const base=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  return {root,base,commit(message='head'){run(root,'add','-A');run(root,'commit','-qm',message);return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}};
}

test('ordinary campaign publish and retirement validate exact registry/route output',t=>{
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const entry={slug:'newsletter',destination:'/',source:'news',campaign:'launch'};
  writeFileSync(path.join(f.root,'campaign-links.json'),JSON.stringify([entry],null,2)+'\n');
  mkdirSync(path.join(f.root,'go/newsletter'),{recursive:true});writeFileSync(path.join(f.root,'go/newsletter/index.html'),'generated');
  const published=f.commit('publish');
  assert.deepEqual(validatePublicationDiff({base:f.base,head:published,cwd:f.root}),{kind:'campaign',slug:'newsletter',action:'publish',paths:['campaign-links.json','go/newsletter/index.html']});
  writeFileSync(path.join(f.root,'campaign-links.json'),'[]\n');rmSync(path.join(f.root,'go/newsletter'),{recursive:true});
  const retired=f.commit('retire');assert.equal(validatePublicationDiff({base:published,head:retired,cwd:f.root}).action,'retire');
});

test('creator publish and privacy retirement require the deterministic card lifecycle',t=>{
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const entry={id:'11111111-1111-4111-8111-111111111111',slug:'lola',status:'published',creator_name:'Lola'};
  writeFileSync(path.join(f.root,'creator-challenges.json'),JSON.stringify([entry],null,2)+'\n');
  mkdirSync(path.join(f.root,'creator/lola'),{recursive:true});writeFileSync(path.join(f.root,'creator/lola/index.html'),'published');writeFileSync(path.join(f.root,'creator/lola/creator-card.png'),'card');
  const published=f.commit('publish creator');assert.equal(validatePublicationDiff({base:f.base,head:published,cwd:f.root}).action,'publish');
  writeFileSync(path.join(f.root,'creator-challenges.json'),JSON.stringify([{id:entry.id,slug:'lola',status:'retired'}],null,2)+'\n');
  writeFileSync(path.join(f.root,'creator/lola/index.html'),'retired');rmSync(path.join(f.root,'creator/lola/creator-card.png'));
  const retired=f.commit('retire creator');const result=validatePublicationDiff({base:published,head:retired,cwd:f.root});
  assert.equal(result.action,'retire');assert.equal(existsSync(path.join(f.root,'creator/lola/creator-card.png')),false);
});

test('privacy can create a scrubbed retired route without ever publishing a card',t=>{
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const retired={id:'11111111-1111-4111-8111-111111111111',slug:'private',status:'retired'};
  writeFileSync(path.join(f.root,'creator-challenges.json'),JSON.stringify([retired],null,2)+'\n');
  mkdirSync(path.join(f.root,'creator/private'),{recursive:true});writeFileSync(path.join(f.root,'creator/private/index.html'),'retired');
  const head=f.commit('privacy retirement');assert.equal(validatePublicationDiff({base:f.base,head,cwd:f.root}).action,'retire');
});

test('mixed or forged publication diffs are rejected even when names look plausible',t=>{
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  writeFileSync(path.join(f.root,'creator-challenges.json'),JSON.stringify([{id:'1',slug:'lola',status:'retired'}],null,2)+'\n');
  mkdirSync(path.join(f.root,'creator/lola'),{recursive:true});writeFileSync(path.join(f.root,'creator/lola/index.html'),'retired');writeFileSync(path.join(f.root,'worker.js'),'unrelated');
  const head=f.commit('mixed');assert.throws(()=>validatePublicationDiff({base:f.base,head,cwd:f.root}),/unexpected path/);
});

test('campaign attribution mutation does not qualify as publication fast path',t=>{
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const initial={slug:'news',destination:'/',source:'a',campaign:'launch'};
  writeFileSync(path.join(f.root,'campaign-links.json'),JSON.stringify([initial],null,2)+'\n');mkdirSync(path.join(f.root,'go/news'),{recursive:true});writeFileSync(path.join(f.root,'go/news/index.html'),'a');
  const published=f.commit('published');
  writeFileSync(path.join(f.root,'campaign-links.json'),JSON.stringify([{...initial,source:'b'}],null,2)+'\n');writeFileSync(path.join(f.root,'go/news/index.html'),'b');
  const changed=f.commit('mutated');assert.throws(()=>validatePublicationDiff({base:published,head:changed,cwd:f.root}),/not attribution mutation/);
});

function publicationMergeFixture(t){
  const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  run(f.root,'checkout','-qb','publication');
  writeFileSync(path.join(f.root,'campaign-links.json'),JSON.stringify([{slug:'news',destination:'/',source:'news',campaign:'launch'}])+'\n');
  mkdirSync(path.join(f.root,'go/news'),{recursive:true});writeFileSync(path.join(f.root,'go/news/index.html'),'generated');
  const head=f.commit('publish');
  run(f.root,'checkout','-q','--detach',f.base);
  return {...f,head,merge(){run(f.root,'merge','--no-ff','-qm','synthetic PR merge',head);}};
}

test('default pull-request merge checkout validates the exact publication head',t=>{
  const f=publicationMergeFixture(t);f.merge();
  assert.equal(validatePublicationDiff({base:f.base,head:f.head,cwd:f.root}).action,'publish');
});

test('merge checkout rejects a moved base even when the head is unchanged',t=>{
  const f=publicationMergeFixture(t);
  writeFileSync(path.join(f.root,'unrelated.txt'),'main advanced');f.commit('advance main');f.merge();
  assert.throws(()=>validatePublicationDiff({base:f.base,head:f.head,cwd:f.root}),/reviewed base\/head merge/);
});

test('merge checkout rejects changed generated bytes despite matching parents',t=>{
  const f=publicationMergeFixture(t);f.merge();
  writeFileSync(path.join(f.root,'go/news/index.html'),'tampered merge output');
  run(f.root,'add','.');run(f.root,'commit','--amend','--no-edit','-q');
  assert.throws(()=>validatePublicationDiff({base:f.base,head:f.head,cwd:f.root}),/exact publication head tree/);
});
