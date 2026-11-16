import {createHmac,timingSafeEqual} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const truth=value=>value===true||value==='t'||value==='true'||value===1||value==='1';
const object=value=>typeof value==='string'?JSON.parse(value):value;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status,resultsSafe:true});};
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function key(env){const value=String(env.PACK1_RATE_LIMIT_SECRET||'');if(value.length<32)fail('Email preferences are temporarily unavailable.',503);return value;}
// Same destination digest as reminders, so adverse delivery evidence from either
// optional email stream is respected. Consent remains entirely independent.
export const resultsEmailHash=(email,env=process.env)=>createHmac('sha256',key(env)).update('pack1-reminder-email:'+String(email).trim().toLowerCase()).digest('hex');
function token(nonce,env){return nonce+'.'+createHmac('sha256',key(env)).update('pack1-results-unsubscribe:'+nonce).digest('base64url');}
function nonceFromToken(value,env){
 const [nonce,mac,...extra]=String(value||'').split('.');
 if(extra.length||!UUID.test(nonce||'')||!/^[A-Za-z0-9_-]{43}$/.test(mac||''))fail('Invalid unsubscribe link.');
 const expected=token(nonce,env).split('.')[1];
 if(!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))fail('Invalid unsubscribe link.');
 return nonce;
}
export async function resultsLaunch(query){
 const row=(await query('SELECT launch_at,launch_at<=now() active,launch_at+interval \'14 days\' first_publication_at FROM results_launch WHERE singleton')).rows[0];
 return {active:truth(row?.active),launchAt:row?.launch_at||null,firstPublicationAt:row?.first_publication_at||null};
}
async function identity(query,id){
 if(!UUID.test(String(id||'')))fail('Account session required.',401);
 return (await query('SELECT email,"emailVerified" verified FROM neon_auth."user" WHERE id=$1::uuid',[id])).rows[0]||null;
}
const errors={ACCOUNT_DELETING:['This account is being deleted.',409],NOT_LAUNCHED:['These choices are not available yet.',409],
 ALREADY_ANSWERED:['This choice has already been saved. Open Account settings to change it.',409],
 ADDRESS_CHANGED:['Your account email changed. Reload these settings.',409],INVALID_ACTION:['Choose a valid action.',400]};
