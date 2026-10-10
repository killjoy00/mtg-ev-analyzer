// First-party script-error reporting. Each page sends at most a few sanitized
// `client_error` product events through the existing analytics pipeline: the
// error message and same-origin file:line:column only. Never page URLs, query
// strings, stack traces or email addresses.
const MAX_REPORTS=5;
const NETWORK_FAILURE=/failed to fetch|networkerror|load failed|network request failed/i;

export function sanitizeErrorMessage(value) {
  return String(value??'')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,'[url]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[email]')
    .replace(/\s+/g,' ').trim().slice(0,100);
}

export function sameOriginLocation(filename,line,column,origin) {
  try {
    const url=new URL(filename);
    if(!origin||url.origin!==origin)return null;
    return [url.pathname.split('/').pop()||'(inline)',line,column].filter(part=>part!=null&&part!=='').join(':');
  } catch {return null;}
}

export function installClientErrorReporting(track,{target=globalThis,origin=globalThis.location?.origin,page=()=>globalThis.location?.pathname||'/'}={}) {
  const seen=new Set();
  const report=(kind,message,where)=>{
    const context=sanitizeErrorMessage(message)||'(no message)';
    const key=`${kind}|${context}|${where}`;
    if(seen.size>=MAX_REPORTS||seen.has(key))return;
    seen.add(key);
    try {void Promise.resolve(track('client_error',{kind,context,type:where,surface:page()})).catch(()=>{});} catch {}
  };
  // Browser extensions, third-party and opaque cross-origin ("Script error.")
  // failures have no same-origin location, so they are not reported.
  target.addEventListener('error',event=>{
    const where=sameOriginLocation(event.filename,event.lineno,event.colno,origin);
    if(where)report('error',event.error?.message||event.message,where);
  });
  // Offline, aborted and timed-out requests are connectivity, not code defects;
  // server-side monitoring already covers API availability.
  target.addEventListener('unhandledrejection',event=>{
    const reason=event.reason;
    if(reason?.name==='AbortError'||reason?.name==='TimeoutError'||NETWORK_FAILURE.test(String(reason?.message??reason)))return;
    report('rejection',reason instanceof Error?`${reason.name}: ${reason.message}`:typeof reason==='string'?reason:'Non-error rejection','(unknown)');
  });
}
