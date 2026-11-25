// Private editorial data only. No CLI, logging, public feed, or provider writes.
// Named collection must only be called by an authenticated private backend.
import {gameDateKey} from '../game-date.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {STANDINGS_LINEAGE} from '../worker/draft-run-season.mjs';
import {seasonRatingPolicy} from '../worker/season-rating.mjs';
import {publishableResultsName} from '../worker/results-privacy.mjs';
import {FORMATS,validDay,addDays,board,admitRows,assertNamedPublicationTime} from './pack-one-weekly-data.mjs';
import {FEATURED_SQL,imageUrl} from './featured-pick.mjs';
import {STORE_LINKS} from '../weekly-patreon-contract.mjs';

const iso=v=>validDay(String(v));
const asObject=v=>typeof v==='string'?JSON.parse(v):v;
const arrayParam=values=>'{'+values.map(v=>JSON.stringify(String(v))).join(',')+'}';
const elapsed=(a,b)=>(Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000;
const hour=now=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(now));
const validId=v=>typeof v==='string'&&/^[a-z0-9-]{1,120}$/.test(v);
const seasonName=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=120&&!/[\r\n]/.test(v);
const seasonRow=s=>s&&validId(s.id)&&validId(s.set_id)&&seasonName(s.set_name)&&iso(s.start_date);
const gateKey=(kind,id)=>'pack-one-season:'+kind+':'+id;
const links=()=>'\n\nPlay Pack One: '+STORE_LINKS.web+'\nDownload on the App Store: '+STORE_LINKS.ios+'\nGet it on Google Play: '+STORE_LINKS.android;

// Require a persisted successor and the reconciliation watermark, not a release
// date or a mutable catalog status. No automatic historical catch-up.
export const CLOSED_SEASON_SQL = [
 'SELECT old.id,old.set_id,old.set_name,old.start_date::text,old.end_date::text,',
 'next.id AS successor_id,next.start_date::text AS successor_start',
 'FROM draft_run_seasons old JOIN draft_run_seasons next ON next.start_date=old.end_date+1',
 'JOIN draft_run_season_reconciliation_state state ON state.singleton',
 'AND state.last_reconciled_day>=next.start_date',
 'WHERE next.start_date=$1::date AND next.set_release_date>old.set_release_date',
 'ORDER BY old.start_date DESC LIMIT 2'
].join(' ');
export function seasonResultsDue(row,now=new Date(),{enabledFrom}={}){
 if(!enabledFrom||!row||hour(now)<12)return null;
 const today=gameDateKey(now);
 if(today<iso(enabledFrom)||!seasonRow(row)||!validId(row.successor_id)||
    row.successor_id===row.id||iso(row.successor_start)!==today||
    addDays(iso(row.end_date),1)!==today||row.start_date>row.end_date)return null;
 return {kind:'season-results',key:gateKey('results',row.id),seasonId:row.id,setId:row.set_id,
  name:row.set_name,start:row.start_date,end:row.end_date,milestone:today};
}
export async function readSeasonResultsDue(query,now,options){
 const rows=(await query(CLOSED_SEASON_SQL,[gameDateKey(now)])).rows;
 if(rows.length>1)throw Error('season-close-ambiguous');
 return seasonResultsDue(rows[0],now,options);
}

