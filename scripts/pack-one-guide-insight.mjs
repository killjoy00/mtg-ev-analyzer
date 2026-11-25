// One set-specific, evidence-backed editorial finding. No arbitrary pack
// fallback and no extrapolation from a card's color to its win rate.
const names={W:'White',U:'Blue',B:'Black',R:'Red',G:'Green'};
const key=s=>typeof s==='string'&&/^[WUBRG]{2,3}$/.test(s)&&new Set(s).size===s.length?[...s].sort().join(''):null;
const readable=(s,max)=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=max&&!/[\r\n]/.test(s);
export const colorLabel=colors=>[...'WUBRG'].filter(c=>colors.includes(c)).map(c=>names[c]).join('–');
export function reviewedArchetypes(notes,gate){
 if(notes?.id!==gate.setId||notes.guideStatus==='draft-unpublished'||!Array.isArray(notes.archetypes)||notes.archetypes.length>10||
    typeof notes.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(notes.reviewedAt)||notes.reviewedAt.slice(0,10)>gate.milestone)return [];
 const valid=notes.archetypes.filter(a=>key(a.colors)&&readable(a.name,120)&&readable(a.plan,240)&&readable(a.detail,500));
 if(new Set(valid.map(a=>key(a.colors))).size!==valid.length)return [];
 return valid.map(a=>({colors:a.colors,name:a.name,plan:a.plan,detail:a.detail}));
}
function monoCost(c){
 // Only unambiguous printed mono-color casting costs. Hybrid, Phyrexian,
 // colorless, missing costs, lands and multicolor costs are not evidence.
 const mana=c?.mana_cost;
 if(typeof mana!=='string'||!mana||!/^(\{(?:[0-9]+|X|W|U|B|R|G)\})+$/.test(mana)||/\bLand\b/.test(c.type_line||''))return null;
 const colors=new Set(mana.match(/[WUBRG]/g)||[]);
 return colors.size===1?[...colors][0]:null;
}
const rate=r=>r.wins/r.games*100;
function related(d,common,hi,lo){
 if(d.pick<3||d.trophyId===d.modelId)return null;
 const higher=[...hi.colors].find(c=>!common.includes(c)),lower=[...lo.colors].find(c=>!common.includes(c));
 const t=d.candidates.find(c=>c.id===d.trophyId),m=d.candidates.find(c=>c.id===d.modelId);
 const colors=[monoCost(t),monoCost(m)],prior=d.prior.map(monoCost),priorShared=prior.filter(c=>common.includes(c)).length;
 if(!t||!m||!colors.includes(higher)||!colors.includes(lower)||d.trophyVotes/d.total<.15||d.modelVotes/d.total<.15||
    priorShared<2||!common.every(c=>prior.includes(c)))return null;
 const h=colors[0]===higher?t:m,l=colors[0]===lower?t:m;
 return {...d,comparison:{shared:colorLabel(common),higher:h.name,lower:l.name,priorShared,higherRole:h.id===t.id?'trophy':'model',lowerRole:l.id===t.id?'trophy':'model'}};
}
export function chooseGuideInsight(outcomes,decisions,notes,gate){
 if(![2,3].includes(outcomes?.colorCount)||!Array.isArray(decisions)||!Array.isArray(outcomes.rows))return null;
 const byPair=new Map(reviewedArchetypes(notes,gate).map(a=>[key(a.colors),a]));
 const rows=outcomes.rows.filter(r=>r.games>=1000&&byPair.has(key(r.colors))),baseline=rate(outcomes.baseline),contrasts=[];
 for(const hi of rows)for(const lo of rows){
  const common=[...hi.colors].filter(c=>lo.colors.includes(c)),gap=rate(hi)-rate(lo);
  if(common.length!==outcomes.colorCount-1||gap<3||rate(hi)<baseline+.5||rate(lo)>baseline-.5)continue;
  const candidates=decisions.map(d=>related(d,common,hi,lo)).filter(Boolean).sort((a,b)=>b.total-a.total||a.day.localeCompare(b.day)||a.puzzleId.localeCompare(b.puzzleId));
  const first=candidates[0],second=first&&candidates.find(e=>e.day!==first.day);
  if(!second)continue;
  const publicExample=({puzzleId,...e})=>e;
  contrasts.push({common,gap:Math.round(gap*10)/10,higher:hi,lower:lo,higherPlan:byPair.get(key(hi.colors)),lowerPlan:byPair.get(key(lo.colors)),examples:[publicExample(first),publicExample(second)]});
 }
 contrasts.sort((a,b)=>b.gap-a.gap||a.higher.colors.localeCompare(b.higher.colors)||a.lower.colors.localeCompare(b.lower.colors));
 const c=contrasts[0];if(!c)return null;
 const shared=colorLabel(c.common),partner=outcomes.colorCount===2?'second':'third';
 return {theme:'shared-color-contrast',title:shared+' decks: the '+partner+' color matters',shared,partner,gap:c.gap,higher:c.higher,lower:c.lower,higherPlan:c.higherPlan,lowerPlan:c.lowerPlan,examples:c.examples,takeaways:[
  'Watch which '+partner+' color is open instead of treating your early '+shared.toLowerCase()+' picks as a finished deck.',
  'For '+colorLabel(c.higher.colors)+', look for the cards that make this plan work: '+c.higherPlan.plan,
  'For '+colorLabel(c.lower.colors)+', demand the pieces for its plan: '+c.lowerPlan.plan,
  'Use game results as context, not a reason to force a color or to assume that the model or trophy drafter was right.'
 ]};
}
