import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function migrationPlan(manifest,plan,{changes=[],fresh=false}={}) {
  const ordered=manifest.ordered;
  if(!Array.isArray(ordered)||new Set(ordered).size!==ordered.length)throw Error('Invalid ordered migration manifest');
  const selected=new Set(fresh?ordered:manifest.release_paths?.[plan]?.migrations);
  if(!fresh&&!manifest.release_paths?.[plan])throw Error('Unknown migration plan: '+plan);
  for(const [status,path] of changes) {
    if(status!=='A')throw Error('Existing migrations are immutable; add a new migration: '+path);
    if(!/^migrations\/\d{4}_[A-Za-z0-9_]+\.sql$/.test(path))throw Error('Invalid migration path: '+path);
    selected.add(path.slice('migrations/'.length));
  }
  for(const name of selected)if(!ordered.includes(name))throw Error('Unregistered migration: '+name);
  return ordered.filter(name=>selected.has(name)).map(name=>'migrations/'+name);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [plan,base,head]=process.argv.slice(2);
  const changes=base&&head?execFileSync('git',['diff','--name-status','--no-renames',base,head,'--','migrations/*.sql'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(line=>line.split('\t')):[];
  const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json'));
  for(const path of migrationPlan(manifest,plan,{changes,fresh:plan==='fresh'}))console.log(path);
}
