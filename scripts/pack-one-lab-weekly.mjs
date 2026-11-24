// Scheduled private *review-only* pilot; never publishes to Patreon.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {centralDate,articleHash,LAB_OWNER_URL} from '../worker/lab-editorial.mjs';
import {makeArticle,aiClient,pinnedPilotPackets} from '../worker/lab-writer.mjs';
import {provenance} from '../research/pack-one-lab/pilot.mjs';

const fail=code=>{throw Error('lab-'+code);};
export function phase(now=new Date()){
  const p=centralDate(now);
  if(p.weekday==='Tue'&&p.hour>=6&&p.hour<10)return 'prepare';
  if(['Wed','Thu','Fri'].includes(p.weekday)&&p.hour>=6&&p.hour<=18)return 'review';
  return 'idle';
}
function databaseURL(raw){
  let u;
  try{u=new URL(raw);}catch{fail('db-config');}
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech')||u.hostname.includes('-pooler.')||!u.username||!u.password||u.searchParams.get('sslmode')!=='verify-full')fail('db-config');
  return u.href;
}
export async function readPackets(){
  const raw=await readFile(new URL('../'+provenance.path,import.meta.url));
  if(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex')!==provenance.blob)fail('source-hash');
  return pinnedPilotPackets(JSON.parse(raw));
}
export function selectPackets(packets,history,issue){
  const already=new Set(history.flatMap(r=>r.attempted_ids||[]));
  const attempted=new Set(issue.attempted_ids||[]);
  if(issue.state==='revision_requested')return packets.filter(p=>p.id===issue.candidate_id);
  return packets.filter(p=>!already.has(p.id)&&!attempted.has(p.id));
}
async function recordAttempt(query,issue,id){
  const r=await query(`UPDATE pack1_lab_issues SET attempted_ids=array_append(attempted_ids,$3),
    updated_at=now() WHERE week_key=$1::date AND revision=$2 AND state IN ('researching','alternative_requested','revision_requested')
    AND NOT ($3=ANY(attempted_ids)) RETURNING week_key`,[issue.week,issue.revision,id]);
  return r.rows.length===1;
}
async function saveDraft(query,issue,packet,article){
  const hash=articleHash(article);
  const result=await query(`WITH changed AS (
    UPDATE pack1_lab_issues SET state='review',revision=revision+1,candidate_id=$3,
      article=$4::jsonb,article_hash=$5,feedback=NULL,notification_sent_at=NULL,notification_claimed_at=NULL,updated_at=now()
    WHERE week_key=$1::date AND revision=$2 AND state=$6
    RETURNING week_key,revision,article_hash
  ), event AS (
    INSERT INTO pack1_lab_events(week_key,revision,action,article_hash)
      SELECT week_key,revision,'review_ready',article_hash FROM changed RETURNING id
  ) SELECT revision FROM changed`,[issue.week,issue.revision,packet.id,JSON.stringify(article),hash,issue.state]);
  return result.rows.length===1;
}
async function stopWeek(query,issue){
  await query(`UPDATE pack1_lab_issues SET state='no_finding',updated_at=now()
    WHERE week_key=$1::date AND revision=$2 AND state=$3`,[issue.week,issue.revision,issue.state]);
}
async function sendNotice(query,issue,{env=process.env,fetcher=fetch,now=new Date()}={}){
  if(issue.state!=='review'||issue.notification_sent_at||centralDate(now).hour<9)return;
  const key=env.PACK1_LAB_RESEND_API_KEY;
  if(!key?.startsWith('re_'))fail('email-config');
  // Claim before sending; do not retry after an ambiguous send. The receipt is
  // per revision. Operators can reconcile the provider without a duplicate.
  const claim=await query(`UPDATE pack1_lab_issues SET notification_claimed_at=now()
    WHERE week_key=$1::date AND revision=$2 AND state='review' AND article_hash=$3
      AND notification_claimed_at IS NULL AND notification_sent_at IS NULL RETURNING revision`,
    [issue.week,issue.revision,issue.hash]);
  if(!claim.rows.length)return;
  const res=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',
    headers:{authorization:'Bearer '+key,'content-type':'application/json','idempotency-key':'pack-one-lab-'+issue.week+'-'+issue.revision},
    body:JSON.stringify({from:'Pack One <accounts@packone.pro>',to:['admin@packone.pro'],
      subject:'Pack One Lab — article ready for review',
      text:'A private Lab article is ready for your review. Sign into Pack One Admin to review the exact article, request revisions or choose another topic. No approval means no publication.\n\n'+LAB_OWNER_URL}),
    signal:AbortSignal.timeout(30000)});
  if(!res.ok)fail('email-unverified');
  const receipt=await res.json();
  if(typeof receipt?.id!=='string'||!receipt.id)fail('email-unverified');
  await query(`UPDATE pack1_lab_issues SET notification_sent_at=now()
    WHERE week_key=$1::date AND revision=$2 AND article_hash=$3 AND state='review'`,[issue.week,issue.revision,issue.hash]);
}
export async function cycle(query,{now=new Date(),packets,writer,reviewer,env=process.env,fetcher=fetch}){
  const runPhase=phase(now),week=centralDate(now).week;
  if(runPhase==='idle')return 'outside-window';
  await query(`INSERT INTO pack1_lab_issues(week_key,state) VALUES($1::date,'researching')
    ON CONFLICT(week_key) DO NOTHING`,[week]);
  if(runPhase==='prepare')return 'pilot-evidence-ready';
  const load=async()=>(await query(`SELECT week_key::text AS week,state,revision,candidate_id,attempted_ids,
    article_hash AS hash,notification_sent_at,notification_claimed_at,feedback FROM pack1_lab_issues WHERE week_key=$1::date`,[week])).rows[0];
  let issue=await load();
  if(!issue)fail('missing-week');
  if(['approved','skipped','no_finding'].includes(issue.state))return 'terminal-no-publication';
  if(issue.state!=='review'){
    const history=(await query('SELECT attempted_ids FROM pack1_lab_issues WHERE week_key<$1::date',[week])).rows;
    const choices=selectPackets(packets,history,issue);
    let saved=false;
    for(const packet of choices){
      if(issue.state!=='revision_requested'&&!await recordAttempt(query,issue,packet.id))continue;
      const article=await makeArticle(packet,{writer,reviewer,feedback:issue.feedback||''});
      if(!article)continue;
      if(await saveDraft(query,issue,packet,article)){saved=true;break;}
      return 'changed-concurrently';
    }
    if(!saved){await stopWeek(query,issue);return 'no-finding';}
    issue=await load();
  }
  await sendNotice(query,issue,{env,fetcher,now});
  return 'review-ready';
}
async function main(){
  if(process.env.PACK1_LAB_REVIEW_ENABLED!=='true'){console.log('Lab review pilot disabled.');return;}
  if(process.env.GITHUB_ACTIONS&&(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer'))fail('untrusted-ref');
  if(phase()==='idle'){console.log('Lab: outside Central review window.');return;}
  const packets=await readPackets();
  const writer=aiClient({key:process.env.PACK1_LAB_AI_KEY,model:process.env.PACK1_LAB_WRITER_MODEL});
  const reviewer=aiClient({key:process.env.PACK1_LAB_AI_KEY,model:process.env.PACK1_LAB_REVIEWER_MODEL});
  if(process.env.PACK1_LAB_WRITER_MODEL===process.env.PACK1_LAB_REVIEWER_MODEL)fail('distinct-reviewer-required');
  const client=new Client({connectionString:databaseURL(process.env.PACK1_LAB_DATABASE_URL),connectionTimeoutMillis:15000});
  await client.connect();
  try{
    const lock=await client.query('SELECT pg_try_advisory_lock(1791,20261124) AS locked');
    if(!lock.rows[0]?.locked){console.log('Lab: another worker is active.');return;}
    const status=await cycle((sql,params)=>client.query(sql,params),{packets,writer,reviewer});
    console.log('Lab review pilot: '+status+'; no Patreon publication.');
  }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1].replaceAll('\\','/')).href)
  main().catch(()=>{console.error('Lab private review run stopped; check configuration and private queue. No article was published.');process.exitCode=1;});
