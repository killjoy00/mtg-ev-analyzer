import {spawnSync} from 'node:child_process';
import {readdir,readFile,access} from 'node:fs/promises';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SHARD_REQUIREMENTS = new Map([
  ['consensus-audit.test.mjs',['msh']],
  ['path-model-distribution.test.mjs',['msh','sos','tmt','ecl']],
  ['scoring-distribution.test.mjs',['msh','sos','tmt','ecl']],
]);
export const DATA_TESTS = [...SHARD_REQUIREMENTS.keys(),'draft-run-corpus.test.mjs'];

export function planJsTests(names,{lane='auto',available=new Map(),requireShards=false}={}) {
  if(!['auto','fast','data','full'].includes(lane))throw Error('Unknown JavaScript test lane: '+lane);
  const inventory=[...new Set(names)].sort();
  for(const name of DATA_TESTS)if(!inventory.includes(name))throw Error('Registered data suite missing: '+name);
  const wanted=inventory.filter(name=>lane==='fast'?!SHARD_REQUIREMENTS.has(name):lane==='data'?DATA_TESTS.includes(name):true);
  const missing=wanted.filter(name=>SHARD_REQUIREMENTS.has(name)&&SHARD_REQUIREMENTS.get(name).some(id=>!available.get(id)));
  if(missing.length&&(lane==='data'||lane==='full'||requireShards))throw Error('Required replay inputs are missing for: '+missing.join(', '));
  const selected=wanted.filter(name=>!missing.includes(name));
  if(!selected.length)throw Error('JavaScript test selection is empty.');
  return {lane,inventory,selected,excluded:inventory.filter(name=>!selected.includes(name)),missing};
}

async function shardsComplete(id) {
  try {
    const manifest=JSON.parse(await readFile(join('data',id,'manifest.json'),'utf8'));
    if(!Array.isArray(manifest.shards)||!manifest.shards.length)return false;
    for(const shard of manifest.shards)await access(shard.path.replace(/^\.\//,''));
    return true;
  } catch {return false;}
}

async function main() {
  const args=process.argv.slice(2),lane=args.includes('--lane')?args[args.indexOf('--lane')+1]:'auto';
  if(args.includes('--lane')&&!lane)throw Error('--lane requires fast, data, full or auto');
  const requireShards=process.env.REQUIRE_REPLAY_SHARDS==='1';
  const inventory=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs'));
  const available=new Map();
  if(lane!=='fast')for(const ids of SHARD_REQUIREMENTS.values())for(const id of ids)if(!available.has(id))available.set(id,await shardsComplete(id));
  const started=Date.now(),summaryFile=process.env.PACK1_TEST_REPORT||`artifacts/tests/js-${lane}.json`;
  let plan,result;
  try {
    plan=planJsTests(inventory,{lane,available,requireShards});
    console.log(`JS lane ${lane}: selected ${plan.selected.length}/${plan.inventory.length} files; excluded ${plan.excluded.length}.`);
    if(plan.excluded.length)console.log('Other lane or unavailable inputs: '+plan.excluded.join(', '));
    result=spawnSync(process.execPath,[...(lane==='fast'?['--import','./tests/offline-network-guard.mjs']:[]),'--test',...plan.selected.map(name=>join('tests',name))],{
      stdio:'inherit',env:{...process.env,PACK1_TEST_DATA_MODE:['data','full'].includes(lane)||requireShards||(lane==='auto'&&['msh','sos','tmt','ecl'].every(id=>available.get(id)))?'full':'fast'},timeout:lane==='fast'?180000:900000,
    });
    if(result.error)console.error('Test process failed: '+result.error.code);
  } catch(error) {
    mkdirSync(dirname(summaryFile),{recursive:true});
    writeFileSync(summaryFile,JSON.stringify({lane,status:'failed',phase:'selection',message:error.message,inventory},null,2));
    throw error;
  }
  const status=result.status===0?'passed':'failed';
  mkdirSync(dirname(summaryFile),{recursive:true});
  writeFileSync(summaryFile,JSON.stringify({...plan,status,phase:'assertions',source_sha:process.env.GITHUB_SHA||null,duration_ms:Date.now()-started,signal:result.signal||null},null,2));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nJavaScript ${lane}: ${status}; ${plan.selected.length}/${plan.inventory.length} files executed; ${plan.excluded.length} assigned elsewhere or unavailable. ${(Date.now()-started)/1000}s.\n`);
  process.exit(result.status??1);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
