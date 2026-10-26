// Scoring for the blinded owner puzzle review. Criteria are fixed before any
// rating: the proposed rule passes only if it has at most half as many dull or
// broken puzzles as today's selector and loses at most a quarter of the pairs.
// Unpaired probes, when a review has them, are scored on their own.
export const RATINGS=Object.freeze([
  {id:'interesting',label:'Interesting',help:'A real decision that relates to winning. I would be glad to see it in a Daily.'},
  {id:'fine',label:'Fine',help:'A reasonable decision, but forgettable.'},
  {id:'dull',label:'Dull',help:'The choice barely matters: weak options, or no real choice.'},
  {id:'broken',label:'Broken',help:'The trophy answer or the earlier picks do not make sense. This would frustrate players.'},
]);
const RANK={interesting:3,fine:2,dull:1,broken:0};
export const ARMS=Object.freeze({current:'Today’s selector',proposed:'Proposed rule'});
export const isRating=value=>Object.hasOwn(RANK,value);

export function ratedCount(items,ratings) {
  return items.filter(item=>isRating(ratings?.[item.item_id]?.rating)).length;
}

export function summarizeReview(key,ratings) {
  const tally=()=>Object.fromEntries(RATINGS.map(r=>[r.id,0]));
  const arms={current:tally(),proposed:tally()};
  const pairs=[];
  for(const pair of key.pairs) {
    const current=ratings?.[pair.current]?.rating,proposed=ratings?.[pair.proposed]?.rating;
    if(!isRating(current)||!isRating(proposed))return {complete:false};
    arms.current[current]++;arms.proposed[proposed]++;
    const diff=RANK[proposed]-RANK[current];
    pairs.push({...pair,current_rating:current,proposed_rating:proposed,winner:diff>0?'proposed':diff<0?'current':'tie'});
  }
  // A separate check on one rule: probes pass if at least three quarters
  // are rated Interesting or Fine.
  let landProbe=null;
  if(Array.isArray(key.probes)&&key.probes.length) {
    const rows=key.probes.map(p=>({...p,rating:ratings?.[p.item]?.rating}));
    if(rows.some(r=>!isRating(r.rating)))return {complete:false};
    const good=rows.filter(r=>r.rating==='interesting'||r.rating==='fine').length,needed=Math.ceil(0.75*rows.length);
    landProbe={rows,good,needed,pass:good>=needed};
  }
  const bad=arm=>arms[arm].dull+arms[arm].broken;
  const losses=pairs.filter(p=>p.winner==='current').length;
  const allowedLosses=Math.floor(pairs.length/4);
  const fewerBad={proposed:bad('proposed'),current:bad('current'),pass:bad('proposed')<=bad('current')/2};
  const lossCheck={losses,allowed:allowedLosses,pass:losses<=allowedLosses};
  return {complete:true,arms,pairs,
    wins:{proposed:pairs.filter(p=>p.winner==='proposed').length,current:losses,ties:pairs.filter(p=>p.winner==='tie').length},
    criteria:{fewer_bad:fewerBad,losses:lossCheck},
    // With no dull or broken baseline puzzles the first check passes
    // trivially; the test then cannot show an improvement on that axis.
    baseline_clean:bad('current')===0,
    land_probe:landProbe,
    pass:fewerBad.pass&&lossCheck.pass};
}
