import {AsyncLocalStorage} from 'node:async_hooks';
import {TRACE_HEADER,REASON_HEADER,traceId,backendReason,milliseconds} from '../edge/private-diagnostics.mjs';

const databaseContext=new AsyncLocalStorage(),DATABASE_DETAIL_LIMIT=12;
// Fixed PostgreSQL SQLSTATE identities, never provider messages, constraint
// names or arbitrary error codes. Classification is diagnostic only and must
// not expand the separate rollback-only retry policy.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const DATABASE_FAILURE_CODES=new Set([
 '08001','08006','08007','08P01','22003','22P02',
 '23502','23503','23505','23514','23P01','40001','40003','40P01',
 '42501','42703','42804','42P01','53100','53200','53300','53400',
 '55P03','57014','57P01','57P02','57P03','58030','XX000',
 'ECONNRESET','ETIMEDOUT',
]);
const DATABASE_FAILURE_CLASSES={
 '08':'connection_exception','22':'data_exception','23':'integrity_constraint',
 '25':'invalid_transaction_state','28':'invalid_authorization','40':'transaction_error',
 '42':'syntax_or_access','53':'insufficient_resources','54':'program_limit',
 '55':'prerequisite_state','57':'operator_intervention','58':'system_error',
 'P0':'application_exception','XX':'internal_error',
};
const databaseFailureCode=error=>{
 const code=error?.pgCode||error?.code;
 if(DATABASE_FAILURE_CODES.has(code))return code;
 return error?.name==='AbortError'?'abort':error?.name==='TimeoutError'?'timeout':null;
};
const databaseFailureClass=error=>{
 const code=error?.pgCode||error?.code;
 return typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?DATABASE_FAILURE_CLASSES[code.slice(0,2)]||'other_sqlstate':null;
};
function databaseLog(record){try{console.log(JSON.stringify(record));}catch{/* Diagnostics must not change a database outcome. */}}
function databaseSummary(context) {
 return context?{database_calls:context.calls,database_completed:context.completed,
   database_detail_limit:DATABASE_DETAIL_LIMIT,database_details_omitted:Math.max(0,context.calls-DATABASE_DETAIL_LIMIT),
   database_ms:milliseconds(context.total),database_max_ms:milliseconds(context.max)}:{};
}

// Observe individual /sql attempts, inside the existing rollback-only retry
// wrapper. No SQL, parameters, URLs, headers, rows or error text enter this API.
// Only session creation and run starts get detail, capped per request. Missing
// completion records still do not prove that an operation never committed.
export async function observedDatabaseCall(operation) {
 const context=databaseContext.getStore();
 if(!context?.open)return operation(()=>{});
 const began=performance.now(),sequence=++context.calls,detailed=sequence<=DATABASE_DETAIL_LIMIT;
 let headersAt=null;
 const metric={...context.base,sequence,phase:'fetch',http_status:null,response_headers_ms:null};
 if(detailed)databaseLog({event:'backend_database_start',...metric});
 try {
   const result=await operation(status=>{
     if(headersAt!==null)return;
     headersAt=performance.now();metric.phase='body';
     metric.http_status=Number.isInteger(status)&&status>=100&&status<=599?status:null;
     metric.response_headers_ms=milliseconds(headersAt-began);
     if(detailed&&context.open)databaseLog({event:'backend_database_headers',...metric});
   });
   metric.phase='complete';metric.ok=true;
   return result;
 } catch(error) {
   metric.ok=false;metric.failure_code=databaseFailureCode(error);metric.failure_class=databaseFailureClass(error);throw error;
 } finally {
   const ended=performance.now(),duration=ended-began;
   context.completed++;context.total+=duration;context.max=Math.max(context.max,duration);
   if(detailed&&context.open)databaseLog({event:'backend_database',...metric,
     duration_ms:milliseconds(duration),response_body_ms:headersAt===null?null:milliseconds(ended-headersAt)});
 }
}

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
 const context=['player_session','draft_start'].includes(family)?{base,calls:0,completed:0,total:0,max:0,open:true}:null;
 return databaseContext.run(context,async()=>{
 console.log(JSON.stringify({event:'backend_request_start',...base}));
 try {
   const original=await route(request);
   // Fetch/redirect responses may have immutable headers. Keep their body
   // streaming while adding only the private acknowledgement to a fresh wrapper.
   const response=new Response(original.body,original);
   response.headers.set(TRACE_HEADER,trace);
   if(response.status>=500&&!backendReason(response.headers.get(REASON_HEADER)))response.headers.set(REASON_HEADER,family==='health'?'corpus_unavailable':'backend_failure');
   console.log(JSON.stringify({event:'backend_request',...base,status:response.status,duration_ms:milliseconds(performance.now()-began),reason:backendReason(response.headers.get(REASON_HEADER)),...databaseSummary(context)}));
   return response;
 } catch(error) {
   const status=Number(error?.status)||500;
   console.log(JSON.stringify({event:'backend_request',...base,status,duration_ms:milliseconds(performance.now()-began),reason:reasonFor(error,status),failure_code:databaseFailureCode(error),failure_class:databaseFailureClass(error),...databaseSummary(context)}));
   throw error;
 } finally {if(context)context.open=false;}
 });
}
