import {COVERAGE_ISSUE_NUMBER,COVERAGE_ISSUE_TITLE,STALE_COVERAGE_MS,STEP_MS,parseCoverageState} from '../launch-monitoring.mjs';

const ISSUE_URL=`https://api.github.com/repos/killjoy00/mtg-ev-analyzer/issues/${COVERAGE_ISSUE_NUMBER}`;

export async function inspectLaunchCoverageFreshness({fetcher=fetch,now=Date.now()}={}) {
  const response=await fetcher(ISSUE_URL,{
    headers:{accept:'application/vnd.github+json','user-agent':'pack-one-launch-coverage-watch'},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)return {ok:false,reason:'coverage_state_unavailable',status:response.status,max_age_minutes:STALE_COVERAGE_MS/60000};
  const issue=await response.json().catch(()=>null);
  if(issue?.number!==COVERAGE_ISSUE_NUMBER||issue?.title!==COVERAGE_ISSUE_TITLE)
    return {ok:false,reason:'coverage_state_mismatch',max_age_minutes:STALE_COVERAGE_MS/60000};
  let state;
  try {state=parseCoverageState(issue.body);} catch {return {ok:false,reason:'coverage_state_invalid',max_age_minutes:STALE_COVERAGE_MS/60000};}
  if(!state.covered_through)return {ok:false,reason:'coverage_not_initialized',max_age_minutes:STALE_COVERAGE_MS/60000};
  const covered=Date.parse(state.covered_through),clock=Number(now);
  if(!Number.isFinite(clock)||covered>clock+STEP_MS)return {ok:false,reason:'coverage_clock_invalid',covered_through:state.covered_through,max_age_minutes:STALE_COVERAGE_MS/60000};
  const age=Math.max(0,clock-covered);
  return {
    ok:age<=STALE_COVERAGE_MS,
    reason:age<=STALE_COVERAGE_MS?'fresh':'coverage_stale',
    covered_through:state.covered_through,
    age_minutes:Math.floor(age/60000),
    max_age_minutes:STALE_COVERAGE_MS/60000,
  };
}
