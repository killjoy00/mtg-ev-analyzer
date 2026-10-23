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

export function modelSupportLabel(support,leader,isTrophy=false) {
  // Trophy model support is intentionally not displayed.
  if(isTrophy)return '-';
  return support!=null&&Number.isFinite(Number(support))&&Number(leader)>0
    ?`${Math.round(100*Number(support)/Number(leader))}%`:'Unavailable';
}
