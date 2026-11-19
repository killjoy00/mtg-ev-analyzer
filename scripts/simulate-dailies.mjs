import fs from 'node:fs';
import {dailySetPlan,liveRegularSets,recencyWeight} from '../daily-selection.mjs';
import {requiredSetRounds,runDifficultyBands} from '../draft-run-policy.mjs';
import {runPickWindows} from '../draft-run.mjs';
import {seededRandom} from '../gameplay.mjs';
const metadata=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const day=process.argv[3]||'2026-09-18',runs=Number(process.argv[4]||100000);
if(!Number.isSafeInteger(runs)||runs<1000)throw Error('Use at least 1000 runs.');
const ids=liveRegularSets(metadata,day).map(s=>s.set_id),counts=new Map(ids.map(s=>[s,0]));
const groups=process.argv[5]?JSON.parse(fs.readFileSync(process.argv[5],'utf8')):null;
let feasible=0,minNewest=8,minPrevious=8,missingPrevious=0;
for(let i=0;i<runs;i++){
 const random=seededRandom(`distribution:${day}:${i}`);
 const bands=runDifficultyBands(random,'eight-pick-v4');
 const plan=dailySetPlan(metadata,day,random);
 if(groups){requiredSetRounds(groups,bands,runPickWindows('mixed','eight-pick-v4'),random,plan);feasible++;}
 minNewest=Math.min(minNewest,plan.filter(s=>s===ids[0]).length);
 minPrevious=Math.min(minPrevious,plan.filter(s=>ids.slice(1,4).includes(s)).length);
 if(ids.slice(1,4).some(s=>!plan.includes(s)))missingPrevious++;
 for(const s of plan)counts.set(s,counts.get(s)+1);
}
const allWeight=ids.reduce((n,_,i)=>n+recencyWeight(i),0),previousWeight=[0,1,2].reduce((n,i)=>n+recencyWeight(i),0);
const distribution=ids.map((set_id,rank)=>({set_id,decisions:counts.get(set_id),percent:Number((100*counts.get(set_id)/(runs*8)).toFixed(4)),expected_percent:100*((rank===0?2:rank<4?4*recencyWeight(rank-1)/previousWeight:0)+2*recencyWeight(rank)/allWeight)/8}));
console.log(JSON.stringify({policy:'eight-pick-v4',day,runs,feasible_plans:groups?feasible:null,decisions:runs*8,recency_half_life_releases:4,min_newest:minNewest,min_previous_three:minPrevious,days_omitting_at_least_one_previous_set:missingPrevious,newest_four_percent:distribution.slice(0,4).reduce((n,s)=>n+s.percent,0),distribution,note:'Selection distribution before puzzle feasibility. Source uniqueness, window and quality checks remain mandatory; operational feasibility is verified separately.'},null,2));
