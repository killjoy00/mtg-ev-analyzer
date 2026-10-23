import {TRACE_HEADER,REASON_HEADER,traceId,backendReason,milliseconds} from '../edge/private-diagnostics.mjs';

export function reasonFor(error,status) {
 return backendReason(error?.diagnosticReason)||(status>=500?'backend_failure':null);
}
export function tagBackendResponse(response,error) {
 const reason=reasonFor(error,response.status);
 if(reason)response.headers.set(REASON_HEADER,reason);
 return response;
}
export async function observedRoute(request,service,route) {
 const trace=traceId(request.headers.get(TRACE_HEADER));
 if(!trace)return route(request);
 const path=new URL(request.url).pathname;
 const family=['/v1/player/session','/internal/player-session-refresh','/v1/session'].includes(path)?'player_session':path==='/v1/runs'?'draft_start':path==='/health'?'health':'other';
 const began=performance.now(),base={trace,service,route:family};
 console.log(JSON.stringify({event:'backend_request_start',...base}));
 try {
   const response=await route(request);
   if(response.status>=500)response.headers.set(REASON_HEADER,family==='health'?'corpus_unavailable':'backend_failure');
   console.log(JSON.stringify({event:'backend_request',...base,status:response.status,duration_ms:milliseconds(performance.now()-began),reason:backendReason(response.headers.get(REASON_HEADER))}));
   return response;
 } catch(error) {
   const status=Number(error?.status)||500;
   const code=['40001','57014','57P01','ECONNRESET','ETIMEDOUT'].includes(error?.code)?error.code:null;
   console.log(JSON.stringify({event:'backend_request',...base,status,duration_ms:milliseconds(performance.now()-began),reason:reasonFor(error,status),failure_code:code}));
   throw error;
 }
}
