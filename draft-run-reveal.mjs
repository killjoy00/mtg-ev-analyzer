// Keep the player's card visible even when it falls outside the model's top
// three. A model leader already used by either role is never repeated.
export function revealCardChoices(answer) {
  const trophy=answer?.historicalId,mine=answer?.selectedId;
  const choices=[];
  if(trophy)choices.push({id:trophy,label:mine===trophy?'Your pick · Trophy pick':'Trophy pick'});
  if(mine&&mine!==trophy)choices.push({id:mine,label:'Your pick'});
  const used=new Set(choices.map(c=>c.id));
  const ranking=[...(answer?.ranking||[])].filter(c=>c.id&&c.support!=null&&Number.isFinite(Number(c.support)))
    .sort((a,b)=>Number(b.support)-Number(a.support));
  for(const card of ranking) {
    if(choices.length===3)break;
    if(used.has(card.id))continue;
    choices.push({id:card.id,label:mine===trophy?(choices.length===1?'Next highest':'Third highest'):'Next best'});
    used.add(card.id);
  }
  return choices;
}

export function modelSupportLabel(support,leader) {
  if(support==null||!Number.isFinite(Number(support))||Number(support)<0||!Number.isFinite(Number(leader))||Number(leader)<=0)return 'Unavailable';
  const pct=100*Number(support)/Number(leader);
  return pct>0&&pct<1?'<1%':`${Math.round(pct)}%`;
}

// Use the saved awarded scores, not support or a fresh model calculation.
export function scoreRankLabel(answer) {
  const rows=answer?.ranking;
  if(!Array.isArray(rows)||!rows.length||rows.some(row=>row.score==null||!Number.isFinite(Number(row.score))))return '';
  if(new Set(rows.map(row=>row.id)).size!==rows.length)return '';
  const candidates=answer?.puzzle?.candidates;
  if(Array.isArray(candidates)&&(candidates.length!==rows.length||candidates.some(card=>!rows.some(row=>row.id===card.id))))return '';
  const selected=rows.find(row=>row.id===answer.selectedId);
  if(!selected||answer.score!=null&&Number(answer.score)!==Number(selected.score))return '';
  const score=Number(selected.score),rank=1+rows.filter(row=>Number(row.score)>score).length;
  const tied=rows.filter(row=>Number(row.score)===score).length>1;
  const suffix=rank%100>=11&&rank%100<=13?'th':({1:'st',2:'nd',3:'rd'}[rank%10]||'th');
  return `Your pick ${tied?'tied for':'ranked'} ${rank}${suffix} out of ${rows.length} ${rows.length===1?'card':'cards'}.`;
}