// A next-season start is a reviewed planning milestone, not a persisted close.
// Until a valid reviewed plan exists, do not infer a midpoint from launch day.
export function midseasonDue(row,plan,now=new Date(),{enabledFrom}={}){
 if(!enabledFrom||!row||!plan||hour(now)<12||row.end_date!=null||
    !seasonRow(row)||plan.seasonId!==row.id||!validId(plan.nextSetId)||
    plan.nextSetId===row.set_id||!plan.reviewedOn)return null;
 const today=gameDateKey(now),start=iso(row.start_date),next=iso(plan.nextStart);
 const duration=elapsed(start,next);
 if(duration<14||duration>180)return null;
 const midpoint=addDays(start,Math.ceil(duration/2));
 if(today!==midpoint||today<iso(enabledFrom)||iso(plan.reviewedOn)>midpoint)return null;
 return {kind:'midseason-guide',key:gateKey('guide',row.id),seasonId:row.id,setId:row.set_id,
  name:row.set_name,start,end:addDays(midpoint,-1),milestone:midpoint};
}
export async function readMidseasonDue(query,plan,now,options){
 const rows=(await query('SELECT id,set_id,set_name,start_date::text,end_date::text FROM draft_run_seasons WHERE end_date IS NULL LIMIT 2',[])).rows;
 if(rows.length>1)throw Error('season-current-ambiguous');
 return midseasonDue(rows[0],plan,now,options);
}
export function seasonPostMetadata(gate){
 if(!gate||!seasonName(gate.name)||!validId(gate.seasonId)||!['season-results','midseason-guide'].includes(gate.kind))throw Error('season-invalid-gate');
 const title=(gate.kind==='season-results'?'Pack One Season Results & Awards':'Pack One Midseason Set Guide')+' | '+gate.name;
 return {key:gate.key,title,body:(gate.kind==='season-results'?'Final season results: ':'Midseason set guide: ')+gate.name+' ('+iso(gate.start)+' to '+iso(gate.end)+').'+links()};
}

// This is the same owned-public-account and corpus-lineage filter as the
// leaderboard, applied to the exact completed season. Count distinct days
// with a 100 score, not wins, games, practice or model agreement.
export const PERFECT_AWARDS_SQL=[
 'WITH counts AS (SELECT s.set_id AS environment,s.player_id,p.display_name,count(DISTINCT s.challenge_date)::int AS perfect_days',
 'FROM scores s JOIN players p ON p.id=s.player_id',
 "WHERE s.mode='draft_run' AND s.challenge_date BETWEEN $1::date AND $2::date AND s.score=100",
 'AND s.set_id=ANY($3::text[]) AND s.details_json->>\'corpus_version\'=ANY($4::text[])',
 'AND p.username_owned=true AND p.public_identity_hidden_at IS NULL',
 'AND EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=s.player_id)',
 'GROUP BY s.set_id,s.player_id,p.display_name), ranked AS (',
 'SELECT *,rank() OVER(PARTITION BY environment ORDER BY perfect_days DESC) AS rank FROM counts)',
 'SELECT environment,player_id::text,display_name,perfect_days,rank FROM ranked WHERE rank=1',
 'ORDER BY environment,display_name,player_id LIMIT 1001'
].join(' ');
export async function collectSeasonResults(query,{now=new Date(),enabledFrom,nameFor=publishableResultsName}={}){
 const gate=await readSeasonResultsDue(query,now,{enabledFrom});
 if(!gate)return null;
 await assertNamedPublicationTime(query,now);
 const placements=[],seasonBoards=[];
 for(const environment of FORMATS){
  const rows=await board(query,{start:gate.start,end:gate.end,environment,ratingPolicy:seasonRatingPolicy(environment,gate.start)},placements,nameFor);
  seasonBoards.push({environment,rows});
 }
 if(!seasonBoards.some(b=>b.rows.length))return null;
 const lineage=STANDINGS_LINEAGE[DRAFT_RUN_CORPUS_VERSION]||[DRAFT_RUN_CORPUS_VERSION];
 const perfect=(await query(PERFECT_AWARDS_SQL,[gate.start,gate.end,arrayParam(FORMATS),arrayParam(lineage)])).rows;
 if(perfect.length>=1001)throw Error('season-truncated-perfect-tie');
 if(perfect.some(p=>!FORMATS.includes(p.environment)||Number(p.rank)!==1||!Number.isSafeInteger(Number(p.perfect_days))||Number(p.perfect_days)<1))throw Error('season-invalid-award');
 const names=await admitRows(query,perfect.map(p=>({...p,score:100,average_score:100,days:Number(p.perfect_days)})),placements,nameFor);
 return {gate,article:{kind:gate.kind,start:gate.start,end:gate.end,seasonName:gate.name,seasonBoards,
  perfectAwards:perfect.map((p,i)=>({environment:p.environment,name:names[i].name,days:Number(p.perfect_days)}))},
  placements,...seasonPostMetadata(gate)};
}

