export const TRACE_HEADER='x-pack1-trace',REASON_HEADER='x-pack1-backend-reason';
export const traceId=value=>/^[a-f0-9]{32}$/.test(value||'')?value:null;
export const backendReason=value=>['practice_refreshing','corpus_unavailable','backend_failure'].includes(value)?value:null;
export const providerRay=value=>/^[a-f0-9]{16,32}-[A-Z]{3}$/.test(value||'')?value:null;
export function providerFailureCode(error) {
 const message=String(error?.message||'');
 if(/\bSQLITE_NOMEM\b/.test(message))return 'sqlite_out_of_memory';
 if(/(?:Internal error in Durable Object storage|storage operation exceeded timeout).*object to be reset/i.test(message))return 'storage_reset';
 if(/^internal error(?:;|$)/i.test(message))return 'provider_internal';
 if(/Durable Object reset|object to be reset|disconnected|network connection lost/i.test(message)||error?.code==='ECONNRESET')return 'transport_reset';
 return null;
}
export function failureIndicators(error) {
 // Classify only; never publish arbitrary provider messages or stacks.
 const message=String(error?.message||'');
 return {timeout:error?.name==='TimeoutError'||error?.code==='ETIMEDOUT'||error?.timeout===true||/\b(?:timed out|timeout)\b/i.test(message),
   aborted:error?.name==='AbortError'||error?.code==='ABORT_ERR',
   retryable:error?.retryable===true,overloaded:error?.overloaded===true,
   remote:error?.remote===true,provider_reset:/Durable Object reset|object to be reset|disconnected|network connection lost/i.test(message),failure_code:providerFailureCode(error)};
}
export const milliseconds=value=>Math.max(0,Math.min(600000,Math.round(value)));
export function boundedSignalCall(call,signal) {
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
   const abort=()=>reject(signal.reason);
   signal.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>{signal.throwIfAborted();return call();}).then(resolve,reject)
     .finally(()=>signal.removeEventListener('abort',abort));
 });
}
