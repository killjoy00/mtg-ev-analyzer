import {setTimeout as delay} from 'node:timers/promises';

// Retry only idempotent reads. An ambiguous write belongs to the existing
// operation/session reconciliation, never a blind transport retry.
export async function fetchCanaryHttp(url,options={},
  {fetcher=fetch,sleep=(ms,signal)=>delay(ms,undefined,{signal})}={}) {
  if(String(options.method||'GET').toUpperCase()!=='GET')return fetcher(url,options);
  const budget=options.signal||AbortSignal.timeout(90000);
  for(let attempt=0;attempt<3;attempt++){
    budget.throwIfAborted();
    let response,error;
    try{
      response=await fetcher(url,{...options,signal:AbortSignal.any([budget,AbortSignal.timeout(30000)])});
    }catch(caught){
      if(budget.aborted||!(caught instanceof TypeError||['TimeoutError','AbortError'].includes(caught.name)))throw caught;
      error=caught;
    }
    const transient=error||response.status===429||response.status>=500&&response.status<=599;
    if(!transient||attempt===2){if(error)throw error;return response;}
    const retryAfter=Number(response?.headers.get('retry-after'));
    const backoff=Math.max(1000*2**attempt,Number.isFinite(retryAfter)?Math.min(60000,Math.max(0,retryAfter*1000)):0);
    if(response?.body)await response.body.cancel().catch(()=>{});
    console.log('Retrying transient canary GET '+(error?.name||'HTTP '+response.status)+' ('+(attempt+2)+'/3).');
    await sleep(backoff,budget);
  }
}
