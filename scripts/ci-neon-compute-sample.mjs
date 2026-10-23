import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

// Neon's branch consumption counters lag 15-60 minutes, longer than most CI
// branches live. neon_utils.num_cpus() reports the compute's current
// allocation instead, rounded up to whole CPUs (0.25 CU reads as 1).
export function summarizeCpuSamples(samples) {
  const ok=samples.filter(s=>Number.isFinite(s.t)&&Number.isInteger(s.cpus)&&s.cpus>0).sort((a,b)=>a.t-b.t);
  if(ok.length<2)return null;
  const seconds={};let total=0;
  for(let i=1;i<ok.length;i++) {
    const span=(ok[i].t-ok[i-1].t)/1000;
    seconds[ok[i-1].cpus]=(seconds[ok[i-1].cpus]||0)+span;total+=span;
  }
  if(!(total>0))return null;
  const share=Object.fromEntries(Object.entries(seconds).map(([cpus,s])=>[cpus,s/total]));
  const mean=Object.entries(seconds).reduce((sum,[cpus,s])=>sum+cpus*s,0)/total;
  return {minutes:total/60,share,mean,max:Math.max(...ok.map(s=>s.cpus)),samples:ok.length};
}

export function describeCpuSummary(summary,{domain,maxCu}) {
  if(!summary)return `Neon compute for ${domain}: no allocation samples.`;
  const shares=Object.entries(summary.share).sort((a,b)=>a[0]-b[0])
    .map(([cpus,s])=>`${cpus} CPU ${Math.round(100*s)}%`).join(', ');
  return `Neon compute for ${domain} (cap ${maxCu||'project default'} CU): ${summary.minutes.toFixed(1)} min sampled; `+
    `${shares}; peak ${summary.max}; mean at most ${summary.mean.toFixed(2)} CU.`;
}

async function sample(connectionFile,out,intervalSeconds) {
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  let query;
  try {query=corpusDatabase(connectionFile);await query('CREATE EXTENSION IF NOT EXISTS neon_utils');}
  catch {fs.appendFileSync(out,JSON.stringify({unavailable:true})+'\n');return;}
  for(;;) {
    const t=Date.now();
    try {fs.appendFileSync(out,JSON.stringify({t,cpus:Number((await query('SELECT num_cpus() n')).rows[0].n)})+'\n');}
    catch {fs.appendFileSync(out,JSON.stringify({t,error:true})+'\n');}
    await new Promise(r=>setTimeout(r,Math.max(0,intervalSeconds*1000-(Date.now()-t))));
  }
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const [mode,...args]=process.argv.slice(2);
  if(mode==='sample')await sample(args[0],args[1],Number(args[2]||5));
  else if(mode==='summary') {
    const [file,domain,maxCu]=args;
    const samples=fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
    const line=describeCpuSummary(summarizeCpuSamples(samples),{domain,maxCu});
    console.log(line);
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,line+'\n');
  } else {
    console.error('Usage: ci-neon-compute-sample.mjs sample <connection-file> <out> [seconds] | summary <out> <domain> [max-cu]');
    process.exitCode=2;
  }
}