export const GUIDE_GATES=Object.freeze({minPeers:50,minDecisions:24,minDays:7,minCoverage:.70,minStage:8,maxSnapshotAge:7,minGames:500,minColorCoverage:8});
function guideDecision(row,gate){
 if(row.environment!=='latest'||row.set_id!==gate.setId||row.day<gate.start||row.day>gate.end||!validId(row.puzzle_id))return null;
 const cards=row.payload?.candidates,prior=row.payload?.prior_picks,pick=Number(row.pick_number);
 if(!Array.isArray(cards)||cards.length<2||!Array.isArray(prior)||!Number.isInteger(pick)||pick<1||pick>15||prior.length!==pick-1)return null;
 if([...cards,...prior].some(c=>!seasonName(c?.name)||!imageUrl(c.image_url))||
    cards.some(c=>!validId(c.id)||typeof c.model_probability!=='number'||!Number.isFinite(c.model_probability)||c.model_probability<0||c.model_probability>1))return null;
 const ids=new Set(cards.map(c=>c.id));
 const trophy=cards.find(c=>c.id===row.payload.historical_pick_id);
 if(ids.size!==cards.length||!trophy)return null;
 const ranked=[...cards].sort((a,b)=>b.model_probability-a.model_probability||a.id.localeCompare(b.id));
 if(ranked[0].model_probability<=ranked[1].model_probability)return null;
 const model=ranked[0],votes=Object.entries(row.votes||{});
 if(votes.some(([id,n])=>!ids.has(id)||!Number.isSafeInteger(Number(n))||Number(n)<=0))return null;
 const total=votes.reduce((sum,[,v])=>sum+Number(v),0);
 if(total<GUIDE_GATES.minPeers)return null;
 const card=c=>({id:c.id,name:c.name,image_url:imageUrl(c.image_url),rarity:c.rarity||''});
 return {day:iso(row.day),puzzleId:row.puzzle_id,pick,stage:pick<=3?'early':'later',total,
  trophyVotes:Number(row.votes[trophy.id]||0),modelVotes:Number(row.votes[model.id]||0),
  trophyId:trophy.id,modelId:model.id,candidates:cards.map(card),
  prior:prior.map(c=>({name:c.name,image_url:imageUrl(c.image_url)}))};
}
const pct=(a,b)=>Math.round(1000*a/b)/10;
function stageStats(rows){
 const total=rows.reduce((s,r)=>s+r.total,0);
 return {decisions:rows.length,responses:total,
  trophyPct:pct(rows.reduce((s,r)=>s+r.trophyVotes,0),total),
  modelPct:pct(rows.reduce((s,r)=>s+r.modelVotes,0),total),
  modelTrophyPct:pct(rows.filter(r=>r.trophyId===r.modelId).length,rows.length)};
}
export function summarizeGuideDecisions(rows,gate){
 const relevant=rows.filter(r=>r.environment==='latest'&&r.set_id===gate.setId&&r.day>=gate.start&&r.day<=gate.end);
 const unique=new Map();
 for(const row of relevant){
  if(!validId(row.puzzle_id)||unique.has(row.puzzle_id))continue;
  unique.set(row.puzzle_id,row);
 }
 const valid=[...unique.values()].map(r=>guideDecision(r,gate)).filter(Boolean);
 const days=new Set(valid.map(r=>r.day)),scheduledDays=elapsed(gate.start,gate.end)+1;
 if(valid.length<GUIDE_GATES.minDecisions||days.size<GUIDE_GATES.minDays||
    days.size/scheduledDays<GUIDE_GATES.minCoverage||valid.length/unique.size<GUIDE_GATES.minCoverage)return null;
 const early=valid.filter(r=>r.stage==='early'),later=valid.filter(r=>r.stage==='later');
 if(Math.min(early.length,later.length)<GUIDE_GATES.minStage)return null;
 // Two actual packs from different days. Select contrasting model/trophy
 // response shares, not a repeat of the week's most contested pick ranking.
 const order=list=>[...list].sort((a,b)=>Math.abs(b.trophyVotes-b.modelVotes)/b.total-Math.abs(a.trophyVotes-a.modelVotes)/a.total||
  b.total-a.total||a.day.localeCompare(b.day)||a.puzzleId.localeCompare(b.puzzleId));
 const first=order(early)[0],second=order(later).find(r=>r.day!==first.day);
 if(!second)return null;
 const example=({puzzleId,...r})=>r;
 return {coverage:{decisions:valid.length,days:days.size,scheduledDays},
  early:stageStats(early),later:stageStats(later),examples:[example(first),example(second)]};
}

