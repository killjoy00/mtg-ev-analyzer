// Isolated synthetic probe only. No application origins or production bindings.
import {NetworkQuota} from './gateway.mjs';
import {readJson} from '../worker/request-json.mjs';
import {failureIndicators} from './private-diagnostics.mjs';

function probeFailure(error) {
  const message=String(error?.message||'');
  const reason=/rows written|storage.*quota|daily.*limit|quota.*exceeded/i.test(message)?'storage_quota':
    /illegal invocation|incompatible receiver/i.test(message)?'storage_receiver':
    error?.name==='TypeError'?'type_error':error?.name==='ReferenceError'?'reference_error':'unclassified';
  return Response.json({error:'synthetic_quota_exception',reason,...failureIndicators(error)},{status:503});
}

class MeasuredQuota extends NetworkQuota {
  constructor(state,reserved) {
    // Keep the native DurableObjectState/storage objects untouched. Observe
    // the limiter's own write decisions instead of proxying provider APIs.
    super(state,{MODE:'preview',NEON_BRANCH_ID:'br-synthetic-quota-only',QUOTA_RESERVATIONS:reserved?'preview-v1':undefined});
    this.writeDecisions=0;this.reserved=reserved;
    if(this.reservations) {
      const debit=this.reservations.debit.bind(this.reservations);
      this.reservations.debit=async(...args)=>{
        const result=await debit(...args);
        if(args[2].reservation_write)this.writeDecisions++;
        return result;
      };
    }
  }
  async fetch(request) {
    try {
      const result=await super.fetch(request);
      if(!this.reserved&&result.status===204)this.writeDecisions++;
      result.headers.set('x-quota-counter-write-total',String(this.writeDecisions));
      return result;
    } catch(error){return probeFailure(error);}
  }
}
export class BaselineQuota extends MeasuredQuota {constructor(state){super(state,false);}}
export class CandidateQuota extends MeasuredQuota {constructor(state){super(state,true);}}

export default {async fetch(request,env) {
  if(!/^[a-f0-9]{64}$/.test(env.BENCHMARK_KEY||'')||request.headers.get('authorization')!=='Bearer '+env.BENCHMARK_KEY||
    !Number.isFinite(Number(env.EXPIRES_AT))||Date.now()>=Number(env.EXPIRES_AT))return new Response(null,{status:403});
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/request','/session','/session-only'].includes(path))return new Response(null,{status:400});
  let body;try{body=await readJson(request,256);}catch{return new Response(null,{status:400});}
  if(!['baseline','candidate'].includes(body.mode)||!/^[a-f0-9]{32}$/.test(body.cohort||'')||
    Object.keys(body).some(key=>!['mode','cohort'].includes(key)))return new Response(null,{status:400});
  const namespace=body.mode==='baseline'?env.BASELINE_QUOTA:env.CANDIDATE_QUOTA;
  try{return await namespace.get(namespace.idFromName(body.cohort),{locationHint:'enam'}).fetch(new Request('https://quota'+path,{method:'POST'}));}
  catch(error){return probeFailure(error);}
}};
