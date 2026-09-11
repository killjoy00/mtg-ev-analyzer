import corpusCatalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import growth, { query, player, readJson, json, withCors, gameDateKey } from './growth-function.js';
import { loadVerifiedPool } from './draft-run-pool.mjs';
import {
  DRAFT_RUN_CORPUS_VERSION, DRAFT_RUN_SCORING_VERSION, gradeDraftRunPick,
  selectDraftRun, selectDraftRunReroll, publicDraftRunPuzzle, validateDraftRunPuzzle, draftRunEnvironment, poolForEnvironment,
} from '../draft-run.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let poolCache = null, poolLoading = null;
const environmentOf = s => s.environment || 'mixed';
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };

async function pool() {
  if (poolCache && Date.now()-poolCache.at<300000) return poolCache.rows;
  if(!poolLoading)poolLoading=loadPool().finally(()=>{poolLoading=null;});
  return poolLoading;
}

async function loadPool() {
  const rows=await loadVerifiedPool(query,DRAFT_RUN_CORPUS_VERSION);
  const actualSets=new Set(rows.map(p=>p.set_id));
  if(corpusCatalog.corpus_version!==DRAFT_RUN_CORPUS_VERSION || corpusCatalog.sets.some(s=>!actualSets.has(s.id)) || actualSets.size!==corpusCatalog.sets.length) fail('Verified environment coverage is incomplete.',503);
  if(rows.length<100) fail('Verified puzzles are temporarily unavailable.',503);
  poolCache={at:Date.now(),rows};
  return rows;
}

