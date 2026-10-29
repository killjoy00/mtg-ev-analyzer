// Fixed private destination for read-only quota analysis; no public fallback.
import {createHash} from 'node:crypto';
const BASE='https://api.cloudflare.com/client/v4/accounts/2eff4354681d85e7daa3ee437d64498c/r2/buckets/pack1-private-operations';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function privateQuotaStore({token,fetcher=fetch}={}){
  if(typeof token!=='string'||token.length<20)throw Error('Private quota storage credential unavailable');
  const call=(path,method='GET',body)=>fetcher(BASE+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body})});
  const verify=async()=>{
    const m=await call('/domains/managed'),c=await call('/domains/custom');
    if(!m.ok||!c.ok)throw Error('Private quota destination unavailable');
    const managed=await m.json(),custom=await c.json();
    if(managed.success!==true||managed.result?.enabled!==false||custom.success!==true||!Array.isArray(custom.result?.domains)||custom.result.domains.length)
      throw Error('Private quota destination not verified');
  };
  return {verify,async save(report,{runId,attempt,sha,now=Date.now()}={}){
    if(!/^[1-9]\d{0,19}$/.test(runId||'')||!/^[1-9]\d{0,2}$/.test(attempt||'')||!/^[a-f0-9]{40}$/.test(sha||'')||!Number.isSafeInteger(now)||now<=0)
      throw Error('Trusted quota report context unavailable');
    const body=JSON.stringify({schema:'private-quota-forensics-v2',source_revision:sha,run_id:runId,run_attempt:attempt,observed_at:new Date(now).toISOString(),report})+'\n';
    if(Buffer.byteLength(body)>5*1024*1024)throw Error('Private quota report exceeds bound');
    await verify();
    const path='/objects/investigations/'+new Date(now).toISOString().slice(0,10)+'/quota-stage-'+runId+'-'+attempt+'.json';
    // Verify an ambiguous write once; never blindly repeat a mutation.
    try {const r=await call(path,'PUT',body);if(!r.ok)throw Error('Private quota upload unavailable');}catch{/* Readback decides. */}
    const read=await call(path);if(!read.ok||digest(await read.text())!==digest(body))throw Error('Private quota report readback failed');
  }};
}