// Accept only a fresh, matching, reviewed 17Lands snapshot. The guide pipeline
// must acquire/review this separately; this function does not scrape live data.
export function guideGameOutcomes(guide,gate){
 const r=guide?.results;
 if(guide?.id!==gate.setId||guide?.guideStatus==='draft-unpublished'||!guide.reviewedAt||!r||
    r.format!=='PremierDraft'||r.userGroup!=='all'||r.period!=='ALL_TIME'||r.splashes!==false||
    ![2,3].includes(r.colorCount)||!Array.isArray(r.rows)||r.rows.length!==10)return null;
 let day,reviewed,url;
 try{day=iso(String(r.retrievedAt).slice(0,10));reviewed=iso(String(guide.reviewedAt).slice(0,10));url=new URL(r.sourceUrl);}catch{return null;}
 if(day<gate.start||day>gate.end||elapsed(day,gate.end)>GUIDE_GATES.maxSnapshotAge||
    reviewed<day||reviewed>gate.milestone||url.protocol!=='https:'||url.hostname!=='www.17lands.com'||
    url.searchParams.get('expansion')?.toLowerCase()!==gate.setId)return null;
 const seen=new Set();
 for(const x of r.rows){
  const color=typeof x.colors==='string'?[...x.colors].sort().join(''):'';
  if(color.length!==r.colorCount||!/^[BGRUW]+$/.test(color)||new Set(color).size!==color.length||seen.has(color)||
     !Number.isSafeInteger(x.wins)||!Number.isSafeInteger(x.games)||x.games<0||x.wins<0||x.wins>x.games)return null;
  seen.add(color);
 }
 const wins=r.rows.reduce((s,x)=>s+x.wins,0),games=r.rows.reduce((s,x)=>s+x.games,0);
 if(r.baseline?.wins!==wins||r.baseline?.games!==games||games===0)return null;
 const eligible=r.rows.filter(x=>x.games>=GUIDE_GATES.minGames);
 if(eligible.length<GUIDE_GATES.minColorCoverage)return null;
 return {retrievedOn:day,sourceUrl:url.href,colorCount:r.colorCount,baseline:{wins,games,pct:pct(wins,games)},
  rows:[...eligible].sort((a,b)=>b.wins/b.games-a.wins/a.games||a.colors.localeCompare(b.colors))
   .map(x=>({colors:x.colors,wins:x.wins,games:x.games,pct:pct(x.wins,x.games)}))};
}

export async function collectMidseasonGuide(query,{now=new Date(),plan,enabledFrom,guide}={}){
 const gate=await readMidseasonDue(query,plan,now,{enabledFrom});
 if(!gate)return null;
 const outcomes=guideGameOutcomes(guide,gate);
 if(!outcomes)return null;
 const count=elapsed(gate.start,gate.end)+1;
 const rows=[];
 // Reuse the approved first-answer, non-QA aggregation; never select raw
 // identities. Bound concurrency and don't query beyond the last completed day.
 for(let i=0;i<count;i+=4){
  const batch=await Promise.all(Array.from({length:Math.min(4,count-i)},(_,j)=>addDays(gate.start,i+j)).map(async day=>
   (await query(FEATURED_SQL,[day])).rows.filter(r=>r.environment==='latest'&&r.set_id===gate.setId)
    .map(r=>({...r,day,payload:asObject(r.payload),votes:asObject(r.votes)}))));
  rows.push(...batch.flat());
 }
 const decisions=summarizeGuideDecisions(rows,gate);
 if(!decisions)return null;
 // Draft only. No names, player identifiers, publication or approval implied.
 return {gate,article:{kind:gate.kind,start:gate.start,end:gate.end,seasonName:gate.name,decisions,outcomes},
  placements:[],editorialReviewRequired:true,...seasonPostMetadata(gate)};
}
