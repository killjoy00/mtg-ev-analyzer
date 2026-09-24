import {gameDateKey} from '../game-date.mjs';
import {ensureDailySchedule} from './draft-run-daily.mjs';

const num=value=>Number(value||0);
const textDate=value=>value==null?null:String(value).slice(0,10);

export const DRAFT_RUN_LEADERBOARD_ENVIRONMENTS=['mixed','powered-cube','latest'];

export function normalizeLeaderboardPeriod(value='daily') {
  return value==='month'?'season':value;
}

export function normalizeSeason(row) {
  if(!row)return null;
  return {
    id:String(row.id),
    set_id:String(row.set_id),
    name:String(row.set_name),
    set_release_date:textDate(row.set_release_date),
    start_date:textDate(row.start_date),
    end_date:textDate(row.end_date),
    established_by_day:textDate(row.established_by_day),
  };
}

export async function reconcilePersistedSeasons(query) {
  const result=await query(`SELECT id,set_id,set_name,set_release_date::text,start_date::text,end_date::text,established_by_day::text
    FROM pack1_reconcile_draft_run_seasons()`);
  return normalizeSeason(result.rows[0]);
}

export async function resolveCurrentSeason(query,{today=gameDateKey(),ensureSchedule=null}={}) {
  if(ensureSchedule) {
    try {
      await ensureSchedule(query,today,'latest');
    } catch(error) {
      if(Number(error?.status)!==503)throw error;
    }
  }
  return reconcilePersistedSeasons(query);
}

export async function draftRunLeaderboardRows(query,{start,end,environment,playerId=null,limit=100}={}) {
  const result=await query(`WITH results AS (
      SELECT player_id,round(avg(score),1) score,count(*) days
      FROM scores
      WHERE mode='draft_run' AND set_id=$3
        AND EXISTS (
          SELECT 1 FROM account_links a JOIN players owned ON owned.id=a.player_id
          WHERE a.player_id=scores.player_id AND owned.username_owned=true
        )
        AND challenge_date BETWEEN $1::date AND $2::date
      GROUP BY player_id
    ), ranked AS (
      SELECT rank() OVER(ORDER BY r.score DESC) rank,r.player_id,r.score,r.days,p.display_name,p.showcase_achievement,
        CASE WHEN p.profile_public AND p.username_owned AND
          (SELECT count(*) FROM players x WHERE x.profile_public AND x.username_owned AND lower(x.display_name)=lower(p.display_name))=1
          THEN p.profile_key END profile_key
      FROM results r
      JOIN players p ON p.id=r.player_id AND p.username_owned=true
    )
    SELECT rank,player_id::text,score,days,display_name,showcase_achievement,profile_key
    FROM ranked
    WHERE ($4::uuid IS NULL OR player_id=$4::uuid)
    ORDER BY score DESC,days DESC,display_name
    LIMIT $5::int`,[start,end,environment,playerId,limit]);
  return result.rows.map(row=>({
    ...row,
    rank:num(row.rank),
    score:num(row.score),
    days:num(row.days),
  }));
}

export async function currentSeasonForPlayer(query,playerId,{today=gameDateKey(),ensureSchedule=null}={}) {
  const season=await resolveCurrentSeason(query,{today,ensureSchedule});
  if(!season)return null;
  const standings=[];
  for(const environment of DRAFT_RUN_LEADERBOARD_ENVIRONMENTS) {
    const row=(await draftRunLeaderboardRows(query,{start:season.start_date,end:today,environment,playerId,limit:1}))[0];
    if(row)standings.push({environment,rank:row.rank,average:row.score,days:row.days});
  }
  return {...season,standings};
}
