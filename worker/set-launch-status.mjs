// Read-only snapshot of today's three pinned Dailies for an owner-selected set.
// Does not generate puzzles, alter schedules, or inspect individual picks.
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const ENVIRONMENTS=new Set(['mixed','latest','powered-cube']);
export async function readSetLaunchDailies(query,setId){
 if(!/^[a-z0-9-]{2,40}$/.test(String(setId||'')))fail('Choose a set code.');
 const date=(await query("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date::text day")).rows[0]?.day;
 if(!date)throw Error('Pacific product day is unavailable.');
 const result=await query(`SELECT s.environment, s.day::text day,
   jsonb_array_length(s.puzzle_ids)::int picks,
   (SELECT count(DISTINCT p.puzzle_id)::int
    FROM jsonb_array_elements_text(s.puzzle_ids) selected(puzzle_id)
    JOIN draft_run_verified_puzzles p ON p.puzzle_id=selected.puzzle_id) resolved,
   (SELECT count(DISTINCT p.puzzle_id)::int
    FROM jsonb_array_elements_text(s.puzzle_ids) selected(puzzle_id)
    JOIN draft_run_verified_puzzles p ON p.puzzle_id=selected.puzzle_id
    WHERE p.set_id=$2) set_picks,
   s.selection_rule
   FROM draft_run_schedules s
   WHERE s.day=$1::date AND s.environment IN ('mixed','latest','powered-cube')`,[date,setId]);
 const schedules=(result.rows||[]).filter(row=>ENVIRONMENTS.has(row.environment)).map(row=>({
  environment:row.environment,picks:Number(row.picks||0),resolved:Number(row.resolved||0),
  setPicks:Number(row.set_picks||0),selectionRule:row.selection_rule||null
 }));
 return {day:date,setId,schedules};
}
