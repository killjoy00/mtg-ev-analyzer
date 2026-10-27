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
      result.headers.set('x-quota-implementation',this.reserved?'coalesced-preview':'per-request');
      const metric=this.metrics.get(tag);
      result.headers.set('x-quota-reservation-write',String(this.reserved?(metric?.batch_write??metric?.reservation_write)===true:result.status===204));
      if(this.reserved&&metric) {
        result.headers.set('x-quota-queue-ms',String(metric.queue_ms));
        result.headers.set('x-quota-durability-ms',String(metric.durability_ms));
        result.headers.set('x-quota-batch-size',String(metric.batch_size||1));
      }
      return result;
    } catch(error){return probeFailure(error);}
    finally {this.metrics.delete(tag);}
  }
}
export class BaselineQuota extends MeasuredQuota {constructor(state){super(state,false);}}
export class ControlQuota extends MeasuredQuota {constructor(state){super(state,false);}}
export class CandidateQuota extends MeasuredQuota {constructor(state){super(state,true);}}

// Latency-only crossover: every mode uses the SAME native actor/storage and
// counter row. The full correctness profile keeps its independent namespaces.
export class CrossoverQuota {
  constructor(state) {
    this.instanceId=crypto.randomUUID().replaceAll('-','');this.active=null;this.inflight=0;this.cleaning=false;
    this.modes={baseline:new BaselineQuota(state),control:new ControlQuota(state),candidate:new CandidateQuota(state)};
  }
  async fetch(request) {
    const mode=request.headers.get('x-quota-probe-mode');
    if(request.method!=='POST'||new URL(request.url).pathname!=='/request'||!['baseline','control','candidate'].includes(mode))return new Response(null,{status:400});
    // The sampler awaits each complete same-mode group before switching. Do
    // not allow overlapping policies to confound the measurement or cleanup.
    if(this.cleaning)return new Response(null,{status:503});
    if(this.inflight&&this.active!==mode)return new Response(null,{status:409});
    this.active=mode;this.inflight++;
    try {
      const result=await this.modes[mode].fetch(request);
      result.headers.set('x-quota-actor-instance',this.instanceId);return result;
    } finally {if(--this.inflight===0)this.active=null;}
  }
  async alarm(info) {
    if(this.inflight)throw Error('Synthetic crossover busy; retry cleanup.');
    this.cleaning=true;
    try {await this.modes.baseline.alarm(info);this.modes.candidate.reservations.clear();}
    finally {this.cleaning=false;}
  }
}

export default {async fetch(request,env) {
  if(!/^[a-f0-9]{64}$/.test(env.BENCHMARK_KEY||'')||request.headers.get('authorization')!=='Bearer '+env.BENCHMARK_KEY||
    !Number.isFinite(Number(env.EXPIRES_AT))||Date.now()>=Number(env.EXPIRES_AT))return new Response(null,{status:403,headers:{'x-quota-probe-auth':'required'}});
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/request','/session','/session-only','/restart'].includes(path))return new Response(null,{status:400});
  let body;try{body=await readJson(request,256);}catch{return new Response(null,{status:400});}
  if(!body||Array.isArray(body)||!['baseline','control','candidate'].includes(body.mode)||!/^[a-f0-9]{32}$/.test(body.cohort||'')||
    Object.keys(body).some(key=>!['mode','cohort','paired'].includes(key))||
    (body.paired!==undefined&&body.paired!==true)||(body.paired&&path!=='/request'))return new Response(null,{status:400});
  if(body.paired) {
    try {return await env.PAIRED_QUOTA.get(env.PAIRED_QUOTA.idFromName(body.cohort),{locationHint:'enam'}).fetch(
      new Request('https://quota/request',{method:'POST',headers:{'x-quota-probe-mode':body.mode}}));}
    catch(error){return probeFailure(error);}
  }
  const namespace={baseline:env.BASELINE_QUOTA,control:env.CONTROL_QUOTA,candidate:env.CANDIDATE_QUOTA}[body.mode];
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