async function puzzle(id) {
  const r=await query('SELECT payload FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[id]);
  const p=r.rows[0] ? parse(r.rows[0].payload) : null;
  if(!validateDraftRunPuzzle(p)) fail('This puzzle failed its data-quality check.',503);
  return p;
}

function decode(row) {
  return {...row,revision:Number(row.revision),puzzle_ids:parse(row.puzzle_ids),answers:parse(row.answers),rerolls:parse(row.rerolls),seen_sources:parse(row.seen_sources),score:row.score==null?null:Number(row.score)};
}

async function session(id,owner) {
  if(!UUID.test(id)) fail('Invalid run.');
  const r=await query('SELECT * FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid',[id,owner]);
  if(!r.rows[0]) fail('Run not found.',404);
  return decode(r.rows[0]);
}

async function share(id) {
  if(!/^[a-f0-9]{24}$/.test(id||'')) fail('Invalid challenge.');
  const r=await query('SELECT sh.id,sh.display_name,sh.score,sh.puzzle_ids,s.environment FROM draft_run_shares sh JOIN draft_run_sessions s ON s.id=sh.session_id WHERE sh.id=$1',[id]);
  if(!r.rows[0]) fail('Challenge not found.',404);
  return {...r.rows[0],score:Number(r.rows[0].score),puzzle_ids:parse(r.rows[0].puzzle_ids)};
}

async function persistResult(s) {
  if(s.answers.length!==10) return;
  const score=Math.round(s.answers.reduce((n,a)=>n+a.score,0)/10);
  const grade=score>=90?'A':score>=80?'B':score>=65?'C':score>=50?'D':'F';
  const other=s.challenge_id ? await share(s.challenge_id) : null;
  const exact=other && JSON.stringify(other.puzzle_ids)===JSON.stringify(s.puzzle_ids);
  const outcome=exact ? score>other.score?'win':score<other.score?'loss':'tie' : null;
  const sets=[...new Set(s.answers.map(a=>a.puzzle.set_id))].map(id=>({set_id:id,score:Math.round(s.answers.filter(a=>a.puzzle.set_id===id).reduce((n,a)=>n+a.score,0)/s.answers.filter(a=>a.puzzle.set_id===id).length)}));
  // The unique result key makes completion retryable after a dropped response.
  // All career, environment, ranked, and funnel writes commit together.
  await query(`WITH ranked AS (
    INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json,details_json,is_featured)
    SELECT $1::uuid,$2::date,$16,'draft_run',$3::int,$4,$5::jsonb,$6::jsonb,true WHERE $2::date IS NOT NULL
    ON CONFLICT(player_id,challenge_date,set_id,mode) DO NOTHING
  ), result AS (
    INSERT INTO game_results(player_id,set_id,mode,score,grade,seed,is_daily,challenge_id,opponent_name,opponent_score,outcome,client_result_id)
    VALUES($1::uuid,$16,'draft_run',$3::int,$4,$7,$2::date IS NOT NULL,$8,$9,$10::int,$11,$12)
    ON CONFLICT(player_id,client_result_id) DO NOTHING RETURNING id
  ), environments AS (
    INSERT INTO game_result_environments(game_result_id,set_id,score)
    SELECT r.id,e.set_id,e.score FROM result r CROSS JOIN jsonb_to_recordset($13::jsonb) e(set_id text,score smallint)
    ON CONFLICT DO NOTHING
  ) INSERT INTO analytics_events(player_id,event_name,event_props)
    SELECT $1::uuid,event_name,$14::jsonb FROM result CROSS JOIN jsonb_array_elements_text($15::jsonb) n(event_name)`,
  [s.player_id,s.day,score,grade,JSON.stringify(s.answers.map(a=>a.selectedId)),JSON.stringify({run:s.id,scoring_version:s.scoring_version,historical_matches:s.answers.filter(a=>a.historicalMatch).length}),s.seed,s.challenge_id,exact?other.display_name:null,exact?other.score:null,outcome,`draft-run:${s.id}`,JSON.stringify(sets),JSON.stringify({mode:'draft_run',set_id:environmentOf(s),daily:Boolean(s.day),score,run_id:s.id,challenge:Boolean(other),outcome}),JSON.stringify(['game_completed',...(environmentOf(s)==='powered-cube'?['cube_completed']:[]),...(s.day?['daily_completed']:[]),...(exact?['challenge_complete']:[])]) ,environmentOf(s)]);
}

async function responseFor(s) {
  const complete=s.answers.length===10;
  if(complete) await persistResult(s);
  const current=complete ? null : publicDraftRunPuzzle(await puzzle(s.puzzle_ids[s.answers.length]));
  const other=s.challenge_id ? await share(s.challenge_id) : null;
  const comparison=other ? {name:other.display_name,score:other.score,exact:JSON.stringify(other.puzzle_ids)===JSON.stringify(s.puzzle_ids)} : null;
  let standing=null;
  if(complete && s.day) {
    const r=await query(`SELECT count(*) total,1+count(*) FILTER(WHERE score>$2::int) rank,count(*) FILTER(WHERE score>=$2::int) through_ties FROM scores WHERE challenge_date=$1::date AND mode='draft_run' AND set_id=$3`,[s.day,s.score,environmentOf(s)]);
    const row=r.rows[0],total=Number(row.total);
    standing={rank:Number(row.rank),total,percentile:total>=10?Math.max(1,Math.ceil(Number(row.through_ties)/total*100)):null,final:s.day<gameDateKey()};
  }
  return {id:s.id,environment:environmentOf(s),day:s.day,revision:s.revision,round:s.answers.length+1,complete,score:s.score,answers:s.answers,rerolls:s.rerolls,current,comparison,standing,scoring_version:s.scoring_version};
}

async function start(request) {
  const owner=await player(request),body=await readJson(request),daily=body.daily===true;
  const source=body.challenge ? await share(String(body.challenge)) : null;
  if(source && daily) fail('A friend challenge is a separate practice run.');
  let environment;
  try { environment=draftRunEnvironment(source?.environment || body.environment || 'mixed'); }
  catch { fail('Invalid Draft Run environment.'); }
  const day=daily?gameDateKey():null;
  if(day) {
    const old=await query('SELECT * FROM draft_run_sessions WHERE player_id=$1::uuid AND day=$2::date AND environment=$3',[owner,day,environment]);
    if(old.rows[0]) return json(await responseFor(decode(old.rows[0])));
  }
  const choices=poolForEnvironment(await pool(),environment);
  const seed=day ? `daily:${environment}:${day}:${DRAFT_RUN_CORPUS_VERSION}` : crypto.randomUUID();
  let ids;
  if(source) ids=source.puzzle_ids;
  else if(day) {
    const plan=selectDraftRun(choices,seed,environment).map(p=>p.puzzle_id);
    await query('INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids) VALUES($1::date,$2,$3,$4::jsonb) ON CONFLICT(day,environment) DO NOTHING',[day,environment,DRAFT_RUN_CORPUS_VERSION,JSON.stringify(plan)]);
    const r=await query('SELECT puzzle_ids FROM draft_run_schedules WHERE day=$1::date AND environment=$2',[day,environment]);
    ids=parse(r.rows[0].puzzle_ids);
  } else ids=selectDraftRun(choices,seed,environment).map(p=>p.puzzle_id);
  const sources=ids.map(id=>choices.find(p=>p.puzzle_id===id)?.source_draft_hash);
  if(sources.some(s=>!s)) fail('This challenge uses an unavailable corpus.',409);
  const rerolls=environment==='powered-cube'?{set:0,pack:2}:{set:1,pack:1};
  const inserted=await query(`INSERT INTO draft_run_sessions(player_id,day,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,challenge_id,environment,rerolls)
    VALUES($1::uuid,$2::date,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING RETURNING *`,[owner,day,seed,DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION,JSON.stringify(ids),JSON.stringify(sources),source?.id||null,environment,JSON.stringify(rerolls)]);
  let s=inserted.rows[0];
  if(!s && day) s=(await query('SELECT * FROM draft_run_sessions WHERE player_id=$1::uuid AND day=$2::date AND environment=$3',[owner,day,environment])).rows[0];
  if(!s) fail('Could not start your run. Please retry.',409);
  if(inserted.rows.length) await query('INSERT INTO analytics_events(player_id,event_name,event_props) SELECT $1::uuid,value,$3::jsonb FROM jsonb_array_elements_text($2::jsonb)',[owner,JSON.stringify([day?'daily_started':'game_started',...(environment==='powered-cube'?['cube_started']:[])]),JSON.stringify({mode:'draft_run',set_id:environment,daily,challenge:Boolean(source),run_id:s.id})]);
  return json(await responseFor(decode(s)));
}

async function change(request,id,action) {
  const owner=await player(request),body=await readJson(request),s=await session(id,owner);
  const round=Number(body.round);
  // Exact retry of a committed answer is safe; changing it never is.
  if(action==='pick' && Number.isInteger(round) && s.answers[round]?.selectedId===body.cardId && s.answers[round]?.puzzle.puzzle_id===body.puzzleId) return json(await responseFor(s));
  if(s.answers.length>=10) fail('This run is complete.',409);
  if(s.day && s.day!==gameDateKey()) fail('This Daily has closed. Start today’s run.',410);
  if(s.revision!==body.revision || round!==s.answers.length || body.puzzleId!==s.puzzle_ids[round]) fail('Your run changed in another tab. Reload to continue.',409);
  if(action==='pick') {
    const p=await puzzle(body.puzzleId);
    if(!p.candidates.some(c=>c.id===body.cardId)) fail('Choose a card from this pack.');
    const grade=gradeDraftRunPick(p,body.cardId);
    s.answers.push({...grade,puzzle:publicDraftRunPuzzle(p),ranking:[...p.candidates].sort((a,b)=>b.model_probability-a.model_probability).map(c=>({id:c.id,name:c.name,support:c.model_probability,score:gradeDraftRunPick(p,c.id).score}))});
    if(s.answers.length===10) s.score=Math.round(s.answers.reduce((n,a)=>n+a.score,0)/10);
  } else {
    const type=body.type;
    if(!['set','pack'].includes(type)) fail('Invalid reroll.');
    if(environmentOf(s)==='powered-cube' && type==='set') fail('Powered Cube has two pack rerolls and no set reroll.');
    if(!Number.isInteger(s.rerolls[type]) || s.rerolls[type]<1) fail('That reroll has already been used.',409);
    const choices=await pool(),current=choices.find(p=>p.puzzle_id===body.puzzleId);
    if(!current) fail('This puzzle is unavailable.',503);
    const replacement=selectDraftRunReroll(choices,current,{type,round,seed:s.seed,excludedSources:s.seen_sources,environment:environmentOf(s)});
    if(!replacement) fail('No comparable replacement is available. Your reroll is still yours.',409);
    s.puzzle_ids[round]=replacement.puzzle_id;s.seen_sources.push(replacement.source_draft_hash);s.rerolls[type]-=1;
  }
  const updated=await query(`UPDATE draft_run_sessions SET puzzle_ids=$3::jsonb,answers=$4::jsonb,rerolls=$5::jsonb,seen_sources=$6::jsonb,score=$7::int,revision=revision+1,updated_at=now() WHERE id=$1::uuid AND revision=$2::int AND player_id=$8::uuid RETURNING *`,[id,s.revision,JSON.stringify(s.puzzle_ids),JSON.stringify(s.answers),JSON.stringify(s.rerolls),JSON.stringify(s.seen_sources),s.score,owner]);
  if(!updated.rows[0]) fail('Your run changed in another tab. Reload to continue.',409);
  return json(await responseFor(decode(updated.rows[0])));
}

async function createShare(request,id) {
  const owner=await player(request),s=await session(id,owner);
  if(s.answers.length!==10) fail('Finish the run before challenging a friend.');
  const name=(await query('SELECT display_name FROM players WHERE id=$1::uuid',[owner])).rows[0]?.display_name||'A friend';
  const key=crypto.randomUUID().replaceAll('-','').slice(0,24);
  const r=await query(`INSERT INTO draft_run_shares(id,session_id,display_name,score,puzzle_ids) VALUES($1,$2::uuid,$3,$4::int,$5::jsonb) ON CONFLICT(session_id) DO UPDATE SET session_id=EXCLUDED.session_id RETURNING id`,[key,id,name,s.score,JSON.stringify(s.puzzle_ids)]);
  return json({id:r.rows[0].id});
}

async function leaderboard(request) {
  const url=new URL(request.url),period=url.searchParams.get('period')||'daily';
  if(!['daily','week','month','all'].includes(period)) fail('Invalid leaderboard period.');
  let environment;try{environment=draftRunEnvironment(url.searchParams.get('environment')||'mixed');}catch{fail('Invalid Draft Run environment.');}
  const today=gameDateKey();
  const start=period==='daily'?today:period==='month'?today.slice(0,8)+'01':period==='week'?(()=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);})():'2000-01-01';
  const r=await query(`WITH results AS (
    SELECT player_id,round(avg(score),1) score,count(*) days FROM scores WHERE mode='draft_run' AND set_id=$3 AND challenge_date BETWEEN $1::date AND $2::date GROUP BY player_id
  ) SELECT rank() OVER(ORDER BY r.score DESC) rank,r.score,r.days,p.display_name,CASE WHEN p.profile_public AND
      (SELECT count(*) FROM players x WHERE x.profile_public AND lower(x.display_name)=lower(p.display_name))=1 THEN p.profile_key END profile_key
    FROM results r JOIN players p ON p.id=r.player_id ORDER BY r.score DESC,r.days DESC,p.display_name LIMIT 100`,[start,today,environment]);
  return json({period,environment,start,today,rows:r.rows.map(r=>({...r,rank:Number(r.rank),score:Number(r.score),days:Number(r.days)}))});
}

