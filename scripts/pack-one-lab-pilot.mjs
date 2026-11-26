// Explicit private local output only; no publication or network access.
import {readFile,realpath,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative,isAbsolute,sep} from 'node:path';
import {provenance,readArchive,renderDraft,renderChart} from '../research/pack-one-lab/pilot.mjs';

async function main() {
  if(process.env.GITHUB_ACTIONS)throw Error('lab-private-output-required');
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--out-dir')throw Error('lab-requires-explicit-output-directory');
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const out=await realpath(args[1]),rel=relative(root,out);
  if(!isAbsolute(rel)&&(rel===''||!(rel==='..'||rel.startsWith('..'+sep))))throw Error('lab-output-must-be-outside-repository');
  const info=await stat(out);
  if(!info.isDirectory())throw Error('lab-output-not-directory');
  if(process.platform!=='win32'&&(info.mode&0o077)!==0)throw Error('lab-output-directory-must-be-private');
  const raw=await readFile(join(root,provenance.path));
  const hash=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  if(hash!==provenance.blob)throw Error('lab-source-blob-mismatch');
  const packets=readArchive(JSON.parse(raw.toString('utf8')));
  for(const p of packets){
    for(const [suffix,content] of [['evidence.json',JSON.stringify(p,null,2)+'\n'],['draft.md',renderDraft(p)],['chart.svg',renderChart(p)]])
      await writeFile(join(out,p.id+'.'+suffix),content,{flag:'wx',mode:0o600});
  }
  console.log('Lab: '+packets.length+' historical draft candidates created locally; no publication.');
}
main().catch(()=>{console.error('Lab pilot stopped: verify pinned source, private output directory, and non-existing output files.');process.exitCode=1;});
