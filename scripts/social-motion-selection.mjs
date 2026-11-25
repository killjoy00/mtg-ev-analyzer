// #1805 preview-stage daily selection. Keep the existing Daily, Discord and
// Patreon selector untouched. The publication date is NOT the source date.
// A future live publisher must supply durable used IDs and freeze its plan
// under the publication date before posting/retry/reveal.
import {selectFeaturedPick,checkedFeatureDay} from './featured-pick.mjs';
export const SOCIAL_LOOKBACK_DAYS=7;
// Deliberate cutover date; pause flag rolls back to the previous format.
export const MOTION_START_DAY='2026-11-26';
export const motionEnabled=(env,day)=>env.SOCIAL_MOTION_ACTIVE==='true'&&day>=MOTION_START_DAY;
const dayDistance=(today,day)=>Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'))/86400000);
const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
export function socialCandidate(row,day){
 const f=selectFeaturedPick([row],{day});
 if(!f)return null;
 const cards=row.payload?.candidates||[],byId=new Map(cards.map(c=>[c.id,c]));
 const probabilities=cards.map(c=>c.model_probability);
 if(!probabilities.length||probabilities.some(p=>!numeric(p)))return null;
 const max=Math.max(...probabilities),p=byId.get(f.trophy.id)?.model_probability;
 // A 20% relative-model-leader guard; not a measured human win-rate claim.
 // Leave the main Daily selection/scoring rules untouched.
 if(!(max>0&&numeric(p)&&p/max>=.20))return null;
 const metadata=c=>({mana_cost:typeof c?.mana_cost==='string'?c.mana_cost:'',
  type_line:typeof c?.type_line==='string'?c.type_line:'',
  rarity:typeof c?.rarity==='string'?c.rarity:''});
 return {...f,model_alignment:p/max,choices:f.choices.map(c=>({...c,...metadata(byId.get(c.id))})),
  trophy:{...f.trophy,...metadata(byId.get(f.trophy.id))},
  prior_picks:f.prior_picks.map((c,i)=>({...c,...metadata(row.payload.prior_picks[i]),id:row.payload.prior_picks[i].id}))};
}
export function selectSocialDecision(days,{publicationDay,usedPuzzleIds,lookback=SOCIAL_LOOKBACK_DAYS}={}){
 checkedFeatureDay(publicationDay);
 if(!(usedPuzzleIds instanceof Set))throw Error('Used-puzzle history is required');
 if(!Number.isInteger(lookback)||lookback<1||lookback>SOCIAL_LOOKBACK_DAYS)throw Error('Invalid social lookback');
 if(!Array.isArray(days))throw Error('Expected dated source rows');
 const eligible=[];
 for(const entry of days){
  checkedFeatureDay(entry.day);
  const age=dayDistance(publicationDay,entry.day);
  if(age<1||age>lookback)continue;
  if(!Array.isArray(entry.rows))throw Error('Expected source rows');
  for(const row of entry.rows){
   const f=socialCandidate(row,entry.day);
   if(!f||usedPuzzleIds.has(f.puzzle_id))continue;
   eligible.push({...f,publication_day:publicationDay,age_days:age});
  }
 }
 // Prefer the most recent qualifying source day, and the Latest Set within
 // it, then three-choice debate over two-choice. Skip if nothing qualifies.
 eligible.sort((a,b)=>a.age_days-b.age_days||
  Number(b.environment==='latest')-Number(a.environment==='latest')||
  b.tier-a.tier||b.score-a.score||b.players-a.players||
  a.puzzle_id.localeCompare(b.puzzle_id)||a.environment.localeCompare(b.environment)||a.round-b.round);
 return eligible[0]||null;
}
