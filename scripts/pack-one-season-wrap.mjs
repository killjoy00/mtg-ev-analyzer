// Private read-only season aggregates. scores is the authoritative unique
// first-attempt Daily projection (player/date/environment/mode). Use the
// exact same owned-account, hidden-identity and corpus eligibility as boards.
// Never serialize player IDs or intermediate rows into a public article.
import {FORMATS,admitRows} from './pack-one-weekly-data.mjs';
const eligible="SELECT s.player_id,s.challenge_date,s.set_id AS environment,s.score,p.display_name FROM scores s JOIN players p ON p.id=s.player_id WHERE s.mode='draft_run' AND s.challenge_date BETWEEN $1::date AND $2::date AND s.set_id=ANY($3::text[]) AND s.details_json->>'corpus_version'=ANY($4::text[]) AND p.username_owned=true AND p.public_identity_hidden_at IS NULL AND EXISTS(SELECT 1 FROM account_links a WHERE a.player_id=s.player_id)";
export const SEASON_WRAP_SQL="WITH eligible AS ("+eligible+"), scheduled AS (SELECT day,environment FROM draft_run_schedules WHERE day BETWEEN $1::date AND $2::date AND environment=ANY($3::text[]) AND corpus_version=ANY($4::text[])), summary AS (SELECT count(DISTINCT player_id)::int players,count(*)::int completed,count(*) FILTER(WHERE score=100)::int perfect FROM eligible), formats AS (SELECT environment,count(DISTINCT player_id)::int players,count(*)::int completed,count(*) FILTER(WHERE score=100)::int perfect,round(avg(score),1) average_score FROM eligible GROUP BY environment), daily AS (SELECT environment,challenge_date::text AS day,count(*)::int completed,avg(score) mean FROM eligible GROUP BY environment,challenge_date HAVING count(*)>=25), toughest AS (SELECT DISTINCT ON(environment) environment,day,completed,round(mean,1) average_score FROM daily ORDER BY environment,mean,day), attendance AS (SELECT e.player_id,e.display_name,count(*)::int completed,count(s.day)::int matched FROM eligible e LEFT JOIN scheduled s ON s.day=e.challenge_date AND s.environment=e.environment GROUP BY e.player_id,e.display_name), ranked AS (SELECT *,rank() OVER(ORDER BY completed DESC) AS rank FROM attendance), leaders AS (SELECT player_id::text,display_name,completed,matched,rank FROM ranked WHERE rank=1 ORDER BY display_name,player_id LIMIT 1001) SELECT to_jsonb(summary) summary,(SELECT count(*)::int FROM scheduled) scheduled_count,coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY environment) FROM formats f),'[]'::jsonb) formats,coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY environment) FROM toughest t),'[]'::jsonb) toughest,coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY display_name,player_id) FROM leaders l),'[]'::jsonb) attendance FROM summary";
const decode=v=>typeof v==='string'?JSON.parse(v):v;
const integer=v=>{const n=Number(v);if(v==null||!Number.isSafeInteger(n)||n<0)throw Error('season-wrap-invalid-count');return n;};
const score=v=>{const n=Number(v);if(v==null||!Number.isFinite(n)||n<0||n>100)throw Error('season-wrap-invalid-score');return n;};
function totals(r){
 const players=integer(r.players),completed=integer(r.completed),perfect=integer(r.perfect);
 if(players>completed||perfect>completed)throw Error('season-wrap-invalid-totals');
 return {players,completed,perfect};
}
export async function collectSeasonWrap(query,params,placements,nameFor){
 const rows=(await query(SEASON_WRAP_SQL,params)).rows;
 if(rows.length!==1)throw Error('season-wrap-aggregate-missing');
 const raw=rows[0],summary=totals(decode(raw.summary)),scheduled=integer(raw.scheduled_count);
 const byFormat=decode(raw.formats),hard=decode(raw.toughest),attendance=decode(raw.attendance);
 if(![byFormat,hard,attendance].every(Array.isArray)||attendance.length>=1001||
    byFormat.some(r=>!FORMATS.includes(r.environment))||new Set(byFormat.map(r=>r.environment)).size!==byFormat.length||
    hard.some(r=>!FORMATS.includes(r.environment)||!/^\d{4}-\d{2}-\d{2}$/.test(r.day)||r.day<params[0]||r.day>params[1]||integer(r.completed)<25)||
    new Set(hard.map(r=>r.environment)).size!==hard.length)throw Error('season-wrap-invalid-aggregate');
 const formats=FORMATS.map(environment=>{
  const row=byFormat.find(r=>r.environment===environment);
  return {environment,...(row?{...totals(row),average:score(row.average_score)}:{players:0,completed:0,perfect:0,average:null})};
 });
 if(formats.reduce((s,r)=>s+r.completed,0)!==summary.completed||formats.reduce((s,r)=>s+r.perfect,0)!==summary.perfect||
    formats.some(r=>r.players>summary.players))throw Error('season-wrap-inconsistent-totals');
 if(attendance.some(r=>Number(r.rank)!==1||integer(r.completed)<1||integer(r.matched)>integer(r.completed)||
    integer(r.completed)>summary.completed)||(!attendance.length&&summary.completed>0))throw Error('season-wrap-invalid-attendance');
 const max=attendance.length?integer(attendance[0].completed):0;
 if(attendance.some(r=>integer(r.completed)!==max))throw Error('season-wrap-invalid-attendance-tie');
 const names=await admitRows(query,attendance.map(r=>({...r,score:100,average_score:100,days:integer(r.completed)})),placements,nameFor);
 // Perfect attendance requires a positive authoritative denominator and
 // every recorded completion matched to a real, eligible schedule.
 const leaders=attendance.map((r,i)=>({name:names[i].name,completed:integer(r.completed),everyDaily:scheduled>0&&integer(r.completed)===scheduled&&integer(r.matched)===scheduled}));
 return {summary,formats,scheduled,attendance:leaders,toughest:FORMATS.flatMap(environment=>hard.filter(r=>r.environment===environment).map(r=>({environment,day:r.day,completed:integer(r.completed),average:score(r.average_score)})))};
}
export function championshipRace(raw,publicRows){
 if(!raw.length)return null;
 const winners=publicRows.filter(r=>r.rank===1).map(r=>r.name);
 if(!winners.length)return null;
 const first=raw[0],runner=raw.find(r=>r.rank>1);
 const difference=winners.length>1?0:runner?Number(first.rating)-Number(runner.rating):null;
 if(difference!==null&&(!Number.isFinite(difference)||difference<0))throw Error('season-wrap-invalid-margin');
 return {winners,margin:difference===null?null:Number(difference.toFixed(4)),average:publicRows[0].average_score,days:publicRows[0].days};
}
export async function allFormatFinishers(query,rawBoards,placements,nameFor){
 if(rawBoards.length!==FORMATS.length)return [];
 const matches=rawBoards[0].rows.filter(r=>r.rank<=5&&rawBoards.slice(1).every(b=>b.rows.some(x=>x.player_id===r.player_id&&x.rank<=5)));
 const admitted=await admitRows(query,matches,placements,nameFor);
 // Avoid correlating anonymized rankings across multiple formats.
 return matches.flatMap((r,i)=>admitted[i].name==='Anonymous player'?[]:[{name:admitted[i].name,ranks:rawBoards.map(b=>({environment:b.environment,rank:b.rows.find(x=>x.player_id===r.player_id).rank}))}]);
}
