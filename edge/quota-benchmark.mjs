// Isolated synthetic probe only. No application origins or production bindings.
import {NetworkQuota} from './gateway.mjs';
import {readJson} from '../worker/request-json.mjs';

class MeasuredQuota extends NetworkQuota {
  constructor(state,reserved) {
    let writes=0;
    const wrap=tx=>new Proxy(tx,{get(target,key){
      if(key==='put')return async(...args)=>{writes++;return target.put(...args);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    const storage=new Proxy(state.storage,{get(target,key){
      if(key==='transaction')return call=>target.transaction(tx=>call(wrap(tx)));
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    super({storage},{MODE:'preview',NEON_BRANCH_ID:'br-synthetic-quota-only',QUOTA_RESERVATIONS:reserved?'preview-v1':undefined});
    this.writes=()=>writes;
  }
  async fetch(request) {
    const result=await super.fetch(request);
    result.headers.set('x-quota-counter-write-total',String(this.writes()));
    return result;
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
  return namespace.get(namespace.idFromName(body.cohort),{locationHint:'enam'}).fetch(new Request('https://quota'+path,{method:'POST'}));
}};
