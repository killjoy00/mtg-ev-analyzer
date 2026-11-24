// Private local research briefs; deliberately no publication or AI calls.
import {readFile,realpath,writeFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative,isAbsolute,sep} from 'node:path';
import {candidates,renderResearchBrief} from '../research/pack-one-lab/editorial.mjs';

async function main(){
  if(process.env.GITHUB_ACTIONS)throw Error('lab-private-output-required');
  const args=process.argv.slice(2);
  if(args.length!==4&&args.length!==6)throw Error('lab-triage-arguments');
  if(args[0]!=='--input'||args[2]!=='--out-dir'||(args.length===6&&args[4]!=='--exclude'))throw Error('lab-triage-arguments');
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const outside=path=>{const rel=relative(root,path);return isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep);};
  const input=await realpath(args[1]),out=await realpath(args[3]);
  const inputStat=await stat(input),outStat=await stat(out);
  if(!outside(input)||!outside(out)||!inputStat.isFile()||!outStat.isDirectory())throw Error('lab-private-output-required');
  if(process.platform!=='win32'&&((inputStat.mode&0o077)!==0||(outStat.mode&0o077)!==0))throw Error('lab-private-output-required');
  if(inputStat.size>2*1024*1024)throw Error('lab-input-size');
  const report=JSON.parse(await readFile(input,'utf8'));
  const excludedIds=args.length===6?args[5].split(','):[];
  if(excludedIds.some(id=>!['early-fixing','color-pivot','colorless-flex','rarity-choice','first-pick-abandon'].includes(id)))throw Error('lab-triage-exclusion');
  const result=candidates(report,{excludedIds});
  const output={schema_version:1,status:result.status,skipped:result.skipped,briefs:result.candidates.map(renderResearchBrief)};
  await writeFile(join(out,'research-briefs.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Lab: '+output.briefs.length+' private research briefs; no publication.');
}
main().catch(()=>{console.error('Lab triage stopped: verify private paths, evidence, exclusions, and output.');process.exitCode=1;});
