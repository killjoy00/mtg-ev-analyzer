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
  const publicExample=publicGuideExample;
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


// Raw puzzle/source identifiers and vote maps are internal selection evidence,
// never part of the frozen public guide. Card ids are public card identities.
function publicGuideExample({puzzleId,sourceHash,deckColors,votes,...e}){return e;}
const round=n=>Math.round(n*10)/10;
const mean=(rows,get)=>round(rows.reduce((sum,r)=>sum+get(r),0)/rows.length);
const rare=c=>['rare','mythic'].includes(c?.rarity);
const lower=c=>['common','uncommon'].includes(c?.rarity);
const MIN_CONTEXT=4;
function colorContext(d){
 const prior=d.prior.map(monoCost),main=[...'WUBRG'].find(c=>prior.filter(x=>x===c).length>=2&&prior.filter(x=>x===c).length*2>prior.length);
 if(!main)return null;
 const on=c=>monoCost(c)===main,off=c=>!!monoCost(c)&&monoCost(c)!==main;
 const t=d.candidates.find(c=>c.id===d.trophyId),m=d.candidates.find(c=>c.id===d.modelId);
 if(!d.candidates.some(on)||!d.candidates.some(off)||(!on(t)&&!off(t)))return null;
 const focus=d.candidates.filter(on);
 return {d,scope:main,focus:on(t),focusVotes:focus.reduce((sum,c)=>sum+(d.votes[c.id]||0),0),context:{priorColor:main,priorCount:prior.filter(c=>c===main).length,pickedColor:monoCost(t),modelColor:monoCost(m),trophyStayed:on(t)}};
}
function rarityContext(d){
 if(d.pick>3)return null;
 const t=d.candidates.find(c=>c.id===d.trophyId);
 if(!d.candidates.some(rare)||!d.candidates.some(lower)||(!rare(t)&&!lower(t)))return null;
 return {d,scope:'early',focus:rare(t),focusVotes:d.candidates.filter(rare).reduce((sum,c)=>sum+(d.votes[c.id]||0),0),context:{trophyRare:rare(t)}};
}
function cohort(rows){
 const sample=rows.length,days=new Set(rows.map(r=>r.d.day)).size;
 if(sample<MIN_CONTEXT||days<3||new Set(rows.map(r=>r.d.trophyId)).size<2)return null;
 return {sample,days,responses:rows.reduce((sum,r)=>sum+r.d.total,0),
  focusPct:mean(rows,r=>100*r.focusVotes/r.d.total),
  trophyPct:mean(rows,r=>100*r.d.trophyVotes/r.d.total),
  modelMatchPct:mean(rows,r=>r.d.modelId===r.d.trophyId?100:0)};
}
function representative(rows,stats,excludeDay){
 // Typical example rather than selecting the most extreme disagreement.
 return rows.filter(r=>r.d.day!==excludeDay).sort((a,b)=>Math.abs(100*a.focusVotes/a.d.total-stats.focusPct)-Math.abs(100*b.focusVotes/b.d.total-stats.focusPct)||b.d.total-a.d.total||a.d.day.localeCompare(b.d.day)||a.d.puzzleId.localeCompare(b.d.puzzleId))[0];
}
function comparison(rows,theme,scope){
 const a=rows.filter(r=>r.focus),b=rows.filter(r=>!r.focus);
 const first=cohort(a),second=cohort(b);
 if(!first||!second)return null;
 const gap=Math.max(Math.abs(first.focusPct-second.focusPct),Math.abs(first.trophyPct-second.trophyPct),Math.abs(first.modelMatchPct-second.modelMatchPct));
 if(gap<10)return null;
 const e1=representative(a,first),e2=representative(b,second,e1.d.day);
 if(!e2)return null;
 const examples=[e1,e2].map(({d,context,focusVotes})=>({...publicGuideExample(d),context:{...context,focusPct:round(100*focusVotes/d.total)}}));
 let deckEvidence=null;
 if(theme==='color-commitment'){
  // Last recorded Premier trophy deck, not a game-win-rate estimate. Only
  // use matched source decks with valid colors and adequate coverage.
  const linked=b.filter(r=>r.d.deckColors);
  if(linked.length>=5&&linked.length/b.length>=.7){
   deckEvidence={sample:linked.length,cohortSize:b.length,pickedColorMain:linked.filter(r=>r.d.deckColors.includes(r.context.pickedColor)).length,priorColorMain:linked.filter(r=>r.d.deckColors.includes(r.context.priorColor)).length};
  }
 }
 const title=theme==='color-commitment'?(scope==='all'?'When trophy drafters change colors':colorLabel(scope)+' starts: when to look at another color'):'When trophy drafters pass a rare';
 return {theme,scope,title,first,second,deckEvidence,examples,signal:gap*Math.sqrt(Math.min(a.length,b.length))};
}
export function chooseCorpusGuideInsight(decisions){
 // One earliest qualifying decision per source draft, across both cohorts,
 // so the same trophy draft cannot inflate the comparison. No raw source
 // identifiers or decklists leave this function.
 const compare=(theme,extract)=>{
  const seen=new Set(),rows=[];
  for(const d of [...decisions].sort((a,b)=>a.day.localeCompare(b.day)||a.pick-b.pick||a.puzzleId.localeCompare(b.puzzleId))){
   if(!/^[a-f0-9]{32}$/.test(d.sourceHash||'')||seen.has(d.sourceHash)||!d.votes)continue;
   const row=extract(d);if(!row)continue;
   seen.add(d.sourceHash);rows.push(row);
  }
  const candidates=[];
  if(theme==='color-commitment'){
   for(const color of 'WUBRG'){
    const c=comparison(rows.filter(r=>r.scope===color),theme,color);
    if(c)candidates.push(c);
   }
   const pooled=comparison(rows,theme,'all');if(pooled)candidates.push(pooled);
  }else{
   const c=comparison(rows,theme,'early');if(c)candidates.push(c);
  }
  return candidates;
 };
 const candidates=[...compare('color-commitment',colorContext),...compare('rarity-choice',rarityContext)];
 candidates.sort((a,b)=>b.signal-a.signal||a.theme.localeCompare(b.theme)||a.scope.localeCompare(b.scope));
 if(!candidates.length)return null;
 const {signal,...finding}=candidates[0];return finding;
}
