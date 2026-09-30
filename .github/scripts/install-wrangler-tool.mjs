import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const WRANGLER='wrangler@4.143.0';
const UNDICI_OVERRIDE='7.29.1';

const [target,...extras]=process.argv.slice(2);
if(!target)throw new Error('Usage: node install-wrangler-tool.mjs <target-dir> [extra-package-spec ...]');

const resolved=path.resolve(target);
mkdirSync(resolved,{recursive:true});
writeFileSync(path.join(resolved,'package.json'),JSON.stringify({
  name:'pack-one-wrangler-tool',
  private:true,
  version:'1.0.0',
  description:'Ephemeral pinned Pack One deployment-tool environment.',
  overrides:{undici:UNDICI_OVERRIDE},
},null,2)+'\n');

const args=[
  'install',
  '--prefix',resolved,
  '--save-exact',
  '--no-audit',
  '--no-fund',
  WRANGLER,
  ...extras,
];
const result=spawnSync('npm',args,{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);

const verify=spawnSync(
  'npm',
  ['ls','--prefix',resolved,'--all','--json','undici'],
  {encoding:'utf8'},
);
if(verify.status!==0) {
  process.stderr.write(verify.stderr||'Could not inspect installed undici tree.\n');
  process.exit(verify.status??1);
}
const tree=JSON.parse(verify.stdout||'{}');
const versions=new Set();
function walk(node) {
  if(!node||typeof node!=='object')return;
  for(const [name,dep] of Object.entries(node.dependencies||{})) {
    if(name==='undici'&&dep?.version)versions.add(String(dep.version));
    walk(dep);
  }
}
walk(tree);
if(!versions.size)throw new Error('Wrangler install did not expose an undici dependency to verify.');
if([...versions].some(version=>version!==UNDICI_OVERRIDE)) {
  throw new Error(`Unexpected undici version(s): ${[...versions].join(', ')}; expected only ${UNDICI_OVERRIDE}.`);
}
console.log(`Installed ${WRANGLER} with forced undici@${UNDICI_OVERRIDE} and verified the resolved tree.`);
