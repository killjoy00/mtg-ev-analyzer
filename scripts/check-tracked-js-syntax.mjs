// Syntax-check every tracked JavaScript source instead of a hand-maintained
// list. Run entirely offline, using the same Node parser as the app/CI.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SOURCE_EXT=/\.(?:js|mjs|cjs)$/;
const GENERATED_ROOT=/^(?:artifacts|node_modules|generated|raw-data|data|coverage|dist|\.next)\//;
const DEFAULT_CONCURRENCY=4;

export function selectTrackedJavaScript(indexText) {
  if(typeof indexText!=='string'||!indexText.endsWith('\0')) {
    throw new Error('Git index listing was missing or incomplete');
  }
  const files=indexText.slice(0,-1).split('\0');
  if(files.some(file=>!file||file.includes('\0'))) {
    throw new Error('Git index contained an invalid file name');
  }
  const selected=files.filter(file=>SOURCE_EXT.test(file)&&!GENERATED_ROOT.test(file));
  if(!selected.length)throw new Error('No tracked JavaScript source files found');
  return [...new Set(selected)].sort();
}

export function listTrackedJavaScript({cwd=process.cwd()}={}) {
  const result=spawnSync('git',['ls-files','--cached','-z'],{
    cwd,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],
  });
  if(result.error||result.status!==0||result.signal) {
    throw new Error('Unable to read complete tracked-source index');
  }
  return selectTrackedJavaScript(result.stdout);
}

export function syntaxCheck(file,{cwd=process.cwd()}={}) {
  return new Promise(resolveResult=>{
    // Argument array (no shell), so spaces and unusual tracked names are safe.
    const child=spawn(process.execPath,['--check','--',file],{
      cwd,stdio:['ignore','ignore','pipe'],
    });
    let stderr='',done=false;
    const finish=(ok,message='')=>{
      if(done)return;
      done=true;resolveResult({ok,message});
    };
    child.stderr.on('data',chunk=>{
      if(stderr.length<8192)stderr+=String(chunk).slice(0,8192-stderr.length);
    });
    child.on('error',()=>finish(false,'Unable to start syntax parser'));
    child.on('close',(code,signal)=>finish(code===0&&!signal,stderr.trim()));
  });
}

export async function checkTrackedJavaScript(files,{cwd=process.cwd(),concurrency=DEFAULT_CONCURRENCY,check=syntaxCheck}={}) {
  if(!Array.isArray(files)||!files.length||!Number.isInteger(concurrency)||
    concurrency<1||concurrency>8)throw new Error('Invalid syntax-check selection');
  const failures=[];let index=0;
  await Promise.all(Array.from({length:Math.min(files.length,concurrency)},async()=>{
    for(;;){
      const current=index++;
      if(current>=files.length)return;
      const file=files[current];
      if(!existsSync(resolve(cwd,file))) {
        failures.push({file,message:'Tracked file is missing'});continue;
      }
      let result;
      try {result=await check(file,{cwd});}
      catch {result={ok:false,message:'Syntax parser failed'};}
      if(!result?.ok)failures.push({file,message:String(result?.message||'Invalid syntax').slice(0,2048)});
    }
  }));
  return {tested:files.length,failures:failures.sort((a,b)=>a.file.localeCompare(b.file))};
}

async function main() {
  const cwd=process.cwd(),started=Date.now();
  const files=listTrackedJavaScript({cwd});
  const result=await checkTrackedJavaScript(files,{cwd});
  console.log('Tracked JavaScript syntax: '+(result.tested-result.failures.length)+'/'+result.tested+
    ' passed in '+((Date.now()-started)/1000).toFixed(1)+'s');
  if(result.failures.length){
    for(const problem of result.failures.slice(0,25)){
      console.error('FAIL '+JSON.stringify(problem.file)+': '+problem.message);
    }
    if(result.failures.length>25)console.error('... and '+(result.failures.length-25)+' more failures');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error('Tracked JavaScript syntax validation failed: '+error.message);process.exitCode=1;});
}
