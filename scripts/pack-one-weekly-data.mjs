// Private, read-only weekly Patreon recap data. No command-line entry point,
// logs, public artifacts, or publisher. Never pass these rows to the public
// contested-pick desktop feed. Publication must re-admit and record each name.
import {DRAFT_RUN_LEADERBOARD_ENVIRONMENTS,draftRunLeaderboardRows,LEADERBOARD_BEST_OF} from '../worker/draft-run-season.mjs';
import {seasonRatingPolicy} from '../worker/season-rating.mjs';
import {publishableResultsName,resultsLaunch} from '../worker/results-privacy.mjs';
import {FEATURED_SQL,imageUrl,selectFeaturedPick,MIN_FEATURED_PEERS} from './featured-pick.mjs';

export const MIN_DAILY_RUNS=20;
export const MIN_DIFFICULTY_GAP=5;
export const FORMATS=Object.freeze([...DRAFT_RUN_LEADERBOARD_ENVIRONMENTS]);
const CUTOFF='2026-11-30T15:33:00Z';
const date=value=>String(value).slice(0,10);
// The existing growth HTTP SQL adapter returns raw JSON text and stringifies
// parameters. Use explicit PostgreSQL arrays and decode JSON only at this boundary.
const pgArray=values=>'{'+values.map(value=>JSON.stringify(String(value))).join(',')+'}';
const object=value=>typeof value==='string'?JSON.parse(value):value;
export function validDay(day) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)
  throw Error('weekly-invalid-day');
 return day;
}
export function addDays(day,count) {
 const d=new Date(validDay(day)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);
 return d.toISOString().slice(0,10);
}
function localParts(now,zone) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(v=>[v.type,v.value]));
 return {day:p.year+'-'+p.month+'-'+p.day,weekday:p.weekday,hour:Number(p.hour),minute:Number(p.minute)};
}
export function weeklyWindow(now=new Date()) {
 const {day}=localParts(now,'America/Los_Angeles');
 const dow=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
 const monday=addDays(day,-dow);
 return {start:addDays(monday,-7),end:addDays(monday,-1)};
}
// Noon Central, not fixed UTC. Monday may recover later the same day; no
// auto catch-up on another date. Pick of the Week may recover Thursday only.
export function weeklyDue(now=new Date(),kind='recap') {
 const p=localParts(now,'America/Chicago');
 if(kind==='recap'&&(p.weekday!=='Mon'||p.hour<12))return null;
 if(kind==='pick'&&!['Wed','Thu'].includes(p.weekday))return null;
 if(!['recap','pick'].includes(kind))throw Error('weekly-invalid-kind');
 const window=weeklyWindow(now);
 return {...window,key:'pack-one-weekly:'+kind+':'+window.end,backup:p.weekday==='Thu'};
}
export function topFive(rows) {
 return rows.filter(r=>Number(r.rank)<=5);
}
function checkedWindow(window) {
 const start=validDay(window.start),end=validDay(window.end);
 if(addDays(start,6)!==end||new Date(start+'T12:00:00Z').getUTCDay()!==1)
  throw Error('weekly-invalid-window');
 return {start,end};
}
export function hardestDaily(rows,{minRuns=MIN_DAILY_RUNS,minGap=MIN_DIFFICULTY_GAP}={}) {
 const byFormat=new Map(FORMATS.map(f=>[f,[]]));
 for(const r of rows)if(byFormat.has(r.environment)&&Number(r.runs)>=minRuns&&Number.isFinite(Number(r.mean)))byFormat.get(r.environment).push(r);
 const candidates=[];
 for(const [environment,days] of byFormat) {
  if(days.length!==7||new Set(days.map(d=>d.day)).size!==7)continue;
  for(const day of days) {
   const others=days.filter(x=>x!==day);
   const rest=others.reduce((n,x)=>n+Number(x.mean)*Number(x.runs),0)/others.reduce((n,x)=>n+Number(x.runs),0);
   const mean=Number(day.mean);
   if(rest-mean>=minGap)candidates.push({environment,day:day.day,mean,rest,gap:rest-mean});
  }
 }
 return candidates.sort((a,b)=>b.gap-a.gap||a.day.localeCompare(b.day)||FORMATS.indexOf(a.environment)-FORMATS.indexOf(b.environment))[0]||null;
}
export function easiestPick(rows,{minPeers=MIN_FEATURED_PEERS}={}) {
 const eligible=[];
 for(const row of rows) {
  if(!FORMATS.includes(row.environment))continue;
  const cards=row.payload?.candidates,prior=row.payload?.prior_picks;
  const pick=Number(row.pick_number);
  if(!Array.isArray(cards)||cards.length<2||!Array.isArray(prior)||!Number.isInteger(pick)||pick<1||pick>15||prior.length!==pick-1)continue;
  if([...cards,...prior].some(c=>typeof c?.name!=='string'||!c.name||!imageUrl(c.image_url)))continue;
  const ids=new Set(cards.map(c=>c.id));
  const trophy=cards.find(c=>c.id===row.payload.historical_pick_id);
  if(!trophy||ids.size!==cards.length||cards.some(c=>typeof c.id!=='string'||!c.id))continue;
  const votes=Object.entries(row.votes||{});
  if(votes.some(([id,n])=>!ids.has(id)||!Number.isSafeInteger(Number(n))||Number(n)<1))continue;
  const total=votes.reduce((n,[,v])=>n+Number(v),0);
  const matches=Number(row.votes?.[trophy.id]||0);
  if(total<minPeers||matches===0)continue;
  eligible.push({day:row.day,environment:row.environment,set_id:row.set_id,pick_number:pick,round:Number(row.round),puzzle_id:row.puzzle_id,
    candidates:cards.map(c=>({id:c.id,name:c.name,image_url:imageUrl(c.image_url),rarity:c.rarity||''})),
    prior_picks:prior.map(c=>({name:c.name,image_url:imageUrl(c.image_url)})),
    trophy_id:trophy.id,trophy_name:trophy.name,total,matches,match_pct:Math.round(1000*matches/total)/10});
 }
 return eligible.sort((a,b)=>b.matches/b.total-a.matches/a.total||b.total-a.total||a.day.localeCompare(b.day)||FORMATS.indexOf(a.environment)-FORMATS.indexOf(b.environment)||a.round-b.round)[0]||null;
}
// Preserve the existing debate quality gates; choose across the entire prior
// week, not yesterday. The same window/key must be frozen for both attempts.
export function pickOfWeek(rows) {
 const byDay=new Map();
 for(const row of rows){const day=validDay(row.day);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(row);}
 return [...byDay].map(([day,list])=>selectFeaturedPick(list,{day})).filter(Boolean)
  .sort((a,b)=>b.tier-a.tier||Number(b.environment==='latest')-Number(a.environment==='latest')||b.score-a.score||b.players-a.players||a.day.localeCompare(b.day)||FORMATS.indexOf(a.environment)-FORMATS.indexOf(b.environment)||a.round-b.round)[0]||null;
}
export async function scheduledVotes(query,window) {
 const {start}=checkedWindow(window);
 const days=Array.from({length:7},(_,i)=>addDays(start,i));
 const rows=await Promise.all(days.map(async day=>(await query(FEATURED_SQL,[day])).rows.map(r=>({...r,day,payload:object(r.payload),votes:object(r.votes)}))));
 return rows.flat();
}
// Fail closed when a bound cuts a tie. No user-visible names from unrestricted
// display_name fields: resolve current eligible names through the privacy helper.
async function admitRows(query,rows,placements,nameFor=publishableResultsName) {
 const result=[];
 // The backend's normal path resolves all eligible names in one SQL call
 // per board; the legacy injected helper remains supported for fixture tests.
 const batch=nameFor===publishableResultsName&&rows.length?(await query(
  'SELECT l.player_id::text,l.auth_user_id::text AS auth_id,pack1_results_publishable_name(l.auth_user_id) AS name FROM account_links l WHERE l.player_id=ANY($1::uuid[])',[pgArray(rows.map(r=>r.player_id))])).rows:null;
 for(const r of rows) {
  const linked=batch?batch.filter(a=>a.player_id===r.player_id):(await query('SELECT auth_user_id::text AS auth_id FROM account_links WHERE player_id=$1::uuid',[r.player_id])).rows;
  const authId=linked.length===1?linked[0].auth_id:null;
  const name=authId?(batch?linked[0].name||'Anonymous player':await nameFor(query,authId)):'Anonymous player';
  const eligible=name!=='Anonymous player'&&name===r.display_name;
  if(eligible)placements.push({authId,name});
  result.push({rank:Number(r.rank),name:eligible?name:'Anonymous player',score:Number(r.score),average_score:Number(r.average_score),days:Number(r.days)});
 }
 return result;
}
const LIMIT=1001;
async function board(query,options,placements,nameFor) {
 const all=await draftRunLeaderboardRows(query,{...options,limit:LIMIT});
 if(all.length===LIMIT&&Number(all.at(-1).rank)<=5)throw Error('weekly-truncated-tie');
 return admitRows(query,topFive(all),placements,nameFor);
}
export async function assertNamedPublicationTime(query,now=new Date()) {
 const launch=await resultsLaunch(query);
 if(!launch.active||!launch.firstPublicationAt||!Number.isFinite(Date.parse(launch.firstPublicationAt))||
  now.getTime()<Math.max(Date.parse(CUTOFF),Date.parse(launch.firstPublicationAt)))
  throw Error('weekly-privacy-cutoff');
}
// The caller must use a private, authenticated runtime; returned data includes
// names and private publication bookkeeping. Never log or serialize to a public
// artifact. This is collection only, not permission to publish.
export async function collectWeeklyRecap(query,window,{now=new Date(),nameFor=publishableResultsName}={}) {
 const {start,end}=checkedWindow(window);
 await assertNamedPublicationTime(query,now);
 const placements=[];
 const season=(await query('SELECT id,set_name,start_date::text,end_date::text FROM draft_run_seasons WHERE start_date<=$1::date AND (end_date IS NULL OR end_date>=$1::date) ORDER BY start_date DESC LIMIT 1',[end])).rows[0];
 const weekly=[],seasonBoards=[];
 for(const environment of FORMATS) {
  weekly.push({environment,rows:await board(query,{start,end,environment,bestOf:LEADERBOARD_BEST_OF.week},placements,nameFor)});
  if(season)seasonBoards.push({environment,rows:await board(query,{start:date(season.start_date),end,environment,ratingPolicy:seasonRatingPolicy(environment,date(season.start_date))},placements,nameFor)});
 }
 const {STANDINGS_LINEAGE}=await import('../worker/draft-run-season.mjs');
 const {DRAFT_RUN_CORPUS_VERSION}=await import('../draft-run.mjs');
 const lineage=STANDINGS_LINEAGE[DRAFT_RUN_CORPUS_VERSION]||[DRAFT_RUN_CORPUS_VERSION];
 const rows=(await query(`SELECT challenge_date::text AS day,set_id AS environment,count(*)::int AS runs,avg(score)::float8 AS mean
  FROM scores WHERE mode='draft_run' AND challenge_date BETWEEN $1::date AND $2::date
  AND set_id=ANY($3::text[]) AND details_json->>'corpus_version'=ANY($4::text[])
  GROUP BY 1,2`,[start,end,pgArray(FORMATS),pgArray(lineage)])).rows;
 const hardest=hardestDaily(rows);
 if(hardest)hardest.rows=await board(query,{start:hardest.day,end:hardest.day,environment:hardest.environment},placements,nameFor);
 const perfect=(await query(`SELECT s.challenge_date::text AS day,s.set_id AS environment,s.player_id::text,p.display_name
  FROM scores s JOIN players p ON p.id=s.player_id
  WHERE s.mode='draft_run' AND s.challenge_date BETWEEN $1::date AND $2::date
  AND s.set_id=ANY($3::text[]) AND s.details_json->>'corpus_version'=ANY($4::text[]) AND s.score=100
  AND p.username_owned=true AND p.public_identity_hidden_at IS NULL
  AND EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=s.player_id)
  ORDER BY s.challenge_date,s.set_id,p.display_name LIMIT 1001`,[start,end,pgArray(FORMATS),pgArray(lineage)])).rows;
 if(perfect.length===1001)throw Error('weekly-truncated-perfects');
 const perfectNames=await admitRows(query,perfect.map(r=>({...r,rank:1,score:100,average_score:100,days:1})),placements,nameFor);
 const perfectDailies=perfect.map((r,i)=>({day:r.day,environment:r.environment,name:perfectNames[i].name}));
 const easiest=easiestPick(await scheduledVotes(query,{start,end}));
 return {article:{start,end,weekly,perfectDailies,hardest,easiest,seasonName:season?.set_name||null,seasonBoards},placements};
}
