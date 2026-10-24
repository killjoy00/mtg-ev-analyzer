import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [directory,commit]=process.argv.slice(2);
if(!directory||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Usage: build-neon-functions.mjs OUTPUT_DIRECTORY FULL_COMMIT_SHA');
const root=path.resolve(directory),esbuild=process.env.ESBUILD_BIN||'esbuild';
const packager=process.env.NEON_FUNCTION_PACKAGER
  ? await import(pathToFileURL(path.resolve(process.env.NEON_FUNCTION_PACKAGER))) : null;
const banner="import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);";
for(const line of fs.readFileSync('.github/neon-functions.txt','utf8').trim().split('\n')) {
  const [slug,entry]=line.split(':');
  if(!/^[a-z0-9]{1,20}$/.test(slug)||!entry)throw Error('Invalid function manifest');
  const folder=path.join(root,slug),file=path.join(folder,'index.mjs');fs.mkdirSync(folder,{recursive:true});
  execFileSync(esbuild,[entry,'--bundle','--platform=node','--target=node24','--format=esm',`--banner:js=${banner}`,`--define:process.env.PACK1_RELEASE_COMMIT=${JSON.stringify(commit)}`,`--outfile=${file}`],{stdio:'inherit'});
  const loaded=await import(pathToFileURL(file));
  if(typeof loaded.default?.fetch!=='function')throw Error(`${slug} lacks a default fetch handler`);
  const response=await loaded.default.fetch(new Request('https://packone.pro/health?quick=1'));
  if(response.status!==200||(await response.json()).release_commit!==commit)throw Error(`${slug} lacks the embedded release marker`);
  if(packager) {
    // Use the same collector, compressor and size limits as the pinned CLI's
    // --no-bundle deployment. Different ZIP compressors can cross the limit
    // even when the estimated archive fits.
    const entries=await packager.bundleAsIs({slug,name:slug,source:folder,env:{},runtime:'nodejs24',bundler:'none'},{via:'no-bundle'});
    fs.writeFileSync(folder+'.zip',await packager.zipFunctionBundle(slug,entries));
  } else {
    execFileSync('python3',['-c',"import sys,zipfile; p=sys.argv[1]; z=zipfile.ZipFile(p+'.zip','w',zipfile.ZIP_DEFLATED); z.write(p+'/index.mjs','index.mjs'); z.close()",folder]);
  }
  const archiveBytes=fs.statSync(folder+'.zip').size;
  if(archiveBytes>10*1024*1024)throw Error(`${slug}: compressed function exceeds the pinned deployment tool's 10 MiB limit`);
  console.log(`${slug}: bundle, release marker and compressed size verified (${archiveBytes} bytes; ${packager?'Neon deployment packager':'local ZIP estimate'})`);
}
