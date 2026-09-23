import fs from 'node:fs';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';

if(!process.argv.includes('--dev-fixtures'))throw Error('Use a disposable branch.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
process.env.PACK1_REQUIRE_INGRESS='1';
process.env.PACK1_INGRESS_SECRET='a'.repeat(64);

const RealDate=Date,instant=RealDate.parse('2041-06-15T16:00:00Z');
globalThis.Date=class extends RealDate{
  constructor(...args){super(...(args.length?args:[instant]));}
  static now(){return instant;}
};

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'daily-backend',use:'sig',alg:'RS256'};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://token.actions.githubusercontent.com/.well-known/jwks')return Response.json({keys:[jwk]});
  return originalFetch(url,options);
};

const now=Math.floor(instant/1000);
const workflow='killjoy00/mtg-ev-analyzer/.github/workflows/daily-generation.yml@refs/heads/main';
const claims={
  iss:'https://token.actions.githubusercontent.com',
  aud:'pack-one-daily-generation',
  sub:'repo:killjoy00/mtg-ev-analyzer:ref:refs/heads/main',
  repository:'killjoy00/mtg-ev-analyzer',
  repository_id:'1201587098',
  repository_owner_id:'211694413',
  ref:'refs/heads/main',
  workflow_ref:workflow,
  event_name:'workflow_dispatch',
  iat:now,nbf:now,exp:now+300,
  run_id:'123',sha:'a'.repeat(40),
};
function oidc(c=claims) {
  const body=[{alg:'RS256',typ:'JWT',kid:'daily-backend'},c]
    .map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}

const {default:api}=await import('../worker/draft-run-function.mjs');
const {query}=await import('../worker/growth-function.js');
const day='2041-06-15',environments=['mixed','powered-cube','latest'];

async function internal(body,token=oidc(),status=200) {
  const response=await api.fetch(new Request('https://origin.test/internal/daily-generation',{
    method:'POST',
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body),
  }));
  const data=await response.json();
  assert.equal(response.status,status,JSON.stringify({status:response.status,body:data}));
  return data;
}
const sensitive=/(puzzle|seed|source_draft_hash|source|pack|card)/i;

const first=await internal({day});
assert.equal(first.ok,true);assert.equal(first.success,true);assert.equal(first.date,day);
assert.deepEqual(first.results.map(row=>row.environment),environments);
assert.ok(first.results.every(row=>row.status==='created'));
assert.doesNotMatch(JSON.stringify(first),sensitive);
let rows=(await query(
  'SELECT environment,jsonb_array_length(puzzle_ids)::int decisions FROM draft_run_schedules WHERE day=$1::date ORDER BY environment',
  [day],
)).rows;
assert.equal(rows.length,3);assert.ok(rows.every(row=>Number(row.decisions)===8));

const repeat=await internal({day});
assert.ok(repeat.results.every(row=>row.status==='already_exists'));
assert.doesNotMatch(JSON.stringify(repeat),sensitive);
await internal({day:'2041-06-14'},oidc(),409);
await internal({day},'',403);
await internal({day},oidc({...claims,aud:'wrong'}),403);

// CI-only destructive fixture: remove one throwaway schedule to prove that the
// normal player-triggered path still creates the same current-day inventory.
await query("DELETE FROM draft_run_schedules WHERE day=$1::date AND environment='latest'",[day]);
const ingress=process.env.PACK1_INGRESS_SECRET;
async function playerCall(path,body,token,status=200) {
  const response=await api.fetch(new Request('https://origin.test'+path,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-pack1-ingress-secret':ingress,
      ...(token?{authorization:'Bearer '+token}:{}),
    },
    body:JSON.stringify(body),
  }));
  const data=await response.json();
  assert.equal(response.status,status,JSON.stringify({status:response.status,error:data?.error}));
  return data;
}
const guest=await playerCall('/v1/session',{displayName:'QA Daily generation fallback'});
const run=await playerCall('/v1/runs',{daily:true,environment:'latest'},guest.token);
assert.equal(run.day,day);assert.equal(run.environment,'latest');assert.equal(run.run_length,8);
rows=(await query("SELECT jsonb_array_length(puzzle_ids)::int decisions FROM draft_run_schedules WHERE day=$1::date AND environment='latest'",[day])).rows;
assert.deepEqual(rows,[{decisions:8}]);

console.log(JSON.stringify({
  daily_generation:'passed',
  date:day,
  environments,
  first_status:'created',
  repeat_status:'already_exists',
  public_without_oidc:'rejected',
  wrong_identity:'rejected',
  on_demand_fallback:'passed',
  sensitive_output:false,
}));
