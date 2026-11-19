// Synthetic policy sensitivity examples only; no production player data.
import {conservativeSeasonRating,seasonRatingPolicy} from '../worker/season-rating.mjs';

const scenarios=[
  {label:'Perfect debut',mean:100,days:1},
  {label:'Low debut',mean:40,days:1},
  {label:'Established 65',mean:65,days:30},
  {label:'Strong eleven',mean:82.18181818181819,days:11},
  {label:'Six weeks',mean:85,days:42},
  {label:'Eight weeks',mean:85,days:56},
  {label:'Twelve weeks',mean:85,days:84},
];
for(const environment of ['mixed','powered-cube','latest']) {
  const policy=seasonRatingPolicy(environment,'2026-09-01');
  console.log(environment);
  console.table(scenarios.map(({label,mean,days})=>{
    const totals={sum:mean*days,days};
    const rate=p=>Number(conservativeSeasonRating(totals,p).toFixed(2));
    return {scenario:label,mean:Number(mean.toFixed(2)),days,
      capped_m5:rate(policy),capped_m2:rate({...policy,prior_days:2}),capped_m10:rate({...policy,prior_days:10}),
      uncapped_m5:Number(Math.max(0,(totals.sum+policy.prior_days*policy.baseline)/(days+policy.prior_days)
        -policy.penalty_multiplier*policy.variability/Math.sqrt(days+policy.prior_days)).toFixed(2)),
      mean_minus_penalty:Number(Math.max(0,mean-policy.penalty_multiplier*policy.variability/Math.sqrt(days)).toFixed(2))};
  }));
}
