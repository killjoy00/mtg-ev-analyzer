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
    this.probeState=state;this.instanceId=crypto.randomUUID().replaceAll('-','');
    this.writeDecisions=0;this.reserved=reserved;this.metrics=new Map();
    if(this.reservations) {
      const debit=this.reservations.debit.bind(this.reservations);
      this.reservations.debit=async(...args)=>{
        const result=await debit(...args);
        this.metrics.set(args[2].object_tag,args[2]);
        if(args[2].reservation_write)this.writeDecisions++;
        return result;
      };
    }
  }
  async fetch(request) {
    // This control exists only in the disposable, authenticated probe Worker.
    // abort preserves storage and discards instance credits; it never resets counters.
    if(new URL(request.url).pathname==='/restart')this.probeState.abort('synthetic quota restart');
    const tag=crypto.randomUUID().replaceAll('-',''),headers=new Headers(request.headers);
    headers.set('x-pack1-quota-tag',tag);
    try {
      const result=await super.fetch(new Request(request,{headers}));
      if(!this.reserved&&result.status===204)this.writeDecisions++;
      result.headers.set('x-quota-counter-write-total',String(this.writeDecisions));
      result.headers.set('x-quota-instance',this.instanceId);
      const metric=this.metrics.get(tag);
      result.headers.set('x-quota-reservation-write',String(this.reserved?metric?.reservation_write===true:result.status===204));
      if(this.reserved&&metric) {
        result.headers.set('x-quota-queue-ms',String(metric.queue_ms));
        result.headers.set('x-quota-durability-ms',String(metric.durability_ms));
      }
      return result;
    } catch(error){return probeFailure(error);}
    finally {this.metrics.delete(tag);}
  }
}
export class BaselineQuota extends MeasuredQuota {constructor(state){super(state,false);}}
export class CandidateQuota extends MeasuredQuota {constructor(state){super(state,true);}}

export default {async fetch(request,env) {
  if(!/^[a-f0-9]{64}$/.test(env.BENCHMARK_KEY||'')||request.headers.get('authorization')!=='Bearer '+env.BENCHMARK_KEY||
    !Number.isFinite(Number(env.EXPIRES_AT))||Date.now()>=Number(env.EXPIRES_AT))return new Response(null,{status:403});
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/request','/session','/session-only','/restart'].includes(path))return new Response(null,{status:400});
  let body;try{body=await readJson(request,256);}catch{return new Response(null,{status:400});}
  if(!['baseline','candidate'].includes(body.mode)||!/^[a-f0-9]{32}$/.test(body.cohort||'')||
    Object.keys(body).some(key=>!['mode','cohort'].includes(key)))return new Response(null,{status:400});
  const namespace=body.mode==='baseline'?env.BASELINE_QUOTA:env.CANDIDATE_QUOTA;
  if(path==='/restart') {
    // A reset necessarily interrupts this control request. The runner must
    // independently confirm a new instance ID and surviving quota afterward.
    try {await namespace.get(namespace.idFromName(body.cohort),{locationHint:'enam'}).fetch(new Request('https://quota/restart',{method:'POST'}));}
    catch{return new Response(null,{status:204});}
    return new Response(null,{status:500});
  }
  try{return await namespace.get(namespace.idFromName(body.cohort),{locationHint:'enam'}).fetch(new Request('https://quota'+path,{method:'POST'}));}
  catch(error){return probeFailure(error);}
}};
