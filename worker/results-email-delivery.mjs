import {createHash,randomUUID} from 'node:crypto';
import {prepareResultsEmail,resultsEmailProof} from './results-privacy.mjs';
import {draftRunLeaderboardRows,DRAFT_RUN_LEADERBOARD_ENVIRONMENTS,LEADERBOARD_BEST_OF,STANDINGS_LINEAGE} from './draft-run-season.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {seasonRatingPolicy,conservativeSeasonRating} from './season-rating.mjs';
import {zonedDateTime} from './neon-trigger.mjs';

export const RESULTS_EMAIL_TRIGGER='pack1-results-email';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const labels={'mixed':'Daily Run','powered-cube':'Powered Cube Daily','latest':'Latest Set Daily'};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const failure=(message,status=400)=>{throw Object.assign(Error(message),{status,resultsSafe:true});};
const shift=(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export function resultsDeliveryConfiguration(env=process.env){
 const ready=String(env.PACK1_RESULTS_RESEND_API_KEY||'').startsWith('re_')&&
  String(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET||'').startsWith('whsec_')&&
  String(env.PACK1_RATE_LIMIT_SECRET||'').length>=32&&
  Boolean(String(env.PACK1_RESULTS_POSTAL_ADDRESS||'').trim())&&String(env.PACK1_RESULTS_POSTAL_ADDRESS).trim().length<=500&&
  Boolean(String(env.PACK1_RESULTS_SENDER_NAME||'').trim())&&String(env.PACK1_RESULTS_SENDER_NAME).trim().length<=200&&!/[\r\n<>]/.test(env.PACK1_RESULTS_SENDER_NAME)&&
  /^[-.\w+]+@[-.\w]+\.[A-Za-z]{2,}$/.test(String(env.PACK1_RESULTS_SENDER_EMAIL||''));
 return {ready,active:ready&&env.PACK1_RESULTS_EMAIL_ENABLED==='1'};
}
const digest=campaign=>createHash('sha256').update(JSON.stringify([campaign.subject,campaign.body])).digest('hex');
export function resultsEmailContent(campaign,rows=[]){
 if(campaign.kind!=='news'&&!rows.length)return null;
 const heading=campaign.kind==='news'?campaign.subject:campaign.kind==='week'?'Your week in Pack One':'Your season results';
 const introduction=campaign.kind==='news'?campaign.body:
  `${campaign.start_date} to ${campaign.end_date}. ${campaign.kind==='week'?'Weekly scores use your best three Dailies in each game, divided by three.':'Season ratings use the same scoring as the season leaderboard.'}`;
 const lines=rows.map(row=>`${labels[row.environment]}: ${row.rank===null?'Not ranked':'#'+row.rank} · ${Number(row.score).toFixed(1)} ${campaign.kind==='week'?'weekly score':'season rating'} · ${row.days} ${row.days===1?'Daily':'Dailies'} played`);
 const text=[heading,'',introduction,'',...lines,'','Play Pack One: https://packone.pro/','',
  'You turned on '+(campaign.kind==='news'?'Pack One news':'weekly results emails')+'. Manage your choices: https://packone.pro/?account=1',
  'Your Daily reminder setting is separate.'].join('\n');
 const html='<main><p style="font-size:14px;color:#526273">Pack One</p><h1 style="font-size:24px;line-height:1.3">'+esc(heading)+'</h1>'+
  introduction.split(/\n\s*\n/).map(p=>'<p>'+esc(p).replaceAll('\n','<br>')+'</p>').join('')+
  (lines.length?'<ul>'+lines.map(line=>'<li style="margin:12px 0">'+esc(line)+'</li>').join('')+'</ul>':'')+
  '<p><a href="https://packone.pro/">Play Pack One</a></p><p style="font-size:13px;color:#526273">You turned on '+(campaign.kind==='news'?'Pack One news':'weekly results emails')+'. <a href="https://packone.pro/?account=1">Manage your choices</a>. Your Daily reminder setting is separate.</p></main>';
 return {subject:campaign.subject,text,html};
}
async function deliveryProof(query,env){
 return (await query(`INSERT INTO results_email_runtime(singleton,config_hash) VALUES(true,$1)
  ON CONFLICT(singleton) DO UPDATE SET config_hash=excluded.config_hash,
   verified_at=CASE WHEN results_email_runtime.config_hash=excluded.config_hash THEN results_email_runtime.verified_at ELSE NULL END
  RETURNING verified_at`,[resultsEmailProof(env)])).rows[0]?.verified_at||null;
}
async function automaticCampaigns(query,clock){
 // Runtime start is independent of the immutable notice-launch cutoff. It only
 // prevents historical season/week backfills when delivery is first enabled.
 const local=zonedDateTime(new Date(clock).toISOString(),'America/Chicago');
 if(local.hour!==10)return;
 if(new Date(local.date+'T12:00:00Z').getUTCDay()===1){
  const start=shift(local.date,-7),end=shift(local.date,-1);
  await query(`INSERT INTO results_email_campaigns(campaign_key,kind,state,subject,start_date,end_date,approved_at,expires_at)
   SELECT $1,'week','approved','Your week in Pack One: '||$2,$2::date,$3::date,now(),now()+interval '24 hours'
   FROM results_email_runtime r CROSS JOIN results_launch l
   WHERE r.singleton AND l.singleton AND l.launch_at<=now()
    AND $3::date>=greatest((r.started_at AT TIME ZONE 'America/Los_Angeles')::date,(l.launch_at AT TIME ZONE 'America/Los_Angeles')::date)
   ON CONFLICT(campaign_key) DO NOTHING`,['week:'+start,start,end]);
 }
 await query(`INSERT INTO results_email_campaigns(campaign_key,kind,state,subject,start_date,end_date,approved_at,expires_at)
  SELECT 'season:'||s.id,'season','approved','Your Pack One season results',s.start_date,s.end_date,now(),now()+interval '24 hours'
  FROM draft_run_seasons s CROSS JOIN results_email_runtime r CROSS JOIN results_launch l
  WHERE r.singleton AND l.singleton AND l.launch_at<=now() AND s.end_date<$1::date
   AND s.end_date>=greatest((r.started_at AT TIME ZONE 'America/Los_Angeles')::date,(l.launch_at AT TIME ZONE 'America/Los_Angeles')::date)
  ON CONFLICT(campaign_key) DO NOTHING`,[local.date]);
}
async function personalRows(query,authId,campaign){
 const player=(await query('SELECT player_id FROM account_links WHERE auth_user_id=$1::uuid',[authId])).rows[0]?.player_id;
 if(!player)return [];
 const result=[];
 for(const environment of DRAFT_RUN_LEADERBOARD_ENVIRONMENTS){
  const row=(await draftRunLeaderboardRows(query,{start:campaign.start_date,end:campaign.end_date,environment,playerId:player,limit:1,
   ...(campaign.kind==='week'?{bestOf:LEADERBOARD_BEST_OF.week}:{ratingPolicy:seasonRatingPolicy(environment,campaign.start_date)})}))[0];
  // Never include a player name, profile link or another player's results.
  if(row)result.push({environment,rank:row.rank,score:row.score,days:row.days});
  else{
   // A hidden/unowned public name never prevents a private summary of the
   // recipient's own games. It simply has no public leaderboard rank.
   const scores=(await query(`SELECT score FROM scores WHERE player_id=$1::uuid AND mode='draft_run' AND set_id=$2
    AND challenge_date BETWEEN $3::date AND $4::date AND ($5::text[] IS NULL OR details_json->>'corpus_version'=ANY($5::text[]))`,
   [player,environment,campaign.start_date,campaign.end_date,STANDINGS_LINEAGE[DRAFT_RUN_CORPUS_VERSION]?'{'+STANDINGS_LINEAGE[DRAFT_RUN_CORPUS_VERSION].join(',')+'}':null])).rows.map(r=>Number(r.score));
   if(scores.length)result.push({environment,rank:null,days:scores.length,score:campaign.kind==='week'?
    scores.sort((a,b)=>b-a).slice(0,LEADERBOARD_BEST_OF.week).reduce((a,b)=>a+b,0)/LEADERBOARD_BEST_OF.week:
    conservativeSeasonRating({sum:scores.reduce((a,b)=>a+b,0),days:scores.length},seasonRatingPolicy(environment,campaign.start_date))});
  }
 }
 return result;
}
async function finish(query,id,state){
 await query("UPDATE results_email_deliveries SET state=$2,updated_at=now() WHERE id=$1::uuid AND state IN ('preparing','sending')",[id,state]);
}
export async function deliverResultsEmail(query,campaign,authId,{env=process.env,fetcher=fetch}={}){
 if(!resultsDeliveryConfiguration(env).active)return 'inactive';
 const id=(await query('SELECT pack1_results_claim_delivery($1::uuid,$2::uuid) id',[campaign.id,authId])).rows[0]?.id;
 if(!id)return 'not_claimed';
 let handoff=false;
 try{
  const content=resultsEmailContent(campaign,campaign.kind==='news'?[]:await personalRows(query,authId,campaign));
  if(!content){await finish(query,id,'skipped');return 'skipped';}
  // No cached envelopes or exported recipients. This performs fresh consent,
  // verified-destination, suppression, cancellation and deletion checks.
  const envelope=await prepareResultsEmail(query,authId,content,{env,deliveryId:id});
  handoff=true;
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{authorization:'Bearer '+env.PACK1_RESULTS_RESEND_API_KEY,'content-type':'application/json','Idempotency-Key':'pack1-results-'+id},body:JSON.stringify(envelope)});
  if(!response.ok){const state=response.status>=400&&response.status<500?'failed':'uncertain';await finish(query,id,state);return state;}
  const value=await response.json();
  if(typeof value?.id!=='string'||!value.id||value.id.length>200)throw Error('Unconfirmed provider response.');
  await query("UPDATE results_email_deliveries SET state='accepted',provider_id=coalesce(provider_id,$2),updated_at=now() WHERE id=$1::uuid AND state='sending'",[id,value.id]);
  return 'accepted';
 }catch(error){
  const state=handoff?'uncertain':error?.resultsSafe&&Number(error.status)===409?'skipped':'failed';
  await finish(query,id,state);return state;
 }
}
export async function dispatchResultsEmail(query,{env=process.env,fetcher=fetch,clock=Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!resultsDeliveryConfiguration(env).active)return {active:false};
 if(!(await query('SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()')).rows.length)return {active:false};
 if(!await deliveryProof(query,env))return {active:false,verificationRequired:true};
 await automaticCampaigns(query,clock);
 await query("UPDATE results_email_deliveries SET state='uncertain',updated_at=now() WHERE state IN ('preparing','sending') AND updated_at<now()-interval '20 minutes'");
 const campaigns=(await query("SELECT id,kind,subject,body,start_date::text,end_date::text FROM results_email_campaigns WHERE state='approved' AND approved_at<=now() AND expires_at>now() ORDER BY approved_at,id LIMIT 10")).rows;
 const counts={active:true,attempted:0,accepted:0,failed:0,uncertain:0,skipped:0};const started=Date.now();
 for(const campaign of campaigns){
  while(counts.attempted<100&&Date.now()-started<75000){
   const accounts=(await query(`SELECT p.auth_user_id FROM results_preferences p JOIN neon_auth."user" u ON u.id=p.auth_user_id
    JOIN results_email_campaigns c ON c.id=$1::uuid WHERE ((c.kind='news' AND p.news_email_state='on' AND p.news_changed_at<=c.approved_at)
      OR (c.kind<>'news' AND p.email_state='on' AND p.changed_at<=c.approved_at))
     AND u."emailVerified" IS TRUE AND u."createdAt"<=c.approved_at
     AND (c.target_auth_user_id IS NULL OR c.target_auth_user_id=p.auth_user_id)
     AND NOT EXISTS(SELECT 1 FROM results_email_deliveries d WHERE d.campaign_id=c.id AND d.auth_user_id=p.auth_user_id)
    ORDER BY p.auth_user_id LIMIT 25`,[campaign.id])).rows;
   if(!accounts.length)break;
   let claimed=0;
   for(const row of accounts){
    if(counts.attempted>=100||Date.now()-started>=75000)break;
    const state=await deliverResultsEmail(query,campaign,row.auth_user_id,{env,fetcher});
    if(state==='not_claimed'||state==='inactive')continue;
    claimed++;counts.attempted++;counts[state]++;
    await wait(600); // Stay below the default provider rate without a burst.
   }
   if(!claimed)break;
  }
 }
 return counts;
}
export async function resultsCampaignAdmin(query,authId,payload=null,{env=process.env,fetcher=fetch}={}){
 const owner=(await query("SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid AND role='owner'",[authId])).rows.length;
 if(!owner)failure('Owner access required.',403);
 const config=resultsDeliveryConfiguration(env),verified=config.ready?Boolean(await deliveryProof(query,env)):false;
 let check=null;
 if(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!['action','id','subject','body','previewHash'].includes(k)))failure('Choose a valid campaign action.');
  if(payload.action==='check'&&UUID.test(String(payload.id||''))){
   if(!resultsDeliveryConfiguration(env).ready)failure('Sender configuration is not ready yet.',409);
   const campaign=(await query(`INSERT INTO results_email_campaigns(campaign_key,kind,state,subject,body,target_auth_user_id,approved_at,expires_at)
    SELECT $1,'news','approved','Pack One email delivery check','Your Results and news email setup is working. Your Daily reminder setting is unchanged.',$2::uuid,now(),now()+interval '15 minutes'
    FROM results_preferences p JOIN neon_auth."user" u ON u.id=p.auth_user_id
    WHERE p.auth_user_id=$2::uuid AND p.news_email_state='on' AND u."emailVerified" IS TRUE
     AND NOT EXISTS(SELECT 1 FROM results_email_campaigns c WHERE c.target_auth_user_id=$2::uuid AND c.created_at>now()-interval '1 minute' AND c.campaign_key<>$1)
    ON CONFLICT(campaign_key) DO UPDATE SET campaign_key=excluded.campaign_key
    RETURNING *`,['check:'+authId+':'+payload.id,authId])).rows[0];
   if(!campaign)failure('Turn on Pack One news for this verified account before checking delivery; wait a minute between new checks.',409);
   check={id:campaign.id,state:await deliverResultsEmail(query,campaign,authId,{env:{...env,PACK1_RESULTS_EMAIL_ENABLED:'1'},fetcher})};
  }else if(payload.action==='draft'){
   const subject=String(payload.subject||'').trim(),body=String(payload.body||'').trim();
   if(!subject||subject.length>160||/[\r\n]/.test(subject)||!body||body.length>10000)failure('Enter a subject and message within the limits.');
   await query("INSERT INTO results_email_campaigns(campaign_key,kind,subject,body) VALUES($1,'news',$2,$3)",['news:'+randomUUID(),subject,body]);
  }else if(['approve','cancel'].includes(payload.action)&&UUID.test(String(payload.id||''))){
   if(payload.action==='approve'){
    if(!config.active||!verified)failure('Verify email delivery before approving a campaign.',409);
    const row=(await query("SELECT subject,body FROM results_email_campaigns WHERE id=$1::uuid AND kind='news' AND state='draft'",[payload.id])).rows[0];
    if(!row||payload.previewHash!==digest(row))failure('The draft changed. Preview it again before sending.',409);
    await query("UPDATE results_email_campaigns SET state='approved',approved_at=now(),expires_at=now()+interval '24 hours' WHERE id=$1::uuid AND kind='news' AND state='draft' AND subject=$2 AND body=$3",[payload.id,row.subject,row.body]);
   }else await query("UPDATE results_email_campaigns SET state='cancelled' WHERE id=$1::uuid",[payload.id]);
  }else failure('Choose a valid campaign action.');
 }
 const campaigns=(await query(`SELECT c.id,c.kind,c.state,c.subject,c.body,c.created_at,c.approved_at,c.expires_at,
  (SELECT count(*)::int FROM results_email_deliveries d WHERE d.campaign_id=c.id AND d.state IN ('accepted','delivered')) accepted,
  (SELECT count(*)::int FROM results_email_deliveries d WHERE d.campaign_id=c.id AND d.state='delivered') delivered,
  (SELECT count(*)::int FROM results_email_deliveries d WHERE d.campaign_id=c.id AND d.state='uncertain') uncertain,
  (SELECT count(*)::int FROM results_email_deliveries d WHERE d.campaign_id=c.id AND d.state IN ('failed','bounced','complained')) failed
  FROM results_email_campaigns c ORDER BY c.created_at DESC LIMIT 25`)).rows;
 return {...config,active:config.active&&verified,verified,...(check?{check}:{}),campaigns:campaigns.map(c=>({...c,previewHash:digest(c)}))};
}
export async function resultsEmailRoute(request,{query,json,readJson,authAdmin,trigger,env=process.env}={}){
 const path=new URL(request.url).pathname;
 if(path==='/internal/results-email'){
  if(request.method!=='POST')failure('Not found.',404);
  const checked=trigger(request,await readJson(request),{names:new Set([RESULTS_EMAIL_TRIGGER])});
  if(!checked)failure('Neon scheduler identity required.',403);
  if(Math.abs(Date.now()-Date.parse(checked.scheduledAt))>20*60*1000)return json({ok:true,stale:true});
  return json(await dispatchResultsEmail(query,{env,clock:Date.parse(checked.scheduledAt)}));
 }
 if(path==='/v1/admin/results-campaigns'&&['GET','POST','PATCH'].includes(request.method)){
  const auth=await authAdmin(request,{mutation:request.method!=='GET'});
  return json(await resultsCampaignAdmin(query,auth.user_id,request.method==='GET'?null:await readJson(request),{env}));
 }
 failure('Not found.',404);
}
