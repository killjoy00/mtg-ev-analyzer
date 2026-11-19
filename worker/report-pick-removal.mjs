import {gradeDraftRunPickForVersion} from '../draft-run.mjs';
import {readServingReadiness} from './corpus-readiness.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const parse=x=>typeof x==='string'?JSON.parse(x):x;

export async function reportedPickContext(query,id) {
 const row=(await query(`SELECT r.puzzle_id,r.selected_card_id,r.scoring_version,p.payload,
  q.decision_key,q.removed,q.revision,q.reason,q.updated_at,
  (SELECT count(*)::int FROM draft_run_pick_removal_members m WHERE m.decision_key=q.decision_key) copies,
  (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.revision DESC),'[]') FROM
   (SELECT revision,removed,reason,report_id,actor_id,created_at FROM draft_run_pick_removal_events
    WHERE decision_key=q.decision_key ORDER BY revision DESC LIMIT 50) e) history
 FROM draft_run_decision_reports r LEFT JOIN draft_run_verified_puzzles p ON p.puzzle_id=r.puzzle_id
 LEFT JOIN draft_run_pick_removals q ON q.decision_key=pack1_decision_identity(p.payload)
 WHERE r.id=$1::uuid`,[id])).rows[0];
 if(!row)fail('Report was not found.',404);
 if(!row.payload)return {available:false,puzzle_id:row.puzzle_id,message:'The original pick payload is unavailable. Removal is disabled.'};
 const puzzle=parse(row.payload);
 const ranking=puzzle.candidates.map(card=>({...card,score:gradeDraftRunPickForVersion(puzzle,card.id,row.scoring_version).score}))
  .sort((a,b)=>Number(b.model_probability)-Number(a.model_probability)||a.id.localeCompare(b.id));
 return {available:true,puzzle,ranking,selected_card_id:row.selected_card_id,
  moderation:{removed:row.removed===true||row.removed==='t',revision:Number(row.revision||0),reason:row.reason||null,
   updated_at:row.updated_at||null,copies:Number(row.copies||0),history:parse(row.history)||[]},
  readiness:await readServingReadiness(query).catch(()=>({ready:false,state:'unavailable'}))};
}

export async function moderateReportedPick(query,id,body,actor) {
 if(!['remove','restore'].includes(body.action)||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)
  fail('Choose remove or restore with the current pick revision.');
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(!reason||reason.length>500)fail('Enter a reason of 1–500 characters.');
 let result;
 try {
  const row=(await query('SELECT pack1_moderate_reported_pick($1::uuid,$2::boolean,$3::integer,$4,$5::uuid) result',
   [id,body.action==='remove',body.expected_revision,reason,actor])).rows[0];
  result=parse(row.result);
 } catch(error) {
  const code=String(error.pgCode||error.code||'');
  if(code==='40001')fail('Pick inventory or moderation changed. Refresh the pick and retry.',409);
  if(code==='P0002')fail('The reported pick is unavailable.',404);
  throw error;
 }
 let readiness;
 readiness=await readServingReadiness(query).catch(()=>({ready:false,state:'unavailable'}));
 return {ok:true,moderation_committed:true,moderation:result,readiness};
}
