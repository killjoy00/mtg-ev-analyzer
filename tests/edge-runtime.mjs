// Runs in the real Workers runtime via Miniflare, not a JavaScript counter mock.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(path.resolve(process.env.EDGE_TOOLS_DIR,'node_modules/wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(require.resolve('miniflare')));
const persist=await mkdtemp(path.join(tmpdir(),'pack1-quota-'));
// Freeze time only in this disposable test bundle. Slow CI must not expire the
// ten-second burst window while asserting its exact boundary. SQLite storage,
// transactions, concurrent calls and restart persistence still run in Workers;
// network-quota-policy.test.mjs separately advances time across expiry boundaries.
const runtimeScript=path.join(persist,'gateway-clock.mjs');
await writeFile(runtimeScript,`Date.now=()=>${Date.now()};\n`+await readFile(process.argv[2],'utf8'));
// Wrangler 4.132 ships Miniflare 5; use its supported v4 configuration adapter
// rather than relying on the older constructor shape still shown in examples.
const options=convertV4MiniflareOptions({resourcePersistencePath:persist,workers:[{name:'gateway',rootPath:path.dirname(runtimeScript),modulesRoot:path.dirname(runtimeScript),modules:true,scriptPath:runtimeScript,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
  durableObjects:{NETWORK_QUOTA:{className:'NetworkQuota',useSQLite:true}}}]});
let mf;
try {
  mf=new Miniflare(options);
  let ns=await mf.getDurableObjectNamespace('NETWORK_QUOTA','gateway');
  const id=ns.idFromName('concurrent-network');
  const statuses=await Promise.all(Array.from({length:121},async()=>{
    const r=await ns.get(id).fetch('https://quota/session',{method:'POST'});
    if(r.status===429){assert.ok(Number(r.headers.get('retry-after'))>0);assert.deepEqual(await r.json(),{error:'Too many requests.',code:'network_rate_limited',scopes:['session']});}
    return r.status;
  }));
  assert.equal(statuses.filter(x=>x===204).length,120);assert.equal(statuses.filter(x=>x===429).length,1);
  assert.equal((await ns.get(id).fetch('https://quota/request',{method:'POST'})).status,204,'normal play has a separate budget');
  const playId=ns.idFromName('play-network');
  const playStatuses=await Promise.all(Array.from({length:601},async()=>
    (await ns.get(playId).fetch('https://quota/request',{method:'POST'})).status));
  assert.equal(playStatuses.filter(x=>x===204).length,600);assert.equal(playStatuses.filter(x=>x===429).length,1);
  const missing=ns.get(ns.idFromName('invalid-cookie-network'));
  for(let i=0;i<120;i++) {
    assert.equal((await missing.fetch('https://quota/request',{method:'POST'})).status,204);
    assert.equal((await missing.fetch('https://quota/session-only',{method:'POST'})).status,204);
  }
  const creationDenied=await missing.fetch('https://quota/session-only',{method:'POST'});
  assert.equal(creationDenied.status,429);assert.deepEqual((await creationDenied.json()).scopes,['session']);
  // 120 request+creation pairs consume 120, not 240, burst requests.
  for(let i=0;i<480;i++)assert.equal((await missing.fetch('https://quota/request',{method:'POST'})).status,204);
  const requestDenied=await missing.fetch('https://quota/request',{method:'POST'});
  assert.equal(requestDenied.status,429);assert.deepEqual((await requestDenied.json()).scopes,['request']);
  const bothDenied=await missing.fetch('https://quota/session',{method:'POST'});
  assert.equal(bothDenied.status,429);assert.deepEqual((await bothDenied.json()).scopes,['request','session']);
  await mf.dispose();mf=new Miniflare(options);ns=await mf.getDurableObjectNamespace('NETWORK_QUOTA','gateway');
  assert.equal((await ns.get(ns.idFromName('concurrent-network')).fetch('https://quota/session',{method:'POST'})).status,429,'restart must not reset the quota');
  assert.equal((await ns.get(ns.idFromName('another-network')).fetch('https://quota/session',{method:'POST'})).status,204);
  console.log('Workers runtime: concurrent quotas, separate play budget and persistence across restarts passed.');
} finally {if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
