import {readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCreatorPageEntries} from '../creator-challenge-pages.mjs';

export async function cleanupCreatorCanaryStatic({root=process.cwd()}={}) {
  const registryPath=path.join(root,'creator-challenges.json');
  const registry=validateCreatorPageEntries(JSON.parse(await readFile(registryPath,'utf8')));
  const kept=registry.filter(entry=>!String(entry.slug||'').startsWith('canary-'));
  const removedRegistry=registry.length-kept.length;
  if(removedRegistry)await writeFile(registryPath,JSON.stringify(kept,null,2)+'\n','utf8');

  const creatorDir=path.join(root,'creator');
  let removedRoutes=0;
  for(const entry of await readdir(creatorDir,{withFileTypes:true})) {
    if(!entry.isDirectory()||!entry.name.startsWith('canary-'))continue;
    await rm(path.join(creatorDir,entry.name),{recursive:true,force:true});
    removedRoutes++;
  }
  return {removedRegistry,removedRoutes};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  cleanupCreatorCanaryStatic().then(result=>{
    console.log(`Removed ${result.removedRegistry} canary registry entries and ${result.removedRoutes} canary route directories.`);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
