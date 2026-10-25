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
const persist=mkdtempSync(path.join(tmpdir(),'packone-quota-runtime-'));
const fixture=path.join(root,'tests/quota-runtime-fixture.mjs');
const options=convertV4MiniflareOptions({name:'quota-local-fixture',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
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
     return super.fetch(request);
   }
 }
 export default {fetch(){return new Response(null,{status:404});}};
 `},...['edge/gateway.mjs','edge/private-diagnostics.mjs','worker/request-json.mjs','worker/account-config.mjs','worker/patreon-mobile-policy.mjs','worker/apple-subscription-policy.mjs','admin-api-contract.mjs','launch-alert-policy.mjs'].map(name=>({type:'ESModule',path:path.join(root,name),contents:readFileSync(path.join(root,name),'utf8')}))]});
let runtime;
try {
 runtime=new Miniflare(options);
 const namespace=await runtime.getDurableObjectNamespace('NETWORK_QUOTA');
 let object=namespace.get(namespace.idFromName('persistence-fixture'));
 assert.equal((await object.fetch('https://quota/session',{method:'POST'})).status,204);
 const first=await (await object.fetch('https://quota/fixture-state')).json();
 assert.equal(first.request.count,1);assert.equal(first.session.count,1);
 await runtime.dispose();runtime=new Miniflare(options);
 const restored=await runtime.getDurableObjectNamespace('NETWORK_QUOTA');
 object=restored.get(restored.idFromName('persistence-fixture'));
 assert.equal((await object.fetch('https://quota/session',{method:'POST'})).status,204);
 const second=await (await object.fetch('https://quota/fixture-state')).json();
 assert.equal(second.request.count,2);assert.equal(second.session.count,2);
 const legacy=restored.get(restored.idFromName('legacy-fixture'));
 await legacy.fetch('https://quota/fixture-legacy',{method:'POST'});
 const denied=await legacy.fetch('https://quota/session',{method:'POST'});
 assert.equal(denied.status,429);assert.deepEqual((await denied.json()).scopes,['session']);
 assert.equal(await (await legacy.fetch('https://quota/fixture-state')).json(),null,'denial makes no partial request debit');
 console.log('Local SQLite workerd quota checks passed: acknowledgement, restart persistence and legacy denial.');
} finally {await runtime?.dispose();rmSync(persist,{recursive:true,force:true});}
