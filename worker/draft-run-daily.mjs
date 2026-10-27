import {SERVING_POLICY_VERSION} from '../serving-quality.mjs';
import {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION} from '../draft-run.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {decisionKey,loadLiveSetMetadata,selectDatabaseRun} from './draft-run-selection.mjs';

export const DAILY_SCHEDULE_SELECT='SELECT puzzle_ids,corpus_version,scoring_version,difficulty_version,selection_version,daily_featured_sets,serving_policy_version FROM draft_run_schedules WHERE day=$1::date AND environment=$2';

const unavailable=message=>Object.assign(new Error(message),{status:503});

// A Daily never repeats an exact decision scheduled by any Daily in the last
// 28 days, nor reuses a source draft scheduled in the last 7 days. Days are
// inclusive of today, so other environments already generated today count.
export const DAILY_REPEAT_WINDOW_DAYS=Object.freeze({decision:28,source:7});
export const RECENT_DAILY_DECISIONS=`SELECT DISTINCT p.source_draft_hash,p.pick_number,(s.day>=$1::date-$3::int) recent_source
  FROM draft_run_schedules s
  CROSS JOIN LATERAL jsonb_array_elements_text(s.puzzle_ids) scheduled(puzzle_id)
  JOIN draft_run_verified_puzzles p ON p.puzzle_id=scheduled.puzzle_id
  WHERE s.day BETWEEN $1::date-$2::int AND $1::date`;

export function dailyRepeatExclusion(rows) {
  const decisions=new Set(),sources=new Set();
  for(const row of rows) {
    decisions.add(decisionKey(row));
    if(row.recent_source===true||row.recent_source==='t')sources.add(row.source_draft_hash);
  }
  return {sources:[...sources].sort(),decisions:[...decisions].sort()};
}

// A small new set may be unable to honour both windows. Relax the source
// window first, then the decision window, rather than publish no Daily.
export function dailyRepeatTiers(exclusion) {
  return [
    {tier:'decision_and_source',exclude:exclusion},
    {tier:'decision_only',exclude:{sources:[],decisions:exclusion.decisions}},
    {tier:'none',exclude:null},
  ];
}

export async function selectDailyWithoutRepeats(select,exclusion,{environment,day,warn=console.warn}={}) {
  const tiers=dailyRepeatTiers(exclusion);
  for(let i=0;i<tiers.length;i++) {
    try {
      const selected=await select(tiers[i].exclude);
      if(i)warn('Daily repeat exclusion relaxed',JSON.stringify({environment,day,tier:tiers[i].tier}));
      return selected;
    } catch(error) {
      if(Number(error?.status)!==503||i===tiers.length-1)throw error;
    }
  }
}

async function buildDailySchedule(query,day,environment) {
  let schedule=(await query(DAILY_SCHEDULE_SELECT,[day,environment])).rows[0];
  if(schedule)return {schedule,created:false};
  let featuredSets=environment!=='powered-cube'
    ?(await loadLiveSetMetadata(query,DRAFT_RUN_CORPUS_VERSION))
      .filter(p=>p.regular_run&&p.release_date&&p.release_date<=day)
      .sort((a,b)=>b.release_date.localeCompare(a.release_date)||a.set_id.localeCompare(b.set_id))
      .slice(0,environment==='latest'?1:4).map(p=>p.set_id)
    :[];
  const seed=`daily:${environment}:${day}:${DRAFT_RUN_CORPUS_VERSION}:${DRAFT_RUN_SELECTION_VERSION}`;
  const recent=(await query(RECENT_DAILY_DECISIONS,[day,DAILY_REPEAT_WINDOW_DAYS.decision-1,DAILY_REPEAT_WINDOW_DAYS.source-1])).rows;
  // The tier that succeeds runs last, so its rule is the one recorded.
  const report={selectionRule:null};
  const selected=await selectDailyWithoutRepeats(
    exclude=>selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,environment,{daily:true,day,exclude,report}),
    dailyRepeatExclusion(recent),{environment,day});
  if(!selected.length)throw unavailable('Daily schedule unavailable.');
  const plan=selected.map(p=>p.puzzle_id);
  if(environment==='latest')featuredSets=[selected[0].set_id];
  const inserted=await query(
    'INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,difficulty_version,selection_version,daily_featured_sets,scoring_version,serving_policy_version,selection_rule) VALUES($1::date,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10) ON CONFLICT(day,environment) DO NOTHING RETURNING day',
    [day,environment,DRAFT_RUN_CORPUS_VERSION,JSON.stringify(plan),DRAFT_RUN_DIFFICULTY_VERSION,DRAFT_RUN_SELECTION_VERSION,JSON.stringify(featuredSets),DRAFT_RUN_SCORING_VERSION,SERVING_POLICY_VERSION,report.selectionRule],
  );
  schedule=(await query(DAILY_SCHEDULE_SELECT,[day,environment])).rows[0];
  if(!schedule)throw unavailable('Daily schedule unavailable.');
  return {schedule,created:Boolean(inserted.rows.length)};
}

// Coalesce only overlapping work on the same database adapter. The database
// (day, environment) key remains authoritative across processes; completed
// requests are never cached, and each caller receives its own schedule object.
export function createDailyScheduleEnsurer(build=buildDailySchedule) {
  const adapters=new WeakMap();
  return async function ensure(query,day,environment) {
    let pending=adapters.get(query);
    if(!pending){pending=new Map();adapters.set(query,pending);}
    const key=JSON.stringify([day,environment]),existing=pending.get(key);
    if(existing) {
      const result=await existing;
      return {schedule:structuredClone(result.schedule),created:false};
    }
    const work=Promise.resolve().then(()=>build(query,day,environment));
    pending.set(key,work);
    try {
      const result=await work;
      return {schedule:structuredClone(result.schedule),created:result.created};
    } finally {
      if(pending.get(key)===work)pending.delete(key);
      if(!pending.size)adapters.delete(query);
    }
  };
}
const sharedDailyScheduleEnsurer=createDailyScheduleEnsurer();
export async function ensureDailySchedule(query,day,environment) {
  return sharedDailyScheduleEnsurer(query,day,environment);
}
