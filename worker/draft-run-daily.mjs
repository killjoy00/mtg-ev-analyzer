import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {loadLiveSetMetadata,selectDatabaseRun} from './draft-run-selection.mjs';

export const DAILY_SCHEDULE_SELECT='SELECT puzzle_ids,corpus_version,scoring_version,difficulty_version,selection_version,daily_featured_sets,serving_policy_version FROM draft_run_schedules WHERE day=$1::date AND environment=$2';

const unavailable=message=>Object.assign(new Error(message),{status:503});

export async function ensureDailySchedule(query,day,environment) {
  let schedule=(await query(DAILY_SCHEDULE_SELECT,[day,environment])).rows[0];
  if(schedule)return {schedule,created:false};
  let featuredSets=environment!=='powered-cube'
    ?(await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION))
      .filter(p=>p.regular_run&&p.release_date&&p.release_date<=day)
      .sort((a,b)=>b.release_date.localeCompare(a.release_date)||a.set_id.localeCompare(b.set_id))
      .slice(0,environment==='latest'?1:4).map(p=>p.set_id)
    :[];
  const seed=`daily:${environment}:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
  const selected=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,environment,{daily:true,day});
  if(!selected.length)throw unavailable('Daily schedule unavailable.');
  const plan=selected.map(p=>p.puzzle_id);
  if(environment==='latest')featuredSets=[selected[0].set_id];
  const inserted=await query(
    'INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,difficulty_version,selection_version,daily_featured_sets,scoring_version,serving_policy_version) VALUES($1::date,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9) ON CONFLICT(day,environment) DO NOTHING RETURNING day',
    [day,environment,DRAFT_RUN_CORPUS_VERSION,JSON.stringify(plan),DRAFT_RUN_DIFFICULTY_VERSION,DRAFT_RUN_SELECTION_VERSION,JSON.stringify(featuredSets),DRAFT_RUN_SCORING_VERSION,SERVING_POLICY_VERSION],
  );
  schedule=(await query(DAILY_SCHEDULE_SELECT,[day,environment])).rows[0];
  if(!schedule)throw unavailable('Daily schedule unavailable.');
  return {schedule,created:Boolean(inserted.rows.length)};
}