async function route(request) {
  const url=new URL(request.url),path=url.pathname;
  if(request.method==='OPTIONS') return new Response(null,{status:204});
  if(request.method==='GET'&&path==='/health') { const p=await pool();return json({ok:true,service:'draft-run',scoring_version:DRAFT_RUN_SCORING_VERSION,corpus_version:DRAFT_RUN_CORPUS_VERSION,puzzles:p.length,sets:new Set(p.map(p=>p.set_id)).size,expansion_sets:new Set(poolForEnvironment(p).map(p=>p.set_id)).size,cube_puzzles:poolForEnvironment(p,'powered-cube').length}); }
  if(request.method==='POST'&&path==='/v1/session') return growth.fetch(request);
  if(request.method==='POST'&&path==='/v1/runs') return start(request);
  if(request.method==='GET'&&path==='/v1/leaderboard') return leaderboard(request);
  const match=path.match(/^\/v1\/runs\/([a-f0-9-]+)(?:\/(pick|reroll|share))?$/);
  if(match) {
    if(request.method==='GET'&&!match[2]) return json(await responseFor(await session(match[1],await player(request))));
    if(request.method==='POST'&&match[2]==='share') return createShare(request,match[1]);
    if(request.method==='POST'&&['pick','reroll'].includes(match[2])) return change(request,match[1],match[2]);
  }
  const shared=path.match(/^\/v1\/challenges\/([a-f0-9]+)$/);
  if(request.method==='GET'&&shared) { const s=await share(shared[1]);return json({id:s.id,name:s.display_name,score:s.score,environment:s.environment}); }
  return json({error:'Not found.'},404);
}

export default {async fetch(request) {
  try {const response=await route(request);response.headers.set('cache-control','no-store');return withCors(response,request);}
  catch(error) {const status=Number(error.status)||500;if(status===500) console.error('Draft Run request failed',error.message);return withCors(json({error:status===500?'Could not save your run. Please retry.':error.message},status),request);}
}};
