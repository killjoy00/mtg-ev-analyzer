// Runs in the real Workers runtime via Miniflare, not a JavaScript counter mock.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(path.resolve(process.env.EDGE_TOOLS_DIR,'node_modules/wrangler/package.json'));
const {Miniflare}=await import(pathToFileURL(require.resolve('miniflare')));
const persist=await mkdtemp(path.join(tmpdir(),'pack1-quota-'));
const options={durableObjectsPersist:persist,workers:[{name:'gateway',modules:true,scriptPath:process.argv[2],compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{NETWORK_QUOTA:{className:'NetworkQuota',useSQLite:true}}}]};
let mf;
try {
  mf=new Miniflare(options);
  let ns=await mf.getDurableObjectNamespace('NETWORK_QUOTA','gateway');
  const id=ns.idFromName('concurrent-network');
  const statuses=await Promise.all(Array.from({length:25},async()=>{
    const r=await ns.get(id).fetch('https://quota/session',{method:'POST'});
    if(r.status===429)assert.ok(Number(r.headers.get('retry-after'))>0);
    return r.status;
  }));
  assert.equal(statuses.filter(x=>x===204).length,10);assert.equal(statuses.filter(x=>x===429).length,15);
  assert.equal((await ns.get(id).fetch('https://quota/request',{method:'POST'})).status,204,'normal play has a separate budget');
  await mf.dispose();mf=new Miniflare(options);ns=await mf.getDurableObjectNamespace('NETWORK_QUOTA','gateway');
  assert.equal((await ns.get(ns.idFromName('concurrent-network')).fetch('https://quota/session',{method:'POST'})).status,429,'restart must not reset the quota');
  assert.equal((await ns.get(ns.idFromName('another-network')).fetch('https://quota/session',{method:'POST'})).status,204);
  console.log('Workers runtime: concurrent quotas, separate play budget and persistence across restarts passed.');
} finally {if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
