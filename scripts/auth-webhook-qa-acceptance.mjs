const HELPER='https://br-super-snow-b5ufhq30-pack1qareset.compute.c-7.us-east-2.aws.neon.tech/';
const AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const WORKER='https://pack1-authhook-qa.killjoy00.workers.dev';
const ORIGIN='http://localhost:4173';
const EMAIL='delivered@resend.dev';

async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function fetchJson(url,init={}) {
  const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});
  const text=await response.text();
  let body=null;
  try {body=text?JSON.parse(text):null;} catch {}
  return {status:response.status,body};
}
function assertSanitizedHelper(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('QA acceptance helper returned invalid JSON.');
  const allowed=new Set(['ok','stage','user_id','signup_status','request_status','reset_status','signin_status','signup_ms','request_ms','reset_ms','signin_ms','error']);
  for(const key of Object.keys(body))if(!allowed.has(key))throw Error('QA acceptance helper returned unexpected output.');
  const serialized=JSON.stringify(body);
  if(/token|password|signature|authorization|cookie/i.test(serialized))throw Error('QA acceptance helper output was not sanitized.');
}
async function telemetry() {
  const result=await fetchJson(WORKER+'/qa/telemetry');
  if(result.status!==200||!Array.isArray(result.body?.entries))throw Error('QA recovery telemetry is unavailable.');
  return result.body.entries;
}
function unseen(before,after) {
  const prior=new Set(before.map(e=>JSON.stringify(e)));
  return after.filter(e=>!prior.has(JSON.stringify(e)));
}
function safeSummary(entries) {
  return entries.map(e=>({
    event_key:String(e.event_key||''),
    delivery_attempt:String(e.delivery_attempt||''),
    status:String(e.status||''),
    duplicate:Boolean(e.duplicate),
    verify_ms:Number(e.verify_ms||0),
    delivery_ms:Number(e.delivery_ms||0),
    total_ms:Number(e.total_ms||0),
  }));
}
async function directResetRequest() {
  const result=await fetchJson(AUTH_BASE+'/request-password-reset',{
    method:'POST',
    headers:{origin:ORIGIN,'content-type':'application/json'},
    body:JSON.stringify({email:EMAIL,redirectTo:ORIGIN+'/reset-password/'}),
  });
  return result.status;
}
async function runHappy() {
  const before=await telemetry();
  const helper=await fetchJson(HELPER+'?mode=full');
  assertSanitizedHelper(helper.body);
  if(helper.status!==200||helper.body?.ok!==true||helper.body?.stage!=='complete')throw Error('QA reset completion did not pass.');
  for(const key of ['signup_status','request_status','reset_status','signin_status']) {
    const status=Number(helper.body?.[key]||0);
    if(status<200||status>=300)throw Error('QA reset completion returned a non-success provider status.');
  }
  await sleep(1000);
  const afterFull=await telemetry();
  const fullEntries=unseen(before,afterFull).filter(e=>e.status==='sent_or_duplicate');
  if(fullEntries.length<1)throw Error('QA happy-path webhook telemetry was not recorded.');

  const warmStatus=await directResetRequest();
  if(warmStatus<200||warmStatus>=300)throw Error('QA warm reset request failed.');
  await sleep(1000);
  const afterWarm=await telemetry();
  const warmEntries=unseen(afterFull,afterWarm).filter(e=>e.status==='sent_or_duplicate');
  if(warmEntries.length<1)throw Error('QA warm webhook telemetry was not recorded.');

  console.log('QA_ACCEPTANCE '+JSON.stringify({
    reset_complete:true,
    signin_with_new_password:true,
    provider_statuses:{
      signup:helper.body.signup_status,
      request:helper.body.request_status,
      reset:helper.body.reset_status,
      signin:helper.body.signin_status,
      warm_request:warmStatus,
    },
    first_delivery:safeSummary(fullEntries).at(-1),
    warm_delivery:safeSummary(warmEntries).at(-1),
  }));
}
async function runFailure() {
  const before=await telemetry();
  const helper=await fetchJson(HELPER+'?mode=request');
  assertSanitizedHelper(helper.body);
  if(helper.status!==200||helper.body?.stage!=='request_only')throw Error('QA forced-failure helper did not complete request setup.');
  if(Number(helper.body?.request_status||0)<400)throw Error('QA forced-failure reset request unexpectedly succeeded.');
  await sleep(1000);
  const after=await telemetry();
  const entries=unseen(before,after).filter(e=>e.status==='forced_failure');
  const groups=new Map();
  for(const entry of entries){const key=entry.event_key;groups.set(key,[...(groups.get(key)||[]),entry]);}
  const probe=[...groups.values()].sort((a,b)=>b.length-a.length)[0]||[];
  if(probe.length<2)throw Error('Managed Neon did not retry the forced webhook failure.');
  console.log('QA_FAILURE_ACCEPTANCE '+JSON.stringify({
    helper_stage:helper.body.stage,
    reset_request_status:helper.body.request_status,
    retry_attempts:probe.length,
    attempts:safeSummary(probe),
  }));
}
async function runRetry() {
  const before=await telemetry();
  const helper=await fetchJson(HELPER+'?mode=full');
  assertSanitizedHelper(helper.body);
  if(helper.status!==200||!['request','complete'].includes(helper.body?.stage))throw Error('QA post-send retry helper did not complete a valid recovery request path.');
  await sleep(1000);
  const after=await telemetry();
  const entries=unseen(before,after).filter(e=>e.status==='sent_or_duplicate');
  const groups=new Map();
  for(const entry of entries){const key=entry.event_key;groups.set(key,[...(groups.get(key)||[]),entry]);}
  const probe=[...groups.values()].sort((a,b)=>b.length-a.length)[0]||[];
  if(probe.length<2)throw Error('Managed Neon did not retry after the post-send 503.');
  if(!probe.some(e=>e.duplicate===false)||!probe.some(e=>e.duplicate===true))throw Error('QA retry did not prove duplicate suppression.');
  console.log('QA_RETRY_ACCEPTANCE '+JSON.stringify({
    reset_request_status:helper.body.request_status,
    retry_attempts:probe.length,
    first_send_count:probe.filter(e=>e.duplicate===false).length,
    duplicate_count:probe.filter(e=>e.duplicate===true).length,
    attempts:safeSummary(probe),
  }));
}
const mode=process.argv[2];
if(mode==='happy')await runHappy();
else if(mode==='failure')await runFailure();
else if(mode==='retry')await runRetry();
else throw Error('Unknown QA recovery acceptance mode.');
