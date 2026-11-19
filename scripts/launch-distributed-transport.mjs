import diagnosticsChannel from 'node:diagnostics_channel';

export const UNDICI_TRANSPORT_CHANNELS=Object.freeze({
  requestCreate:'undici:request:create',
  beforeConnect:'undici:client:beforeConnect',
  connected:'undici:client:connected',
  connectError:'undici:client:connectError',
  sendHeaders:'undici:client:sendHeaders',
  bodySent:'undici:request:bodySent',
  responseHeaders:'undici:request:headers',
  requestError:'undici:request:error',
});
const pending=[],requestStates=new WeakMap(),socketStates=new WeakMap(),connectQueues=new Map();
let installed=false;
const now=()=>performance.now();
const originKey=({protocol='',host='',hostname='',port=''})=>`${protocol}//${host||hostname+(port?`:${port}`:'')}`;
const requestKey=(method,url)=>({method:String(method||'GET').toUpperCase(),origin:url.origin,path:url.pathname+url.search});
const finite=value=>Number.isFinite(value)&&value>=0?Math.round(value*100)/100:null;
const safeToken=(value,pattern)=>pattern.test(String(value||''))?String(value):null;
export const sanitizeTransportMessage=value=>{
  const message=String(value||'').replace(/https?:\/\/\S+/gi,'[url]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[ip]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g,'[redacted]').replace(/\s+/g,' ').trim().slice(0,160);
  return message||null;
};

function install() {
  if(installed)return;installed=true;
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.requestCreate).subscribe(({request})=>{
    const key={method:request.method,origin:String(request.origin),path:request.path};
    // begin() runs immediately before global fetch, but Undici does not expose
    // its eventual request object to begin(). Identical in-flight requests are
    // therefore bound FIFO by method + origin + path. The Node 24 loopback
    // regression checks this ordering assumption against server-recorded socket
    // identity for six concurrent identical GETs; this is not a durable request ID.
    const index=pending.findIndex(state=>!state.bound&&state.method===key.method&&state.origin===key.origin&&state.path===key.path);
    if(index<0)return;
    const state=pending[index];state.bound=true;state.request=request;requestStates.set(request,state);
  });
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.beforeConnect).subscribe(({connectParams})=>{
    const key=originKey(connectParams),queue=connectQueues.get(key)||[];queue.push(now());connectQueues.set(key,queue);
  });
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.connected).subscribe(({connectParams,socket})=>{
    const key=originKey(connectParams),queue=connectQueues.get(key)||[],started=queue.shift();
    if(!queue.length)connectQueues.delete(key);
    const secure=String(connectParams?.protocol||'').startsWith('https');
    socketStates.set(socket,{uses:0,secure,connect_ms:started===undefined?null:finite(now()-started)});
  });
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.connectError).subscribe(({connectParams})=>{
    const key=originKey(connectParams),queue=connectQueues.get(key)||[];queue.shift();if(!queue.length)connectQueues.delete(key);
  });
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.sendHeaders).subscribe(({request,socket})=>{
    const state=requestStates.get(request);if(!state)return;
    state.headers_sent=true;
    const socketState=socketStates.get(socket);
    if(socketState){state.socket=socketState.uses===0?'new':'reused';state.connect_ms=socketState.uses===0?socketState.connect_ms:null;state.tls=socketState.secure;socketState.uses++;}
  });
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.bodySent).subscribe(({request})=>{const state=requestStates.get(request);if(state)state.body_sent=true;});
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.responseHeaders).subscribe(({request})=>{const state=requestStates.get(request);if(state)state.response_headers=true;});
  diagnosticsChannel.channel(UNDICI_TRANSPORT_CHANNELS.requestError).subscribe(({request})=>{const state=requestStates.get(request);if(state)state.diagnostic_error=true;});
}

export const undiciTransportObserver={
  begin({url,method='GET',bodyPresent=false}) {
    install();const key=requestKey(method,url),state={...key,bound:false,headers_sent:false,body_present:Boolean(bodyPresent),body_sent:false,response_headers:false,
      socket:'unknown',connect_ms:null,tls:null,started_ms:now()};pending.push(state);return state;
  },
  end(state) {
    const index=pending.indexOf(state);if(index>=0)pending.splice(index,1);
    if(state?.request)requestStates.delete(state.request);
  },
};

export function transportFailureEvidence(error,state,{cohortAborted=false,elapsedMs=null}={}) {
  const cause=error?.cause;
  const headersSent=state?.headers_sent===true,bound=state?.bound===true;
  return {
    label:cohortAborted?'abort_fallout':headersSent?'post_send':bound?'pre_send':'unknown',
    role:'unclassified',
    error_name:safeToken(error?.name,/^[A-Za-z][A-Za-z0-9]{0,63}$/),
    cause_code:safeToken(cause?.code,/^[A-Z0-9_]{1,64}$/),
    cause_name:safeToken(cause?.name,/^[A-Za-z][A-Za-z0-9]{0,63}$/),
    message:sanitizeTransportMessage(error?.message),
    cause_message:sanitizeTransportMessage(cause?.message),
    elapsed_ms:finite(elapsedMs),
    headers_sent:headersSent,
    body_present:state?.body_present===true,
    body_sent:state?.body_present===true?state?.body_sent===true:null,
    socket:['new','reused'].includes(state?.socket)?state.socket:'unknown',
    connect_ms:finite(state?.connect_ms),
    tls:state?.tls===true?true:state?.tls===false?false:null,
    // Node 22.16.0 / bundled Undici 6.21.2 exposes combined connection
    // establishment timing through beforeConnect -> connected, but no separate
    // TLS-handshake diagnostics channel. Node 24 uses these same channel names.
    tls_ms:null,
  };
}
