// Immutable, season-start-selected policies. Add future versions with a future
// season boundary; never retune a policy already used by a season. These are
// conservative ranking settings, not a calibrated confidence interval.
const V1=Object.freeze({
  version:'conservative-season-v1',
  prior_days:5,
  penalty_multiplier:1.645,
  environments:Object.freeze({
    mixed:Object.freeze({baseline:70,variability:15}),
    'powered-cube':Object.freeze({baseline:80,variability:8}),
    latest:Object.freeze({baseline:80,variability:8}),
  }),
});
const POLICIES=Object.freeze([
  Object.freeze({from:'0001-01-01',policy:V1}),
]);

export function seasonRatingPolicy(environment,seasonStart) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(seasonStart||''))throw new Error('Season start required for rating policy.');
  const policy=POLICIES.findLast(entry=>entry.from<=seasonStart)?.policy;
  if(!policy?.environments[environment])throw new Error('Unknown season rating environment.');
  return Object.freeze({version:policy.version,prior_days:policy.prior_days,
    penalty_multiplier:policy.penalty_multiplier,...policy.environments[environment]});
}

// Reference calculation used in tests and the synthetic comparison script.
// SQL uses the same policy and all eligible Daily scores, without missing days.
export function conservativeSeasonRating({sum,days},policy) {
  if(!Number.isInteger(days)||days<1||!Number.isFinite(sum)||sum<0||sum>100*days)
    throw new Error('Rating requires completed Daily scores between 0 and 100.');
  const average=sum/days;
  const adjusted=(sum+policy.prior_days*policy.baseline)/(days+policy.prior_days);
  return Math.max(0,Math.min(average,adjusted)
    -policy.penalty_multiplier*policy.variability/Math.sqrt(days+policy.prior_days));
}
