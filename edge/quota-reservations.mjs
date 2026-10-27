// Preview experiment: persisted counts include admitted calls and unused
// credits. Only queued calls are coalesced; speculative credits stay bounded.
import {milliseconds} from './private-diagnostics.mjs';
const STATE='buckets',KEYS=['request','request_burst','session'];
const BLOCK={request:8,request_burst:8,session:2},MAX_BATCH=256;
function validate(stored) {
  if(!stored||typeof stored!=='object'||Array.isArray(stored))throw Error('Invalid quota state.');
  for(const [key,row] of Object.entries(stored)) {
    if(!KEYS.includes(key)||!row||!Number.isSafeInteger(row.count)||row.count<0||
      !Number.isSafeInteger(row.until)||row.until<0)throw Error('Invalid quota state.');
  }
}
function expire(credits,now) {for(const [key,row] of Object.entries(credits))if(row.until<=now)delete credits[key];}
function consume(credits,limits) {for(const [key] of limits)credits[key].remaining--;}
// Pure callback-local planning: retries cannot publish credit or decisions.
function plan(stored,confirmed,jobs,now) {
  const next={...stored},credits=structuredClone(confirmed),decisions=[];let owner=-1;
  expire(credits,now);
  for(const {limits} of jobs) {
    const missing=limits.filter(([key])=>!(credits[key]?.remaining>0));
    const changes={},reserved={},scopes=[];let retry=0;
    for(const [key,limit,period] of missing) {
      let row=next[key];if(!row||now>=row.until)row={count:0,until:now+period};
      if(row.count>=limit) {
        retry=Math.max(retry,Math.ceil((row.until-now)/1000));
        const scope=key==='request_burst'?'request':key;if(!scopes.includes(scope))scopes.push(scope);
      } else {
        const amount=Math.min(BLOCK[key],limit-row.count);
        changes[key]={count:row.count+amount,until:row.until};reserved[key]={remaining:amount,until:row.until};
      }
    }
    if(retry){decisions.push({retry,scopes});continue;} // no partial charge
    if(missing.length&&owner<0)owner=decisions.length;
    Object.assign(next,changes);Object.assign(credits,reserved);consume(credits,limits);
    decisions.push({retry:0,scopes:[]});
  }
  return {next,credits,decisions,owner};
}
export class QuotaReservations {
  constructor(storage) {this.storage=storage;this.credits={};this.tail=Promise.resolve();this.jobs=[];this.scheduled=false;}
  exclusive(call) {
    const pending=this.tail.then(call);
    this.tail=pending.then(()=>{},()=>{this.clear();});
    return pending;
  }
  clear() {this.credits={};}
  debit(limits,_now,metric,timed) {
    return new Promise((resolve,reject)=>{
      this.jobs.push({limits,metric,timed,resolve,reject,enqueued:performance.now()});this.schedule();
    });
  }
  schedule() {
    if(this.scheduled)return;this.scheduled=true;
    // The same serialization boundary protects batch commits and cleanup.
    this.exclusive(async()=>{
      const jobs=this.jobs.splice(0,MAX_BATCH);
      try {await this.flush(jobs);}
      catch(error){this.clear();for(const job of jobs)job.reject(error);}
      finally {this.scheduled=false;if(this.jobs.length)this.schedule();}
    });
  }
  async flush(jobs) {
    const now=Date.now();expire(this.credits,now);
    for(const job of jobs)job.metric.queue_ms=milliseconds(performance.now()-job.enqueued);
    // Release already-confirmed credits before beginning any new write. No
    // artificial timer or durable operation is added to this fast path.
    while(jobs.length&&jobs[0].limits.every(([key])=>this.credits[key]?.remaining>0)) {
      const job=jobs.shift();consume(this.credits,job.limits);
      Object.assign(job.metric,{state_layout:'reserved',batch_size:1,batch_write:false,durability_confirmed:true});
      job.resolve({retry:0,scopes:[]});
    }
    if(!jobs.length)return;
    const lead=jobs[0],confirmed=structuredClone(this.credits),began=performance.now();
    const result=await lead.timed('transaction_ms',()=>this.storage.transaction(async tx=>{
      lead.metric.transaction_callbacks++;
      let stored=await lead.timed('get_ms',()=>tx.get(STATE));
      if(stored!==undefined&&stored!==null)lead.metric.state_layout='current';
      else {
        stored=Object.fromEntries(await lead.timed('get_ms',()=>tx.get(KEYS)));
        lead.metric.state_layout=Object.keys(stored).length?'legacy':'empty';
      }
      validate(stored);
      const result=plan(stored,confirmed,jobs,now);
      if(result.owner>=0) {
        await lead.timed('put_ms',()=>tx.put(STATE,result.next));
        if(await lead.timed('alarm_get_ms',()=>tx.getAlarm())===null)
          await lead.timed('alarm_set_ms',()=>tx.setAlarm(now+660000));
      }
      return result;
    }));
    const wrote=result.owner>=0,transaction=milliseconds(performance.now()-began);
    for(let i=0;i<jobs.length;i++) {
      const metric=jobs[i].metric;
      Object.assign(metric,{batch_size:jobs.length,batch_write:wrote,batch_transaction_ms:transaction,
        state_layout:lead.metric.state_layout,reservation_write:wrote&&i===result.owner,phase:'durability'});
      if(metric.trace)console.log(JSON.stringify({event:'quota_commit_wait',trace:metric.trace,object_tag:metric.object_tag,
        attempt:metric.attempt,decision_status:result.decisions[i].retry?429:204,batch_size:jobs.length}));
    }
    if(wrote) {
      const at=performance.now();
      try {await this.storage.sync();}
      finally {for(const job of jobs)job.metric.durability_ms+=performance.now()-at;}
    }
    // Publish no credits or successful decision before the one batch write
    // is acknowledged. Failure rejects the whole unconfirmed batch.
    this.credits=result.credits;
    for(let i=0;i<jobs.length;i++){jobs[i].metric.durability_confirmed=true;jobs[i].resolve(result.decisions[i]);}
  }
}
