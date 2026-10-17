import {gameDateKey} from '../game-date.mjs';
import {DRAFT_RUN_CORPUS_VERSION,V5_CORPUS_VERSION} from '../draft-run.mjs';
import {seasonRatingPolicy} from './season-rating.mjs';

const num=value=>Number(value||0);
const textDate=value=>value==null?null:String(value).slice(0,10);

export const DRAFT_RUN_LEADERBOARD_ENVIRONMENTS=['mixed','powered-cube','latest'];

// Weekly scoring is unchanged. Season scoring uses all eligible Daily scores.
// The all-time board is retired: old links and installed apps get the season.
export const LEADERBOARD_BEST_OF=Object.freeze({week:3});

export function normalizeLeaderboardPeriod(value='daily') {
  return value==='month'||value==='all'?'season':value;
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

export async function draftRunLeaderboardRows(query,{start,end,environment,playerId=null,blockedByPlayerId=null,limit=100,corpusVersion=DRAFT_RUN_CORPUS_VERSION,bestOf=null,ratingPolicy=null}={}) {
  if(bestOf!==null&&ratingPolicy)throw new Error('Choose weekly or season scoring.');
  const result=await query(`WITH day_scores AS (
      SELECT player_id,score,row_number() OVER(PARTITION BY player_id ORDER BY score DESC,challenge_date) best_rank
      FROM scores
      WHERE mode='draft_run' AND set_id=$3
        AND ($7::text IS NULL OR details_json->>'corpus_version'=$7)
        AND EXISTS (
          SELECT 1 FROM account_links a JOIN players owned ON owned.id=a.player_id
          WHERE a.player_id=scores.player_id
            AND owned.username_owned=true
            AND owned.public_identity_hidden_at IS NULL
        )
        AND ($6::uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM public_identity_blocks b WHERE b.blocker_player_id=$6::uuid AND b.target_player_id=scores.player_id
        ))
        AND challenge_date BETWEEN $1::date AND $2::date
    ), results AS (
      SELECT player_id,
        CASE WHEN $9::float8 IS NOT NULL THEN
          greatest(0,least(avg(score)::float8,
            (sum(score)::float8+$10::float8*$9::float8)/(count(*)+$10::float8))
            -$11::float8/sqrt(count(*)+$10::float8))
          WHEN $8::int IS NULL THEN round(avg(score),1)
          ELSE round(coalesce(sum(score) FILTER(WHERE best_rank<=$8::int),0)::numeric/$8::int,1) END score,
        round(avg(score),1) average_score,
        count(*) days
      FROM day_scores
      GROUP BY player_id
    ), ranked AS (
      SELECT rank() OVER(ORDER BY r.score DESC) rank,r.player_id,r.score,r.average_score,r.days,p.display_name,p.showcase_achievement,
        CASE WHEN p.profile_public AND p.username_owned
          AND p.public_identity_hidden_at IS NULL
          AND (SELECT count(*) FROM players x
            WHERE x.profile_public AND x.username_owned
              AND x.public_identity_hidden_at IS NULL
              AND lower(x.display_name)=lower(p.display_name))=1
          THEN p.profile_key END profile_key
      FROM results r
      JOIN players p ON p.id=r.player_id
        AND p.username_owned=true
        AND p.public_identity_hidden_at IS NULL
    )
    SELECT rank,player_id::text,score,average_score,days,display_name,showcase_achievement,profile_key
    FROM ranked
    WHERE ($4::uuid IS NULL OR player_id=$4::uuid)
    ORDER BY score DESC,days DESC,display_name
    LIMIT $5::int`,[start,end,environment,playerId,limit,blockedByPlayerId,corpusVersion===V5_CORPUS_VERSION?V5_CORPUS_VERSION:null,bestOf,
      ratingPolicy?.baseline??null,ratingPolicy?.prior_days??null,
      ratingPolicy?ratingPolicy.penalty_multiplier*ratingPolicy.variability:null]);
  return result.rows.map(row=>({
    ...row,
    rank:num(row.rank),
    // Old clients still receive their ranking value in score. Rank/order above
    // use the unrounded season rating, even when displayed values are equal.
    score:ratingPolicy?Number(num(row.score).toFixed(1)):num(row.score),
    average_score:num(row.average_score),
    ...(ratingPolicy?{rating:num(row.score)}:{}),
    days:num(row.days),
  }));
}

export async function currentSeasonForPlayer(query,playerId,{today=gameDateKey(),ensureSchedule=null}={}) {
  const season=await resolveCurrentSeason(query,{today,ensureSchedule});
  if(!season)return null;
  const standings=[];
  for(const environment of DRAFT_RUN_LEADERBOARD_ENVIRONMENTS) {
    const scoring=seasonRatingPolicy(environment,season.start_date);
    const row=(await draftRunLeaderboardRows(query,{start:season.start_date,end:today,environment,playerId,limit:1,ratingPolicy:scoring}))[0];
    // average is the legacy ranking-value field; average_score is the raw mean.
    if(row)standings.push({environment,rank:row.rank,average:row.score,rating:row.rating,average_score:row.average_score,days:row.days,scoring});
  }
  return {...season,standings};
}
