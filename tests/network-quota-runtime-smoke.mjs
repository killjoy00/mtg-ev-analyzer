import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Manual local runtime check: install with the repository's pinned tool installer.
// This fixture-only subclass and its control routes are never deployed.
const root=fileURLToPath(new URL('../',import.meta.url));
const tools=process.argv[2];
assert.ok(tools&&path.isAbsolute(tools),'Pass the absolute pinned-tool directory.');
const require=createRequire(path.join(tools,'package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=require('miniflare');
const reserved=process.env.PACK1_TEST_QUOTA_RESERVATIONS==='1';
const persist=mkdtempSync(path.join(tmpdir(),'packone-quota-runtime-'));
const fixture=path.join(root,'tests/quota-runtime-fixture.mjs');
const options=convertV4MiniflareOptions({name:'quota-local-fixture',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
 bindings:reserved?{MODE:'preview',NEON_BRANCH_ID:'br-isolated-runtime',QUOTA_RESERVATIONS:'preview-v1'}:{},
 log:new Log(LogLevel.ERROR),cf:false,telemetry:{enabled:false},durableObjects:{NETWORK_QUOTA:{className:'QuotaFixture',useSQLite:true}},resourcePersistencePath:persist,
 modules:[{type:'ESModule',path:fixture,contents:`
 import {NetworkQuota} from '../edge/gateway.mjs';
 export class QuotaFixture extends NetworkQuota {
   async fetch(request) {
     const path=new URL(request.url).pathname;
     if(path==='/fixture-state')return Response.json(await this.storage.get('buckets')||null);
     if(path==='/fixture-legacy') {
       await this.storage.put('session',{count:120,until:Date.now()+300000});
       await this.storage.sync();return new Response(null,{status:204});
     }
     if(path==='/fixture-expired') {
       await this.storage.put('buckets',{request:{count:1,until:0}});
       await this.storage.sync();return new Response(null,{status:204});
     }
     if(path==='/fixture-cleanup') {
       await super.alarm({isRetry:false,retryCount:0});
       return new Response(null,{status:204});
     }
     return super.fetch(request);
   }
 }
 export default {fetch(){return new Response(null,{status:404});}};
 `},...['edge/gateway.mjs','edge/quota-reservations.mjs','edge/private-diagnostics.mjs','worker/request-json.mjs','worker/account-config.mjs','worker/patreon-mobile-policy.mjs','worker/apple-subscription-policy.mjs','admin-api-contract.mjs','launch-alert-policy.mjs'].map(name=>({type:'ESModule',path:path.join(root,name),contents:readFileSync(path.join(root,name),'utf8')}))]});
let runtime;
try {
 runtime=new Miniflare(options);
 const namespace=await runtime.getDurableObjectNamespace('NETWORK_QUOTA');
 let object=namespace.get(namespace.idFromName('persistence-fixture'));
 assert.equal((await object.fetch('https://quota/session',{method:'POST'})).status,204);
 const first=await (await object.fetch('https://quota/fixture-state')).json();
 assert.equal(first.request.count,reserved?8:1);assert.equal(first.session.count,reserved?2:1);
 await runtime.dispose();runtime=new Miniflare(options);
 const restored=await runtime.getDurableObjectNamespace('NETWORK_QUOTA');
 object=restored.get(restored.idFromName('persistence-fixture'));
 assert.equal((await object.fetch('https://quota/session',{method:'POST'})).status,204);
 const second=await (await object.fetch('https://quota/fixture-state')).json();
 assert.equal(second.request.count,reserved?16:2);assert.equal(second.session.count,reserved?4:2);
 assert.equal((await object.fetch('https://quota/fixture-cleanup',{method:'POST'})).status,204);
 assert.deepEqual(await (await object.fetch('https://quota/fixture-state')).json(),second,'cleanup preserves active quota windows');
 await object.fetch('https://quota/fixture-expired',{method:'POST'});
 assert.equal((await object.fetch('https://quota/fixture-cleanup',{method:'POST'})).status,204,'sync remains valid after SQLite deleteAll');
 assert.equal(await (await object.fetch('https://quota/fixture-state')).json(),null,'cleanup durably clears expired counters');
 assert.equal((await object.fetch('https://quota/session',{method:'POST'})).status,204);
 assert.equal((await (await object.fetch('https://quota/fixture-state')).json()).session.count,reserved?2:1,'returning network restarts after expired cleanup');
 const legacy=restored.get(restored.idFromName('legacy-fixture'));
 await legacy.fetch('https://quota/fixture-legacy',{method:'POST'});
 const denied=await legacy.fetch('https://quota/session',{method:'POST'});
 assert.equal(denied.status,429);assert.deepEqual((await denied.json()).scopes,['session']);
 assert.equal(await (await legacy.fetch('https://quota/fixture-state')).json(),null,'denial makes no partial request debit');
 console.log('Local SQLite workerd quota checks passed: acknowledgement, restart persistence, cleanup durability and legacy denial.');
} finally {await runtime?.dispose();rmSync(persist,{recursive:true,force:true});}
