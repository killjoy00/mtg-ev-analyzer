// Selection eligibility, independent of both frozen evidence and score awards.
export const SERVING_POLICY_VERSION='trophy-implied-score-20-v1';
export const LEGACY_SERVING_POLICY_VERSION='legacy-interesting-v1';
export const MINIMUM_IMPLIED_TROPHY_SCORE=20;
export function impliedTrophyScore(puzzle) {
 const cards=puzzle?.candidates||puzzle?.pack;
 let ratio=puzzle?.target_support_ratio==null?null:Number(puzzle.target_support_ratio);
 if(cards){const top=Math.max(...cards.map(c=>Number(c.model_probability))),target=cards.find(c=>c.id===(puzzle.historical_pick_id||puzzle.historicalPickId));ratio=top>0&&target?Number(target.model_probability)/top:null;}
 return ratio!=null&&Number.isFinite(ratio)&&ratio>=0&&ratio<=1?Math.round(95*ratio):null;
}
export function meetsServingQuality(puzzle) {const score=impliedTrophyScore(puzzle);return score!=null&&score>=MINIMUM_IMPLIED_TROPHY_SCORE;}
// Ratings store float64 ratios. For valid nonnegative ratios, round(95*r)>=20
// iff r>=19.5/95. A bare column lets the planner use its real distribution.
export const MINIMUM_TROPHY_SUPPORT_RATIO=(MINIMUM_IMPLIED_TROPHY_SCORE-.5)/95;
export const SERVING_QUALITY_SQL=`r.target_support_ratio >= ${MINIMUM_TROPHY_SUPPORT_RATIO}::float8`;
