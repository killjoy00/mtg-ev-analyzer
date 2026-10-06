import assert from 'node:assert/strict';
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const git=(args,{cwd=process.cwd(),allowFailure=false}={})=>{try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch(error){if(allowFailure)return null;throw error;}};
const jsonEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bySlug=entries=>new Map(entries.map(entry=>[entry.slug,entry]));

export function parseNameStatus(text){
  const changes=[];
  for(const raw of String(text||'').split('\n').filter(Boolean)){
    const fields=raw.split('\t'),status=fields[0];
    assert.match(status,/^[AMD]$/,'publication fast path rejects renames, copies and type changes');
    assert.equal(fields.length,2,'publication diff entry must contain one path');
    changes.push({status,path:fields[1]});
  }
  return changes;
}
function changedRegistryEntries(before,after){
  const a=bySlug(before),b=bySlug(after),slugs=new Set([...a.keys(),...b.keys()]);
  return [...slugs].filter(slug=>!jsonEqual(a.get(slug),b.get(slug))).map(slug=>({slug,before:a.get(slug),after:b.get(slug)}));
}
function readBaseJson(base,path,{cwd}){return JSON.parse(git(['show',`${base}:${path}`],{cwd}));}
function statusMap(changes){return new Map(changes.map(change=>[change.path,change.status]));}

export function validatePublicationDiff({base,head,cwd=process.cwd()}={}){
  assert.match(String(base||''),/^[a-f0-9]{40}$/,'base SHA is required');
  assert.match(String(head||''),/^[a-f0-9]{40}$/,'head SHA is required');
  execFileSync('git',['merge-base','--is-ancestor',base,head],{cwd,stdio:'ignore'});
  const checkout=git(['rev-parse','HEAD'],{cwd});
  if(checkout!==head){
    // pull_request jobs check out GitHub's synthetic merge. Accept it only
    // when it merges this exact base/head and contains the unchanged head tree.
    assert.deepEqual(git(['show','-s','--format=%P',checkout],{cwd}).split(' '),[base,head],
      'publication checkout must be the exact head or its reviewed base/head merge');
    assert.equal(git(['rev-parse',`${checkout}^{tree}`],{cwd}),git(['rev-parse',`${head}^{tree}`],{cwd}),
      'publication merge checkout must contain the exact publication head tree');
  }
  const changes=parseNameStatus(git(['diff','--name-status','--find-renames',base,head],{cwd}));
  assert.ok(changes.length>0,'publication diff is empty');
  const statuses=statusMap(changes),paths=changes.map(change=>change.path).sort();

  if(paths.includes('campaign-links.json')){
    const routes=paths.filter(path=>/^go\/[^/]+\/index\.html$/.test(path));
    assert.equal(routes.length,1,'campaign publication must change exactly one generated route');
    assert.equal(paths.length,2,'campaign publication may only change the registry and one generated route');
    const slug=routes[0].split('/')[1];
    const delta=changedRegistryEntries(readBaseJson(base,'campaign-links.json',{cwd}),JSON.parse(readFileSync(`${cwd}/campaign-links.json`,'utf8')));
    assert.equal(delta.length,1,'campaign publication must change exactly one registry entry');
    assert.equal(delta[0].slug,slug,'campaign registry delta must match the generated route slug');
    let action;
    if(!delta[0].before&&delta[0].after){action='publish';assert.equal(statuses.get(routes[0]),'A','new campaign route must be added');assert.ok(existsSync(`${cwd}/${routes[0]}`));}
    else if(delta[0].before&&!delta[0].after){action='retire';assert.equal(statuses.get(routes[0]),'D','retired campaign route must be deleted');assert.equal(existsSync(`${cwd}/${routes[0]}`),false);}
    else throw new Error('campaign fast path only accepts a new publication or retirement, not attribution mutation');
    return {kind:'campaign',slug,action,paths};
  }

  assert.ok(paths.includes('creator-challenges.json'),'publication diff must contain exactly one known registry');
  const routes=paths.filter(path=>/^creator\/[^/]+\/index\.html$/.test(path));
  assert.equal(routes.length,1,'creator publication must change exactly one generated route');
  const slug=routes[0].split('/')[1],card=`creator/${slug}/creator-card.png`;
  const allowed=new Set(['creator-challenges.json',routes[0],card]);
  assert.ok(paths.length>=2&&paths.length<=3&&paths.every(path=>allowed.has(path)),'creator publication contains an unexpected path');
  const delta=changedRegistryEntries(readBaseJson(base,'creator-challenges.json',{cwd}),JSON.parse(readFileSync(`${cwd}/creator-challenges.json`,'utf8')));
  assert.equal(delta.length,1,'creator publication must change exactly one registry entry');
  assert.equal(delta[0].slug,slug,'creator registry delta must match the generated route slug');
  const change=delta[0];
  assert.ok(change.after,'creator retirement must retain a scrubbed registry tombstone');
  assert.ok(existsSync(`${cwd}/${routes[0]}`),'creator route must exist after publication/retirement');
  let action;
  if(!change.before&&change.after.status==='published'){
    action='publish';assert.equal(statuses.get(routes[0]),'A','new creator route must be added');assert.equal(statuses.get(card),'A','published creator route must add its deterministic card');assert.ok(existsSync(`${cwd}/${card}`),'published creator card is missing');
  }else if(change.after.status==='retired'&&(!change.before||change.before.status==='published')){
    action='retire';assert.equal(existsSync(`${cwd}/${card}`),false,'retired creator route must not retain a social card');
    if(change.before?.status==='published')assert.equal(statuses.get(card),'D','published creator retirement must delete the social card');
  }else throw new Error('creator fast path only accepts a new publication or a transition to retired');
  return {kind:'creator',slug,action,paths};
}

export function writeGithubOutputs(result,file=process.env.GITHUB_OUTPUT){if(!file)throw new Error('GITHUB_OUTPUT is required for --github-output.');appendFileSync(file,`kind=${result.kind}\nslug=${result.slug}\naction=${result.action}\n`);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  const result=validatePublicationDiff({base:get('--base')||process.env.CI_BASE_SHA,head:get('--head')||process.env.CI_HEAD_SHA||process.env.GITHUB_SHA});
  if(args.includes('--github-output'))writeGithubOutputs(result);
  console.log(`Validated ${result.kind} ${result.action} publication diff for ${result.slug}.`);
}
