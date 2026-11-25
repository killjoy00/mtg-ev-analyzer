// #1805: shared, deterministic editorial plan for social video + native posts.
// No generative service, guesses about draft signals, or player-level data.
// Strategy describes the actual printed costs and verifiable card abilities;
// it never calls the trophy choice objectively correct.
import {setLabel,graphemes,otherVotePercent,assertDebatable} from './featured-debate.mjs';
import {formatPercent,imageUrl,checkedFeatureDay} from './featured-pick.mjs';
export const EDITORIAL_VERSION='social-editorial-v4.2';
const colors={W:'white',U:'blue',B:'black',R:'red',G:'green'};
const letters='ABC';
const tokens=cost=>typeof cost==='string'?[...cost.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]):[];
const unique=xs=>[...new Set(xs)];
const names=xs=>xs.length<2?xs.join(''):xs.length===2?xs.join(' or '):xs.slice(0,-1).join(', ')+', or '+xs.at(-1);
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const plural=(n,s)=>n===1?s:s+'s';
const small=n=>['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen'][n]||String(n);
const typeName=t=>{
 const m=String(t||'').split(/[—–]/)[0];
 for(const label of ['Planeswalker','Creature','Equipment','Battle','Instant','Sorcery','Enchantment','Artifact','Land']){
  if(label==='Equipment'?/\bEquipment\b/.test(t||''):new RegExp('\\b'+label+'\\b').test(m))return label.toLowerCase();
 }
 return 'card';
};
export function manaFacts(cost){
 const symbols=tokens(cost);
 const valid=typeof cost==='string'&&(cost===''||symbols.map(s=>'{'+s+'}').join('')===cost);
 const fixed=valid?symbols.filter(s=>Object.hasOwn(colors,s)):[];
 const possible=valid?unique(symbols.flatMap(s=>s.split('/').filter(x=>Object.hasOwn(colors,x)))):[];
 const exotic=symbols.some(s=>!(/^\d+$/.test(s)||Object.hasOwn(colors,s)||s==='C'||s==='S'));
 const value=valid&&!exotic&&symbols.length?symbols.reduce((n,s)=>n+(/^\d+$/.test(s)?Number(s):1),0):null;
 return {fixed,possible,value,hybrid:symbols.some(s=>s.includes('/')),exotic,valid};
}
export function printId(card){
 if(!imageUrl(card?.image_url))return null;
 return new URL(card.image_url).pathname.match(/\/front\/[a-f0-9]\/[a-f0-9]\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(?:jpg|png)$/i)?.[1]||null;
}
// Match the printing AND name; an API mismatch is never substituted with
// similarly named cards. Missing metadata degrades to printed type/cost only.
export function verifiedOracle(card,byId={}){
 const id=printId(card),item=id&&byId[id];
 if(!item||item.id!==id)return null;
 const face=Array.isArray(item.card_faces)?item.card_faces.find(x=>x.name===card.name):null;
 const source=item.name===card.name&&typeof item.oracle_text==='string'?item:face;
 if(!source||source.name!==card.name||typeof source.oracle_text!=='string')return null;
 if(typeof card.mana_cost==='string'&&typeof source.mana_cost==='string'&&card.mana_cost!==source.mana_cost)return null;
 return {id,oracle:source.oracle_text,source:'scryfall-exact-printing'};
}
export async function fetchOracleMetadata(cards,{fetcher=fetch}={}){
 const ids=unique(cards.map(printId).filter(Boolean)),out={};
 for(let i=0;i<ids.length;i+=75){
  if(i)await new Promise(r=>setTimeout(r,150));
  try{
   const res=await fetcher('https://api.scryfall.com/cards/collection',{
    method:'POST',headers:{'User-Agent':'PackOne/1.0 (packone.pro)','Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({identifiers:ids.slice(i,i+75).map(id=>({id}))}),signal:AbortSignal.timeout(20000),redirect:'error',
   });
   if(!res.ok)continue;
   const j=await res.json();
   for(const c of j.data||[])if(ids.includes(c.id))out[c.id]=c;
  }catch{/* printed-cost fallback is explicit and deterministic */}
 }
 return out;
}
const rules=[
 [/\bdestroy target nonland permanent\b/i,'Nonland permanent removal','can destroy a nonland permanent','removal'],
 [/\bexile target nonland permanent\b/i,'Nonland permanent exile','can exile a nonland permanent','removal'],
 [/\bdestroy all creatures\b/i,'Creature board wipe','can destroy multiple creatures','removal'],
 [/\bexile all creatures\b/i,'Creature board wipe','can exile multiple creatures','removal'],
 [/\bdestroy target creature\b/i,'Creature removal','can destroy a creature','removal'],
 [/\bexile target creature\b/i,'Creature exile','can exile a creature','removal'],
 [/\bdeals (\d+) damage to (?:up to one )?target (?:creature|creature or planeswalker)/i,null,null,'removal'],
 [/\bdeals (\d+) damage to any target\b/i,null,null,'damage'],
 [/\bcounter target (?:creature |noncreature |instant or sorcery )?spell\b/i,'Counterspell','can counter a spell','interaction'],
 [/\b(?:you )?draw (?:a|one|two|three|four|\d+) cards?\b/i,'Card draw','can draw cards','value'],
 [/\bcreate (?:a|one|two|three|four|\d+) [^.\n]{0,60}\btoken[s]?\b/i,'Token maker','can create tokens','board'],
 [/\breturn target creature card from your graveyard to (?:the battlefield|your hand)\b/i,'Creature recursion','can return a creature card from your graveyard','value'],
 [/\bput (?:a|one|two|three|\d+) \+1\/\+1 counters?\b/i,'+1/+1 counters','can add +1/+1 counters','board'],
 [/\bsearch your library for (?:a|up to [^.\n]{0,20}) [^.\n]{0,40}\bland card\b/i,'Land search','can search for a land','mana'],
 [/\b(?:basic )?landcycling\b/i,'Landcycling','has landcycling','mana'],
];
// Keep evidence as the actual matching clause, not inferred strength/optimality.
// "Can" is deliberate: target restrictions and activation costs still apply.
export function optionFacts(c,byId={}){
 const m=manaFacts(c.mana_cost),type=typeName(c.type_line),oracle=verifiedOracle(c,byId),hits=[];
 if(oracle){
  // Don't classify granted/quoted abilities as direct effects; only use an
  // unambiguous unquoted clause. Keep the exact source sentence for audit.
  const text=oracle.oracle.replace(/"[^"]*"|“[^”]*”/g,'').replace(/\([^)]*\)/g,'');
  for(const [pattern,title,description,kind] of rules){
   const match=text.match(pattern);if(!match)continue;
   const sentence=text.slice(Math.max(text.lastIndexOf('.',match.index-1),text.lastIndexOf('\n',match.index-1))+1);
   const full=sentence.split(/[.\n]/)[0].trim();
   if(!full||full.length>200||/\b(?:unless|instead|prevent|can't|cannot|would|if you don't|if you do not)\b/i.test(full))continue;
   const damage=match[1];
   hits.push({label:title||damage+'-damage '+(kind==='removal'?'removal':'spell'),description:description||'can deal '+damage+' damage to '+(kind==='removal'?'a creature':'a target'),kind,evidence:full});
   if(hits.length===2)break;
  }
 }
 const costs=m.value===null?'':m.value+'-mana ';
 const role=hits[0]?.label||cap(costs+type);
 const role2=hits[1]?.label||'';
 const pips=Object.entries(colors).filter(([k])=>m.fixed.includes(k)).map(([k,v])=>small(m.fixed.filter(x=>x===k).length)+' '+v);
 const costNote=m.hybrid?'Hybrid mana in its cost':pips.length?'Printed cost: '+pips.join(' + ')+' symbol'+(pips.length===1&&m.fixed.length===1?'':'s'):m.value!==null?'Printed mana value: '+m.value:'See printed cost';
 return {id:c.id,name:c.name,role,role2,type,mana:c.mana_cost||'',manaFacts:m,costNote,
  description:hits[0]?.description||('a '+costs+type),evidence:hits,
  metadata:oracle?'verified-rules':'printed-metadata-only'};
}
export function editorialPlan(f,byId={}){
 assertDebatable(f);checkedFeatureDay(f.day);
 if(f.players<50||f.choices.some(c=>!imageUrl(c.image_url)||!Number.isSafeInteger(c.votes)||c.votes<=0)||
    !f.prior_picks.every(c=>imageUrl(c.image_url)))throw Error('Invalid social editorial inputs');
 if(f.choices.reduce((s,c)=>s+c.votes,0)+f.other_votes!==f.players||
    f.choices.some(c=>c.pct!==Math.round(1000*c.votes/f.players)/10))throw Error('Vote denominator mismatch');
 const options=f.choices.map(c=>optionFacts(c,byId)),prior=f.prior_picks.map(c=>({...c,manaFacts:manaFacts(c.mana_cost)}));
 const seen=unique(prior.flatMap(c=>c.manaFacts.fixed));
 const counts=Object.keys(colors).map(k=>({k,n:prior.filter(c=>c.manaFacts.fixed.includes(k)).length})).filter(x=>x.n).sort((a,b)=>b.n-a.n);
 const mono=prior.filter(c=>unique(c.manaFacts.fixed).length===1&&!c.manaFacts.exotic);
 const exactMono=prior.length>0&&mono.length===prior.length;
 const summary=counts.map(({k,n})=>small(n)+' '+colors[k]).join(', ');
 const priorLine=prior.length?(exactMono?cap(summary)+' '+plural(prior.length,'pick')+'.':counts.length?cap(summary)+' in the printed costs so far.':prior.length+' earlier '+plural(prior.length,'pick')+'; see the cards.'):'First pick. No colors committed yet.';
 const onlyKnown=o=>o.manaFacts.fixed.length>0&&!o.manaFacts.exotic&&o.manaFacts.fixed.every(k=>seen.includes(k));
 const addsColor=o=>!o.manaFacts.exotic&&o.manaFacts.fixed.some(k=>!seen.includes(k));
 const values=options.map(o=>o.manaFacts.value);
 const distinct=unique(values.filter(v=>v!==null)).sort((a,b)=>a-b);
 const sameType=options.every(o=>o.type===options[0].type);
 const roles=unique(options.map(o=>o.evidence[0]?.kind).filter(Boolean));
 let headline,question,kind;
 if(prior.length&&options.some(onlyKnown)&&options.some(addsColor)){
  headline=exactMono?cap(summary)+' '+plural(prior.length,'pick')+'.':counts.length?cap(small(counts[0].n))+' prior '+plural(counts[0].n,'card')+' with '+colors[counts[0].k]+' mana.':prior.length+' earlier picks.';
  question='Stay with your colors or branch out?';kind='color-pivot';
 }else if(prior.length&&seen.length&&options.every(addsColor)){
  headline=prior.length===1?'One pick in. New colors?':'More colors at pick '+f.pick_number+'?';
  question='Which direction would you take now?';kind='new-colors';
 }else if(sameType&&options.every(o=>o.type==='planeswalker')&&distinct.length===1&&values.every(v=>v!==null)){
  headline=options.length===2?'Two '+distinct[0]+'-mana planeswalkers.':options.length+' '+distinct[0]+'-mana planeswalkers.';
  question=prior.length?'Which fits your draft?':'Which starts your draft?';kind='same-type';
 }else if(distinct.length>=2&&values.every(v=>v!==null)&&distinct.at(-1)-distinct[0]>=3){
  headline=distinct[0]+' mana vs. '+distinct.at(-1)+' mana.';
  question=prior.length?'Go cheaper or take the expensive option?':'Is the expensive spell worth your first pick?';kind='cost-gap';
 }else if(roles.includes('removal')&&options.some(o=>o.type==='creature'&&!o.evidence.some(e=>e.kind==='removal'))){
  headline='Removal or a creature?';question=prior.length?'What does your draft need here?':'Which would you start with?';kind='removal-creature';
 }else if(options.every(o=>o.evidence[0]?.kind==='value'&&o.evidence[0]?.label==='Card draw')){
  headline=cap(small(options.length))+' ways to draw cards.';question='Which fits your mana curve and colors?';kind='shared-value';
 }else if(!sameType&&options.every(o=>o.type!=='card')){
  headline=cap(names(unique(options.map(o=>o.type))))+'?';
  question=f.pick_number===1?'Which starts your draft?':'What does your draft need here?';kind='card-type';
 }else if(f.pick_number===1){
  headline='What would you first-pick?';question='Which card would you build around?';kind='first-pick';
 }else{
  headline='Pick '+f.pick_number+': what does your draft need?';question='Which card fits your pool best?';kind='context';
 }
 const where=setLabel(f)+' · P1P'+f.pick_number;
 const compact=options.map((o,i)=>{
  const repeated=options.some((other,j)=>i!==j&&other.role===o.role);
  const detail=repeated?(o.manaFacts.value===null?o.type:o.manaFacts.value+'-mana '+o.type)+' / '+o.role.toLowerCase():o.role.toLowerCase();
  return letters[i]+': '+detail;
 }).join('\n');
 const withNames=options.map((o,i)=>letters[i]+': '+o.name+' ('+o.role.toLowerCase()+')').join('\n');
 const tags='#MTG #MTGDraft';
 const ask='What are you taking, and why? Results later today.';
 const lines=[[where,priorLine,headline+' '+question,withNames,ask,tags],
  [where,priorLine,question,compact,ask,tags],
  [where,headline+' '+question,compact,ask,tags],
  [where,headline+' '+question,ask,tags]];
 const morning=lines.map(xs=>xs.join('\n\n')).find(s=>graphemes(s)<=300);
 const tally=f.choices.map(c=>formatPercent(c.pct)+'% — '+c.name);
 const other=otherVotePercent(f);
 if(other>0)tally.push(formatPercent(other)+'% — Other cards');
 const trophyIndex=f.choices.findIndex(c=>c.id===f.trophy.id);
 const replyOpts=[
  ['Here’s what '+f.players+' Pack One players chose:',tally.join('\n'),'The trophy drafter took '+f.trophy.name+'. Would you have done the same?','Play free: packone.pro'],
  [f.players+' Pack One players:',tally.join('\n'),'Trophy drafter: '+f.trophy.name+'.','Play free: packone.pro'],
  [f.players+' Pack One players: '+f.choices.map((c,i)=>letters[i]+' '+formatPercent(c.pct)+'%').join(', ')+(other>0?', other '+formatPercent(other)+'%':''),'Trophy drafter: '+letters[trophyIndex]+' ('+f.trophy.name+').','Play free: packone.pro'],
  [f.players+' Pack One players: '+f.choices.map((c,i)=>letters[i]+' '+formatPercent(c.pct)+'%').join(', ')+(other>0?', other '+formatPercent(other)+'%':''),'Trophy drafter: '+letters[trophyIndex]+'.','Play free: packone.pro'],
 ];
 const reply=replyOpts.map(xs=>xs.join('\n\n')).find(s=>graphemes(s)<=300);
 if(!morning||!reply)throw Error('Social copy exceeds Bluesky limits');
 const alt=where+'. '+(prior.length?'Prior picks: '+prior.map(c=>c.name+' '+(c.mana_cost||'')).join('; ')+'. ':'First pick. ')+
 options.map((o,i)=>letters[i]+': '+o.name+' — '+o.role+(o.role2?' / '+o.role2:'')+'.').join(' ')+
 ' '+question+' No results shown.';
 const title=where+' | '+headline+' #Shorts';
 return {version:EDITORIAL_VERSION,day:f.day,puzzle_id:f.puzzle_id,where,kind,headline,question,priorLine,options,
  morning,reply,alt,youtube:{title:title.length<=100?title:where+' | What would you pick? #Shorts',
   description:where+'\n'+priorLine+'\n'+question+'\n'+withNames+'\n\nEight real draft decisions every day. Play free at packone.pro (link in profile).\n\nUnofficial Magic fan content. Card images: Scryfall.\n#MTG #MTGDraft #Shorts'},
  coverage:{verified:options.filter(o=>o.metadata==='verified-rules').length,total:options.length}};
}
