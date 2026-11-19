import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GENERATED_CAMPAIGN_MARKER,renderCampaignRedirectPage,validateCampaignEntries} from '../campaign-links.mjs';

async function readOptional(file) {
  try{return await readFile(file,'utf8');}
  catch(error){if(error?.code==='ENOENT')return null;throw error;}
}

async function generatedDirectories(goDir) {
  let entries=[];
  try{entries=await readdir(goDir,{withFileTypes:true});}
  catch(error){if(error?.code==='ENOENT')return [];throw error;}
  const generated=[];
  for(const entry of entries) {
    if(!entry.isDirectory())continue;
    const html=await readOptional(path.join(goDir,entry.name,'index.html'));
    if(html?.startsWith(GENERATED_CAMPAIGN_MARKER))generated.push(entry.name);
  }
  return generated;
}

export async function generateCampaignLinks({root=process.cwd(),check=false}={}) {
  const configPath=path.join(root,'campaign-links.json');
  const entries=validateCampaignEntries(JSON.parse(await readFile(configPath,'utf8')));
  const expected=new Map(entries.map(entry=>[entry.slug,renderCampaignRedirectPage(entry)]));
  const goDir=path.join(root,'go');
  const problems=[];
  for(const [slug,html] of expected) {
    const file=path.join(goDir,slug,'index.html');
    if(check) {
      const current=await readOptional(file);
      if(current===null)problems.push(`missing generated page: go/${slug}/index.html`);
      else if(current!==html)problems.push(`stale generated page: go/${slug}/index.html`);
    } else {
      await mkdir(path.dirname(file),{recursive:true});
      await writeFile(file,html,'utf8');
    }
  }
  const generated=await generatedDirectories(goDir);
  const orphans=generated.filter(slug=>!expected.has(slug));
  if(check) {
    for(const slug of orphans)problems.push(`orphan generated campaign directory: go/${slug}/`);
    if(problems.length)throw new Error(problems.join('\n'));
  } else {
    for(const slug of orphans)await rm(path.join(goDir,slug),{recursive:true,force:true});
  }
  return {entries:entries.length,slugs:[...expected.keys()],check};
}

function cliOptions(argv) {
  let root=process.cwd(),check=false;
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if(arg==='--check'){check=true;continue;}
    if(arg==='--root'){
      if(!argv[i+1])throw new Error('--root requires a path.');
      root=path.resolve(argv[++i]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return {root,check};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  generateCampaignLinks(cliOptions(process.argv.slice(2))).then(result=>{
    console.log(result.check?`Campaign links are fresh (${result.entries}).`:`Generated ${result.entries} campaign link(s).`);
  }).catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}
