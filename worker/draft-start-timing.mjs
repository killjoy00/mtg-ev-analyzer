// Bounded, anonymous timings for the isolated capacity preview. No SQL text,
// parameters, account identifiers, or puzzle data cross the gateway.
const rounded=value=>Math.round(value*100)/100;
const family=sql=>/pack1_serving_snapshot/.test(sql)?'snapshot':
  /WITH chosen AS/i.test(sql)?'candidate':
  /draft_run_serving_revision/.test(sql)?'revision':'other';

export function draftStartTiming(enabled,{clock=()=>performance.now()}={}) {
  if(!enabled)return {step:(_name,action)=>action(),selectionQuery:query=>query,finish:response=>response};
  const started=clock(),phases={},selector={};
  const step=async(name,action)=>{
    const at=clock();
    try {return await action();}
    finally {phases[name]=rounded((phases[name]||0)+clock()-at);}
  };
  return {
    step,
    selectionQuery:query=>async(sql,params)=>{
      const name=family(sql),at=clock();
      try {return await query(sql,params);}
      finally {
        const ms=rounded(clock()-at),item=selector[name]||{count:0,sum_ms:0,max_ms:0};
        item.count++;item.sum_ms=rounded(item.sum_ms+ms);item.max_ms=Math.max(item.max_ms,ms);
        selector[name]=item;
      }
    },
    finish(response) {
      response.headers.set('x-pack1-start-timing',JSON.stringify({v:1,total_ms:rounded(clock()-started),phases,selector}));
      return response;
    },
  };
}
