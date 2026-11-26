import {createHash} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const HASH=/^[a-f0-9]{64}$/;
const WEEK=/^\d{4}-\d{2}-\d{2}$/;
const actions=new Set(['approve','approve_now','revise','alternative','skip']);
export const LAB_OWNER_URL='https://packone.pro/admin/?area=publishing&kind=lab';
export function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function articleHash(article){return createHash('sha256').update(canonical(article)).digest('hex');}
export function centralDate(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const date=parts.year+'-'+parts.month+'-'+parts.day;
  const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((weekdays.indexOf(parts.weekday)+6)%7));
  return {date,week:d.toISOString().slice(0,10),weekday:parts.weekday,hour:Number(parts.hour),minute:Number(parts.minute)};
}
export function fridayNoon(week){
  if(!WEEK.test(week)||new Date(week+'T12:00:00Z').getUTCDay()!==1)fail('Invalid Lab week.');
  const d=new Date(week+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+4);
  // Central noon is 17 UTC in CDT or 18 UTC in CST.
  for(const hour of [17,18]){
    d.setUTCHours(hour,0,0,0);
    const p=centralDate(d);
    if(p.week===week&&p.weekday==='Fri'&&p.hour===12)return d.toISOString();
  }
  fail('Invalid publication window.');
}
export function parseAction(body){
  if(!body||!actions.has(body.action)||!WEEK.test(body.week||'')||!Number.isSafeInteger(body.revision)||body.revision<1||!HASH.test(body.hash||''))fail('Invalid Lab review action.');
  const feedback=typeof body.feedback==='string'?body.feedback.trim():'';
  if(feedback.length>1500||(body.action==='revise'&&!feedback))fail('Enter revision feedback (up to 1,500 characters).');
  return {action:body.action,week:body.week,revision:body.revision,hash:body.hash,feedback};
}
// Neon HTTP uses raw-text output; the weekly worker uses typed node-postgres.
// Normalize both and check the stored hash before exposing an approval target.
function isoTime(value){
  if(value==null)return null;
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))fail('Invalid Lab timestamp.',503);
  return d.toISOString();
}
export function normalizeLabIssue(row){
  const revision=Number(row.revision);
  if(!Number.isSafeInteger(revision)||revision<0)fail('Invalid Lab revision.',503);
  let article=row.article;
  if(typeof article==='string'){
    try{article=JSON.parse(article);}catch{fail('Invalid Lab article.',503);}
  }
  if(article!=null&&(!article||typeof article!=='object'||Array.isArray(article)||articleHash(article)!==row.hash))fail('Lab article integrity check failed.',503);
  if(article==null&&row.hash!=null)fail('Lab article integrity check failed.',503);
  const result={...row,revision,article:article??null};
  for(const key of ['approved_at','publish_at','notification_sent_at','notification_claimed_at','updated_at'])
    result[key]=isoTime(row[key]);
  return result;
}
export async function readLab(query){
  const result=await query(`SELECT week_key::text AS week,state,revision,candidate_id,article,article_hash AS hash,
    approved_hash,approved_at,publish_at,feedback,notification_sent_at,notification_claimed_at,updated_at FROM pack1_lab_issues
    ORDER BY week_key DESC LIMIT 6`,[]);
  const research=await query('SELECT source_key,state,attempted_at FROM pack1_lab_research ORDER BY attempted_at DESC LIMIT 4',[]);
  const receipts=await query('SELECT week_key::text AS week,state,public_url,published_at FROM patreon_lab_runs ORDER BY week_key DESC LIMIT 6',[]);
  const byWeek=new Map(receipts.rows.map(r=>[r.week,{state:r.state,public_url:r.public_url,published_at:isoTime(r.published_at)}]));
  const latest=(await query('SELECT sample_json,sample_hash FROM pack1_lab_sample_batches WHERE singleton',[])).rows[0];
  let samples=null;
  if(latest){
    samples=typeof latest.sample_json==='string'?JSON.parse(latest.sample_json):latest.sample_json;
    if(!samples||samples.kind!=='private-editorial-samples'||articleHash(samples)!==latest.sample_hash||!Array.isArray(samples.articles)||samples.articles.length>5||samples.articles.some(a=>articleHash(a.article)!==a.article_hash))fail('Lab sample integrity check failed.',503);
  }
  return {issues:result.rows.map(row=>({...normalizeLabIssue(row),publication:byWeek.get(row.week)||null})),research:research.rows.map(row=>({...row,attempted_at:isoTime(row.attempted_at)})),samples,publishing_available:process.env.PACK1_LAB_PUBLICATION_ENABLED==='true'};
}
export async function reviewLab(query,ownerId,body,now=new Date()){
  const a=parseAction(body);
  const state=({approve:'approved',approve_now:'approved',revise:'revision_requested',alternative:'alternative_requested',skip:'skipped'})[a.action];
  const approved=state==='approved';
  if(centralDate(now).week!==a.week)fail('This review window has closed.',409);
  const at=approved?(a.action==='approve_now'?now.toISOString():fridayNoon(a.week)):null;
  if(approved&&a.action==='approve'&&Date.parse(at)<now.getTime())fail('Friday has passed. Use approve now or skip.',409);
  const result=await query(`WITH changed AS (
    UPDATE pack1_lab_issues SET state=$4,feedback=$5,
      approved_hash=CASE WHEN $4='approved' THEN article_hash ELSE NULL END,
      approved_at=CASE WHEN $4='approved' THEN $8::timestamptz ELSE NULL END,
      approved_by=CASE WHEN $4='approved' THEN $6::uuid ELSE NULL END,
      publish_at=$7::timestamptz,updated_at=now()
    WHERE week_key=$1::date AND revision=$2 AND article_hash=$3 AND state='review'
    AND EXISTS(SELECT 1 FROM pack1_admins WHERE auth_user_id=$6::uuid AND role='owner')
    RETURNING week_key,revision,state,article_hash
  ), event AS (
    INSERT INTO pack1_lab_events(week_key,revision,action,owner_id,article_hash)
      SELECT week_key,revision,$9,$6::uuid,article_hash FROM changed RETURNING id
  ) SELECT state,revision FROM changed`,[a.week,a.revision,a.hash,state,a.feedback||null,ownerId,at,now.toISOString(),a.action]);
  if(!result.rows.length)fail('The article changed or is no longer awaiting approval. Refresh and review it again.',409);
  return {ok:true,state,revision:a.revision,publish_at:at,publishing_available:process.env.PACK1_LAB_PUBLICATION_ENABLED==='true'};
}
export async function handleLabAdmin(request,query,readJson,id,role){
  if(role!=='owner')fail('Owner access required.',403);
  const path=new URL(request.url).pathname;
  if(path==='/v1/admin/lab'&&request.method==='GET')return readLab(query);
  if(path==='/v1/admin/lab/review'&&request.method==='POST')return reviewLab(query,id,await readJson(request));
  fail('Not found.',404);
}
