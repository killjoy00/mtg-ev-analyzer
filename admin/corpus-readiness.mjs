const esc=value=>String(value??'Not recorded').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const active=new WeakMap();
export function readinessMessage(status) {
 if(status?.ready===true&&status?.current===true)return `Ready: revision ${status.revision} was built and serving-verified.`;
 const state=status?.state;
 if(state==='queued')return 'Activation is committed. Cache warmup is queued; serving readiness is not complete.';
 if(state==='warming')return 'Activation is committed. The current cache is warming; serving readiness is not complete.';
 if(state==='verifying')return 'The cache is built. Serving and active-source verification are still running.';
 if(state==='retry_wait')return 'Activation is committed, but readiness needs recovery. An automatic retry is pending.';
 if(state==='failed')return 'Activation is committed, but readiness failed. Inspect the error and retry readiness; do not repeat activation.';
 if(state==='superseded'||status?.current===false&&status?.operation_id)return 'A newer serving revision superseded this operation. It cannot declare the current corpus ready.';
 return 'Readiness is not confirmed. Refresh the operation status before taking another publication action.';
}
export function readinessMarkup(status) {
 const retryable=status?.operation_id&&status?.current===true&&(['failed','retry_wait'].includes(status.state)||
  ['warming','verifying'].includes(status.state)&&Date.parse(status.lease_expires_at)<=Date.now());
 return `<h2>Serving readiness</h2><p role="status">${esc(readinessMessage(status))}</p>
 <p class="muted">Operation ${esc(status?.operation_id)} · Current revision ${esc(status?.current_revision)} · Attempt ${esc(status?.attempts??0)} · Cache generation ${esc(status?.cache_snapshot_id)}</p>
 ${status?.last_error?`<p class="error" role="alert">${esc(status.last_error.code)}: ${esc(status.last_error.message)}</p>`:''}
 ${retryable?`<button type="button" data-readiness-retry="${esc(status.operation_id)}">Retry readiness without changing publication</button>`:''}
 <p class="muted">Quality admission, committed lifecycle state and serving readiness are separate. Fixed Dailies and historical games are unchanged.</p>`;
}

// Return a cancellation function, and stop on navigation/re-render or a terminal
// result. Reads are lightweight; polling never starts a build or replays a POST.
export function observeReadiness(root,request,{afterRevision=null}={}) {
 active.get(root)?.();
 const panel=root.querySelector('#corpus-readiness');
 if(!panel)return ()=>{};
 let stopped=false,timer=null;
 const stop=()=>{stopped=true;clearTimeout(timer);};
 active.set(root,stop);
 const show=status=>{panel.innerHTML=readinessMarkup(status);};
 async function poll() {
  if(stopped||!root.isConnected||root.querySelector('#corpus-readiness')!==panel)return stop();
  if(typeof document!=='undefined'&&document.hidden){timer=setTimeout(poll,10000);return;}
  try {
   const status=await request('/v1/admin/corpus/readiness');
   if(stopped||root.querySelector('#corpus-readiness')!==panel)return;
   const awaitingCommit=afterRevision!==null&&String(status.current_revision)===String(afterRevision);
   if(!awaitingCommit){afterRevision=null;show(status);}
   if(awaitingCommit||['queued','warming','verifying','retry_wait'].includes(status.state))timer=setTimeout(poll,3000);
  } catch {
   if(stopped)return;
   panel.innerHTML=readinessMarkup({state:'unavailable'});
   timer=setTimeout(poll,10000);
  }
 }
 panel.onclick=async event=>{
  const button=event.target.closest('[data-readiness-retry]');
  if(!button)return;
  button.disabled=true;
  try {
   const result=await request(`/v1/admin/corpus/readiness/${button.dataset.readinessRetry}/retry`,{});
   if(stopped||root.querySelector('#corpus-readiness')!==panel)return;
   show(result.readiness);
   clearTimeout(timer);timer=setTimeout(poll,1000);
  } catch(cause) {
   if(stopped)return;
   const message=document.createElement('p');message.className='error';message.setAttribute('role','alert');
   message.textContent=cause.message;panel.append(message);button.disabled=false;
  }
 };
 timer=setTimeout(poll,1000);
 return stop;
}
