// No model API calls. Separate ChatGPT tasks provide copy and an exact-hash
// editorial verdict; the trusted runner assembles, validates and saves articles.
import {articleHash} from '../worker/lab-editorial.mjs';
import {assembleArticle,writerRequest,reviewerRequest} from '../worker/lab-writer.mjs';
import {labPost} from '../lab-patreon-contract.mjs';

export const PENDING=Symbol('awaiting-chatgpt');
const fail=code=>{throw Error('lab-task-'+code);};
const hash=v=>articleHash(v);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>hash(a)===hash(b);
const validResponse=(v,digest)=>obj(v)&&Object.keys(v).sort().join(',')==='feedback,review_hash,verdict'&&v.review_hash===digest&&['pass','revise'].includes(v.verdict)&&typeof v.feedback==='string'&&v.feedback.length<=1500;
const revisionMessage=error=>['lab-missing-feature-investigation','lab-feature-development'].includes(error?.message)
  ?'Develop both independent findings in at least four paragraphs. Compare every required primary, follow-up and extra metric using the supplied tokens. Explain the change and the practical drafting decision, not just the chart.'
  :['lab-missing-follow-up','lab-missing-matched-follow-up'].includes(error?.message)
  ?'Compare the required repeat-pick and follow-up rates using the supplied stat tokens in prose. Distinguish game outcomes from trophy deck retention and explain the limits.'
  :error?.message==='lab-publication-invalid'
    ?'Keep required facts and limitations but shorten the prose so the native publisher can carry it without truncation.'
    :'Use exactly the required fields, supplied stat tokens, prose limits and natural language. Do not add unsupported numbers, links, repeated paragraphs or authorial plural.';

// The job identity binds the exact week, revision, topic, evidence, instructions,
// and attempt. Neither task has permission to update those values or the queue.
export async function taskArticle(query,{scope='weekly',week,revision,packet,feedback=''}){
  if(!['weekly','samples'].includes(scope)||!/^\d{4}-\d{2}-\d{2}$/.test(week)||!Number.isSafeInteger(revision)||revision<0||!packet?.id)fail('identity');
  let notes=String(feedback).slice(0,1500);
  const packetHash=hash(packet);
  for(let attempt=1;attempt<=3;attempt++){
    const key=[scope,week,revision,packet.id,attempt];
    const request={...writerRequest(packet,notes),packet_hash:packetHash};
    const requestHash=hash({scope,week,revision,candidate_id:packet.id,attempt,request});
    const row=(await query(`SELECT request_json,request_hash,writer_copy,review_input,review_hash,review_response
      FROM public.pack1_lab_task_jobs WHERE scope=$1 AND week_key=$2::date AND revision=$3 AND candidate_id=$4 AND attempt=$5`,key)).rows[0];
    if(!row){
      await query(`INSERT INTO public.pack1_lab_task_jobs(scope,week_key,revision,candidate_id,attempt,request_json,request_hash)
        VALUES($1,$2::date,$3,$4,$5,$6::jsonb,$7)
        ON CONFLICT(scope,week_key,revision,candidate_id,attempt) DO NOTHING`,[...key,JSON.stringify(request),requestHash]);
      return PENDING;
    }
    if(row.request_hash!==requestHash||!same(row.request_json,request))fail('request-integrity');
    if(row.writer_copy==null)return PENDING;
    let article;
    try{article=assembleArticle(packet,row.writer_copy);labPost(article);}
    catch(error){
      if(row.review_input!=null||row.review_hash!=null||row.review_response!=null)fail('invalid-reviewed-copy');
      notes=revisionMessage(error);
      continue;
    }
    const reviewInput=reviewerRequest(packet,article);
    const reviewHash=hash({request_hash:requestHash,writer_copy:row.writer_copy,article});
    if(row.review_input==null){
      if(row.review_hash!=null||row.review_response!=null)fail('review-state');
      await query(`UPDATE public.pack1_lab_task_jobs SET review_input=$8::jsonb,review_hash=$9
        WHERE scope=$1 AND week_key=$2::date AND revision=$3 AND candidate_id=$4 AND attempt=$5 AND request_hash=$6
          AND writer_copy=$7::jsonb AND review_input IS NULL AND review_response IS NULL`,[...key,requestHash,JSON.stringify(row.writer_copy),JSON.stringify(reviewInput),reviewHash]);
      return PENDING;
    }
    if(row.review_hash!==reviewHash||!same(row.review_input,reviewInput))fail('review-integrity');
    if(row.review_response==null)return PENDING;
    if(!validResponse(row.review_response,reviewHash))fail('review-response');
    if(row.review_response.verdict==='pass')return article;
    notes=row.review_response.feedback||'Revise the article; the previous draft did not pass editorial review.';
  }
  return null; // Exhausted three actual attempts; never pretend a pending task rejected a topic.
}
