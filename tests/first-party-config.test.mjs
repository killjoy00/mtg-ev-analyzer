import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROD_AUTH_BASE} from '../worker/account-config.mjs';

const source=fs.readFileSync(new URL('../leaderboard-config.js',import.meta.url),'utf8');
const evaluate=hostname=>{
  const context={location:{hostname},window:{}};
  vm.runInNewContext(source,context,{filename:'leaderboard-config.js'});
  return context.window.PACK1_API;
};

test('production host uses the first-party gateway for account and Draft Run traffic',()=>{
  const config=evaluate('packone.pro');
  assert.equal(config.firstParty,true);
  assert.equal(config.authBase,PROD_AUTH_BASE);
  assert.equal(config.growthUrl,'https://api.packone.pro/growth');
  assert.equal(config.draftRunUrl,'https://api.packone.pro/draft');
});

test('the legacy leaderboard service also goes through the gateway in production',()=>{
  // Left on its direct origin it would mint a second guest player outside the
  // first-party cookie, forking the identity an account is linked to.
  assert.equal(evaluate('packone.pro').url,'https://api.packone.pro/legacy');
});

test('only the apex host is first-party, matching the gateway origin allowlist',()=>{
  // www redirects to the apex before any script runs, and the gateway answers
  // 403 for that origin, so claiming it here could only ever fail every call.
  assert.equal(evaluate('www.packone.pro').firstParty,false);
});

test('localhost uses the development Functions branch, never production',()=>{
  // Local manual testing against production created real guest players (#803).
  for(const hostname of ['127.0.0.1','localhost']) {
    const config=evaluate(hostname);
    assert.equal(config.firstParty,false);
    assert.equal(config.authBase,'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth');
    assert.equal(config.url,'https://br-twilight-hill-ayffyd2b-pack1api.compute.c-5.us-east-2.aws.neon.tech');
    assert.equal(config.growthUrl,'https://br-twilight-hill-ayffyd2b-pack1growth.compute.c-5.us-east-2.aws.neon.tech');
    assert.equal(config.draftRunUrl,'https://br-twilight-hill-ayffyd2b-draftrunapi.compute.c-5.us-east-2.aws.neon.tech');
  }
});

test('non-apex production hosts keep the direct production Functions branch',()=>{
  const config=evaluate('magic.planitnow.us');
  assert.equal(config.firstParty,false);
  assert.equal(config.authBase,PROD_AUTH_BASE);
  assert.equal(config.growthUrl,'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech');
});


test('query, hash, cookies and storage are not configuration channels for Auth selection',()=>{
  const local=evaluate('localhost'),prod=evaluate('packone.pro');
  assert.equal(local.authBase,'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth');
  assert.equal(prod.authBase,PROD_AUTH_BASE);
  assert.ok(!source.includes('searchParams')&&!source.includes('localStorage')&&!source.includes('document.cookie'));
});


test('every remaining production Neon Auth literal equals PROD_AUTH_BASE',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const skipped=new Set(['.git','node_modules','data','generated','results','artifacts','tests']);
  const files=[];
  const walk=dir=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.isDirectory()&&skipped.has(entry.name))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())walk(full);
      else if(/\.(?:m?js)$/.test(entry.name))files.push(full);
    }
  };
  walk(root);
  const hardeningRelative='scripts/auth-localhost-hardening.mjs';
  const hardeningSource=fs.readFileSync(path.join(root,hardeningRelative),'utf8');
  const hardeningProduction=hardeningSource.match(/export const PROD_AUTH_BASE='([^']+)'/);
  assert.equal(hardeningProduction?.[1],PROD_AUTH_BASE,'localhost-hardening production Auth base must match the canonical production base');

  const qaOnlyRelatives=new Set([
    'scripts/auth-verification-taxonomy-probe.mjs',
    'scripts/auth-webhook-probe-stage.mjs',
  ]);
  const pattern=/https:\/\/ep-[a-z0-9-]+\.neonauth\.[a-z0-9.-]+\/pack1\/auth/g;
  const literals=[];
  for(const file of files){
    const relative=path.relative(root,file);
    if(relative===hardeningRelative||qaOnlyRelatives.has(relative))continue;
    const matches=fs.readFileSync(file,'utf8').match(pattern)||[];
    for(const value of matches)literals.push({file:path.relative(root,file),value});
  }
  assert.ok(literals.length>=1,'expected at least the canonical production Auth literal');
  for(const literal of literals){
    assert.equal(literal.value,PROD_AUTH_BASE,literal.file+' contains a stale production Auth literal');
  }
});