export async function updateResultsPreferences(query,auth,payload,{env=process.env}={}){
 if(payload?.expectedAccountId!==auth?.user_id)fail('Account changed. Reload Account settings.',409);
 if(!payload||Object.keys(payload).some(k=>!['expectedAccountId','action'].includes(k))||
  !['sync','present','prompt:on','prompt:off','notice:on','notice:dismiss','settings:on','settings:off','exclude:on','exclude:off'].includes(payload.action))fail('Choose a valid action.');
 const user=await identity(query,auth.user_id);if(!user)fail('Sign in again.',401);
 let value;
 try {value=object((await query('SELECT pack1_results_update($1::uuid,$2,$3,$4) result',
  [auth.user_id,payload.action,resultsEmailHash(user.email,env),user.email])).rows[0]?.result);}
 catch(error){
  if(String(error.message).includes('RESULTS_EMAIL_UNVERIFIED'))fail('Verify your account email before turning these emails on.',403);
  if(String(error.message).includes('RESULTS_EMAIL_SUPPRESSED'))fail('Emails are paused after a bounce or complaint. Contact support.',409);
  throw error;
 }
 if(value?.error){const [message,status]=errors[value.error]||['Preferences are temporarily unavailable.',503];fail(message,status);}
 return payload.action==='present'?value:resultsSnapshot(query,auth.user_id,{env,sync:false});
}
export async function resultsSnapshot(query,authId,{env=process.env,sync=true}={}){
 const launch=await resultsLaunch(query);
 if(!launch.active)return {...launch,emailState:'unanswered',excludePublications:false};
 if(sync)await updateResultsPreferences(query,{user_id:authId},{expectedAccountId:authId,action:'sync'},{env});
 const row=(await query('SELECT email_state,exclude_publications,prompt_shown_at,notice_shown_at,notice_outcome,changed_at FROM results_preferences WHERE auth_user_id=$1::uuid',[authId])).rows[0];
 return {...launch,emailState:row?.email_state||'unanswered',excludePublications:truth(row?.exclude_publications),
  promptShownAt:row?.prompt_shown_at||null,noticeShownAt:row?.notice_shown_at||null,noticeOutcome:row?.notice_outcome||null,changedAt:row?.changed_at||null};
}
export async function publishableResultsName(query,authId){
 return (await query('SELECT pack1_results_publishable_name($1::uuid) name',[authId])).rows[0]?.name||'Anonymous player';
}
// Future private publishers must record every named placement with this helper.
// This is bookkeeping only: it does not publish or commit any results.
export async function recordResultsPublication(query,{authId,channel,link,publishedAt=new Date().toISOString()}){
 if(!['website','email','reddit','patreon','youtube','bluesky','discord'].includes(channel))fail('Invalid publication channel.');
 let url;try{url=new URL(link);}catch{fail('Publication link required.');}
 if(url.protocol!=='https:'||url.username||url.password||link.length>2000)fail('Use a public HTTPS publication link.');
 return (await query('SELECT pack1_results_record_publication($1::uuid,$2,$3,$4::timestamptz) id',[authId,channel,link,publishedAt])).rows[0]?.id||null;
}
// The only admission path for future results/news senders. Returns an envelope;
// performs no network call and contains no weekly-email composition or schedule.
export async function prepareResultsEmail(query,authId,content,{env=process.env}={}){
 const postal=String(env.PACK1_RESULTS_POSTAL_ADDRESS||'').trim();
 const name=String(env.PACK1_RESULTS_SENDER_NAME||'').trim();
 const from=String(env.PACK1_RESULTS_SENDER_EMAIL||'').trim();
 if(!postal||postal.length>500||!name||name.length>200||/[\r\n<>]/.test(name)||!/^[-.\w+]+@[-.\w]+\.[A-Za-z]{2,}$/.test(from)||!String(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET||'').startsWith('whsec_'))fail('Results email sender configuration is incomplete.',503);
 if(!content||typeof content.subject!=='string'||!content.subject.trim()||/[\r\n]/.test(content.subject)||typeof content.text!=='string'||typeof content.html!=='string')fail('Email content is incomplete.');
 const user=await identity(query,authId);if(!user||!truth(user.verified))fail('Results email is not permitted.',409);
 await updateResultsPreferences(query,{user_id:authId},{expectedAccountId:authId,action:'sync'},{env});
 const admitted=(await query('SELECT pack1_results_admit($1::uuid,$2,$3) id',[authId,resultsEmailHash(user.email,env),user.email])).rows[0]?.id;
 if(!admitted)fail('Results email is not permitted.',409);
 const nonce=(await query('SELECT unsubscribe_nonce FROM results_preferences WHERE auth_user_id=$1::uuid',[authId])).rows[0]?.unsubscribe_nonce;
 if(!nonce)fail('Results email is not permitted.',409);
 const unsubscribe='https://api.packone.pro/growth/v1/results/unsubscribe?token='+token(nonce,env);
 return {from:name+' <'+from+'>',to:[user.email],subject:content.subject,
  text:content.text+'\n\n'+name+'\n'+postal+'\nUnsubscribe: '+unsubscribe,
  html:content.html+'<footer><p>'+escape(name)+'<br>'+escape(postal).replaceAll('\n','<br>')+'</p><a href="'+escape(unsubscribe)+'">Unsubscribe</a></footer>',
  headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},
  tags:[{name:'pack1_results',value:admitted}]};
}
async function unsubscribe(request,query,env){
 if(!['GET','POST'].includes(request.method))fail('Not found.',404);
 const nonce=nonceFromToken(new URL(request.url).searchParams.get('token'),env);
 const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 // GET is scanner-safe; the visible button and RFC 8058 POST both take one click
 // and require no account session. Repeated POSTs remain harmless.
 if(request.method==='GET')return new Response('<!doctype html><title>Results and news</title><h1>Stop results and news emails?</h1><form method="post"><button>Unsubscribe</button></form>',{headers});
 await query(`SELECT pack1_results_update(auth_user_id,'unsubscribe',NULL,NULL) FROM results_preferences WHERE unsubscribe_nonce=$1::uuid`,[nonce]);
 return new Response('<!doctype html><title>Unsubscribed</title><h1>Results and news emails are off</h1><p>Your Daily reminder setting is unchanged.</p>',{headers});
}
async function providerEvent(request,query,env){
 const secret=String(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET||'');
 if(!secret.startsWith('whsec_'))fail('Email event handling is unavailable.',503);
 const raw=await request.text();if(Buffer.byteLength(raw)>65536)fail('Invalid email event.');
 const eventId=request.headers.get('svix-id')||'',time=request.headers.get('svix-timestamp')||'';
 if(!/^[\w-]{1,200}$/.test(eventId)||!/^\d{10}$/.test(time)||Math.abs(Date.now()/1000-Number(time))>300)fail('Invalid email event.',401);
 const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(eventId+'.'+time+'.'+raw).digest();
 const valid=(request.headers.get('svix-signature')||'').split(' ').some(item=>{
  const [version,signature]=item.split(',');if(version!=='v1'||!signature)return false;
  const given=Buffer.from(signature,'base64');return given.length===expected.length&&timingSafeEqual(given,expected);
 });
 if(!valid)fail('Invalid email event.',401);
 let event;try{event=JSON.parse(raw);}catch{fail('Invalid email event.');}
 if(!['email.bounced','email.complained'].includes(event?.type))return {ok:true};
 const tags=event.data?.tags,hint=Array.isArray(tags)?tags.find(t=>t.name==='pack1_results')?.value:tags?.pack1_results;
 if(!UUID.test(String(hint||'')))return {ok:true};
 // Match to our immutable admitted destination. Never trust a later account
 // email or retain the provider's complete payload/address/message.
 const destinations=event.data?.to;
 if(!Array.isArray(destinations)||destinations.length!==1||typeof destinations[0]!=='string')fail('Invalid email event.');
 const digest=resultsEmailHash(destinations[0],env);
 await query('SELECT pack1_results_suppress($1::uuid,$2,$3)',
 [hint,digest,event.type==='email.complained'?'complaint':'bounce']);
 return {ok:true};
}
export async function resultsAdmin(query,authId,{action,target,value,task}={}){
 const owner=(await query("SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid AND role='owner'",[authId])).rows.length;
 if(action&&!owner)fail('Owner access required.',403);
 if(action==='contact'){
  if(!UUID.test(target||'')||typeof value!=='boolean')fail('Choose a valid contact setting.');
  await query(`INSERT INTO results_preferences(auth_user_id,do_not_contact_at)
   SELECT $1::uuid,CASE WHEN $2::boolean THEN now() ELSE NULL END
   WHERE pack1_identity_attachment_allowed($1::uuid) AND EXISTS(SELECT 1 FROM neon_auth."user" WHERE id=$1::uuid)
   ON CONFLICT(auth_user_id) DO UPDATE SET do_not_contact_at=excluded.do_not_contact_at`,[target,value]);
 }else if(action==='request-removal'){
  if(!UUID.test(target||''))fail('Choose an account.');
  await query("SELECT pack1_results_queue_removals($1::uuid,'request',now())",[target]);
 }else if(action==='complete'){
  if(!UUID.test(task||''))fail('Choose a removal task.');
  // Delete the publication too: the name and link are no longer needed.
  await query('DELETE FROM results_publications WHERE id IN (SELECT publication_id FROM results_removal_tasks WHERE id=$1::uuid)',[task]);
 }else if(action)fail('Choose a valid action.');
 const counts=(await query(`SELECT count(*) FILTER(WHERE coalesce(p.email_state,'unanswered')='unanswered')::int unanswered,
  count(*) FILTER(WHERE p.email_state='on')::int "on",count(*) FILTER(WHERE p.email_state='off')::int off,
  count(*) FILTER(WHERE p.notice_shown_at IS NOT NULL)::int shown,
  count(*) FILTER(WHERE p.notice_outcome='turned on')::int turned_on,count(*) FILTER(WHERE p.notice_outcome='dismissed')::int dismissed,
  count(*) FILTER(WHERE p.exclude_publications)::int exclusions
  FROM neon_auth."user" u LEFT JOIN results_preferences p ON p.auth_user_id=u.id`)).rows[0];
 const tasks=(await query(`SELECT t.id,t.due_at,p.channel,p.link,p.name_to_remove FROM results_removal_tasks t
  JOIN results_publications p ON p.id=t.publication_id ORDER BY t.due_at LIMIT 200`)).rows;
 const contact=target?(await query('SELECT do_not_contact_at FROM results_preferences WHERE auth_user_id=$1::uuid',[target])).rows[0]?.do_not_contact_at||null:null;
 return {counts,tasks,doNotContactAt:contact};
}
export async function resultsRoute(request,{query,json,readJson,authBrowser,authMutation,authMobile,authAdmin,env=process.env}={}){
 const path=new URL(request.url).pathname,method=request.method;
 if(path==='/v1/results/launch'&&method==='GET')return json(await resultsLaunch(query));
 if(path==='/v1/results/unsubscribe')return unsubscribe(request,query,env);
 if(path==='/v1/results/provider-event'&&method==='POST')return json(await providerEvent(request,query,env));
 if(path==='/v1/admin/results'){
  if(!['GET','PATCH'].includes(method))fail('Not found.',404);
  const auth=await authAdmin(request,{mutation:method==='PATCH'});
  const input=method==='PATCH'?await readJson(request):{target:new URL(request.url).searchParams.get('target')||undefined};
  if(input.target&&!UUID.test(input.target))fail('Choose an account.');
  return json(await resultsAdmin(query,auth.user_id,input));
 }
 if(!['GET','PATCH'].includes(method))fail('Not found.',404);
 const auth=path.startsWith('/v1/mobile/')?(await authMobile(request)).auth:
  method==='GET'?await authBrowser(request):await authMutation(request,{mobile:false});
 if(method==='GET')return json(await resultsSnapshot(query,auth.user_id,{env}));
 return json(await updateResultsPreferences(query,auth,await readJson(request),{env}));
}
