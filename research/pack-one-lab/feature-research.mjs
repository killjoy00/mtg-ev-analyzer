// Versioned feature research. No draft identifiers leave the transient accumulator.
// The second comparison must test a real alternative explanation, not restate the chart.
import {attachRulesContext} from './rules-context.mjs';
import {validateCardResearch} from './card-research.mjs';
export const FEATURE_VERSION='feature-v2';
const colors=new Set(['W','U','B','R','G']);
const rarity=new Set(['common','uncommon','rare','mythic']);
const cell=()=>({n:0,picked:0,sources:new Set()});
const bump=(c,selected,source)=>{c.n++;if(selected)c.picked++;c.sources.add(source);};
const finish=c=>({n:c.n,picked:c.picked,drafts:c.sources.size});
const simple=c=>c?.knownType&&!c.land&&c.colors?.length===1&&colors.has(c.colors[0]);
const mono=c=>simple(c)?c.colors[0]:null;
const known=c=>c?.knownType&&(c.land||rarity.has(c.rarity));
const info=c=>({name:c.name,rarity:c.rarity,type:c.type,mana_cost:c.mana_cost,color:mono(c),mana:c.mana,creature:c.creature});
const keys=['fresh','prior','fresh-zero','fresh-one','prior-one','fresh-many','prior-many','opening','fifth','fifth-off','fifth-on','curve-short','curve-full','curve-off','deck-all','deck-low','deck-high'];
const entries=()=>Object.fromEntries(keys.map(k=>[k,cell()]));
export function createFeatureResearch(){
 const cards=new Map();
 let complete=0,knownOffers=0;
 function get(c){
  const v=info(c),key=JSON.stringify(v);
  if(!cards.has(c.name))cards.set(c.name,{card:v,key,ambiguous:false,cells:entries()});
  const row=cards.get(c.name);
  if(row.key!==key)row.ambiguous=true;
  return row.cells;
 }
 function observe(picks,deck,source){
  if(picks.length!==8)throw Error('lab-feature-trajectory');
  complete++;
  for(const {offered} of picks)for(const c of offered)if(simple(c))get(c);
  for(let i=0;i<8;i++){
   const {offered,chosen}=picks[i],prior=picks.slice(0,i).map(p=>p.chosen);
   if(!offered.every(known))continue;
   knownOffers++;
   const seen=new Set(prior.map(c=>c.name));
   const names=new Map(offered.filter(simple).map(c=>[c.name,c]));
   if(simple(chosen))names.set(chosen.name,chosen);
   for(const c of names.values()){
    if(!['common','uncommon'].includes(c.rarity))continue;
    const tally=get(c),selected=chosen.name===c.name,cl=mono(c);
    const same=prior.filter(p=>mono(p)===cl).length,has=seen.has(c.name);
    if(i===0)bump(tally.opening,selected,source);
    if(i===4){
     bump(tally.fifth,selected,source);
     bump(tally[same?'fifth-on':'fifth-off'],selected,source);
    }
    if(i>=3&&c.rarity==='common'){
     // Inconsistent same-name mana metadata cannot enter either partition.
     if(has&&same===0){cards.get(c.name).ambiguous=true;continue;}
     bump(tally[has?'prior':'fresh'],selected,source);
     if(same===0&&!has)bump(tally['fresh-zero'],selected,source);
     else if(same===1)bump(tally[has?'prior-one':'fresh-one'],selected,source);
     else if(same>=2)bump(tally[has?'prior-many':'fresh-many'],selected,source);
    }
    // Among offers containing a same-color two-drop and a same-color larger
    // creature, test curve pressure within pools with earlier same-color picks.
    // Use only P1P5 so the check is not confounded by a changing pick number.
    if(i===4&&c.creature&&c.mana===2&&offered.some(x=>mono(x)===cl&&x.creature&&x.mana>=3)){
     if(same>=2){
      const earlyTwo=prior.some(p=>mono(p)===cl&&p.creature&&p.mana===2);
      bump(tally[earlyTwo?'curve-full':'curve-short'],selected,source);
     }else if(same===0)bump(tally['curve-off'],selected,source);
    }
   }
  }
  const first=picks[0].chosen;
  if(deck&&simple(first)&&['common','uncommon','rare','mythic'].includes(first.rarity)){
   const name=first.name.normalize('NFC').toLowerCase(),kept=deck.main.has(name);
   if(kept||deck.side.has(name)){
    const count=picks.slice(1).filter(p=>mono(p.chosen)===mono(first)).length;
    const tally=get(first);
    bump(tally['deck-all'],kept,source);
    bump(tally[count>=2?'deck-high':'deck-low'],kept,source);
   }
  }
 }
 function report(){
  return {version:FEATURE_VERSION,complete,known_offers:knownOffers,cards:[...cards.values()].map(({card,ambiguous,cells})=>({card,ambiguous,cells:Object.fromEntries(keys.map(k=>[k,finish(cells[k])]))})).sort((a,b)=>a.card.name.localeCompare(b.card.name))};
 }
 return {observe,report};
}
const rate=c=>c.picked/c.n;
const delta=(a,b)=>Math.abs(rate(a)-rate(b));
const enough=(c,min)=>c.drafts>=min&&c.n>=min;
const cellValid=(c,total)=>c&&['n','picked','drafts'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)&&c.picked<=c.n&&c.drafts<=Math.min(total,c.n)&&c.n<=8*total&&(c.n===0)===(c.drafts===0);
const m=(id,label,c)=>({id,label,numerator:c.picked,denominator:c.n,percent:Math.round(1000*rate(c))/10,distinct_drafts:c.drafts});
const safeName=v=>typeof v==='string'&&v.length>0&&v.length<=65&&!/[\r\n<>]/.test(v);
function validateReport(raw,total){
 if(raw?.version!==FEATURE_VERSION||raw.complete!==total||!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(raw.known_offers)||raw.known_offers<0||raw.known_offers>total*8||!Array.isArray(raw.cards)||raw.cards.length>1000)throw Error('lab-feature-report');
 const names=new Set();
 for(const row of raw.cards){
  const c=row.card;
  if(!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>160||names.has(c.name)||!colors.has(c.color)||typeof row.ambiguous!=='boolean'||!keys.every(k=>cellValid(row.cells?.[k],total)))throw Error('lab-feature-card');
  names.add(c.name);
  const x=row.cells;
  const split=(all,...parts)=>['n','picked'].every(k=>parts.reduce((n,p)=>n+p[k],0)===all[k]);
  if(!split(x.fifth,x['fifth-off'],x['fifth-on'])||!split(x['deck-all'],x['deck-low'],x['deck-high'])||!split(x.fresh,x['fresh-zero'],x['fresh-one'],x['fresh-many'])||!split(x.prior,x['prior-one'],x['prior-many']))throw Error('lab-feature-partition');
 }
 return raw;
}
const source='17Lands public PremierDraft data (CC BY 4.0), retained verified trophy drafts.';
const method='https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md';
const compare=(cells,a,b)=>delta(cells[a],cells[b]);
const commonLimit='Only retained trophy drafts with complete first-eight histories; observational, not a causal or win-rate comparison.';
const laneLimit='Earlier color counts use ordinary single-color printed mana costs; hybrid, gold and other costs are not classified as mono-color.';
function buildPacket(raw,row,rank,{family,theme,question,followUp,primary,follow,extra=[],heading,unit,limits,score,reference,cards=[row.card],deck=false}){
 const metrics=[...primary,...follow,...extra];
 const packet={schema_version:1,id:FEATURE_VERSION+'-'+raw.set_id+'-'+family+'-'+row.card.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),kind:'stored-card-analysis',series:'Draft Theory',headline:question,set:raw.set_name,theme,editorial_mode:'draft-decision',chart_heading:heading,unit,
  metrics,focus_metrics:primary.map(x=>x.id),support_metrics:[],cohort:{complete_trajectories:raw.complete_drafts,corpus_version:raw.corpus_version,source_snapshot_id:raw.source_snapshot_id},
  feature:{version:FEATURE_VERSION,question,follow_up_question:followUp,primary_ids:primary.map(x=>x.id),follow_up_ids:follow.map(x=>x.id),extra_ids:extra.map(x=>x.id),follow_up_heading:family==='repeat-context'?'Compare earlier color picks':family==='curve-need'?'Earlier curve needs':family==='first-pick-deck'?'Later same-color picks':'Pick five by earlier color',family},
  research_context:{family:'feature-'+family,cards},limitations:[...limits,commonLimit],provenance:{attribution:source,method,archive:'https://www.17lands.com/public_datasets',hashes:{draft:raw.draft_sha256,game:raw.game_sha256,...(deck?{deck_catalog:raw.deck_sha256}:{})}},reference,
  triage_score:Math.round(score*100)+Math.min(20,Math.min(...follow.map(x=>x.distinct_drafts))/3)+(rank<3?10:0),status:'draft-only'};
 const withRules=attachRulesContext(packet,raw,raw.rules_context);
 // A feature needs verified card-specific mechanics for an actual Magic story.
 if(!cards.every(card=>withRules.research_context.rules_context?.cards.some(c=>c.name===card.name)))return null;
 validateFeaturePacket(withRules);
 return withRules;
}
export function validateFeaturePacket(p){
 const f=p?.feature;
 if(f?.version!==FEATURE_VERSION||!['repeat-context','pick-priority','curve-need','first-pick-deck'].includes(f.family)||!f.question?.trim()||!f.follow_up_question?.trim()||f.question===f.follow_up_question||!f.follow_up_heading?.trim())throw Error('lab-feature-evidence');
 const a=f.primary_ids,b=f.follow_up_ids,c=f.extra_ids;
 if(!Array.isArray(a)||a.length<2||a.length>4||!Array.isArray(b)||b.length<2||b.length>4||!Array.isArray(c)||new Set([...a,...b,...c]).size!==a.length+b.length+c.length||!Array.isArray(p.metrics)||p.metrics.length!==a.length+b.length+c.length||new Set(p.metrics.map(x=>x.id)).size!==p.metrics.length||JSON.stringify(a)!==JSON.stringify(p.focus_metrics))throw Error('lab-feature-evidence');
 const required={
  'repeat-context':[['fresh','prior'],['fresh-one','prior-one','fresh-many','prior-many']],
  'pick-priority':[['opening','fifth'],['fifth-off','fifth-on']],
  'curve-need':[['curve-off','curve-on'],['curve-short','curve-full']],
  'first-pick-deck':[['deck-lead','deck-alt'],['deck-low','deck-high']]
 }[f.family];
 if(JSON.stringify([a,b])!==JSON.stringify(required))throw Error('lab-feature-evidence');
 for(const id of [...a,...b,...c]){
  const x=p.metrics.find(m=>m.id===id);
  if(!x||!Number.isSafeInteger(x.distinct_drafts)||x.distinct_drafts<10||x.distinct_drafts>x.denominator||!Number.isSafeInteger(x.numerator)||!Number.isSafeInteger(x.denominator)||x.numerator<0||x.numerator>x.denominator||x.percent!==Math.round(1000*x.numerator/x.denominator)/10)throw Error('lab-feature-evidence');
 }
 const metric=id=>p.metrics.find(m=>m.id===id),diff=(a,b)=>Math.abs(metric(a).percent-metric(b).percent),support=(id,n)=>metric(id).distinct_drafts>=n;
 const min=(ids,n)=>ids.every(id=>support(id,n));
 let qualifies=false;
 if(f.family==='repeat-context'){
  const gap=diff('fresh','prior'),g1=diff('fresh-one','prior-one'),g2=diff('fresh-many','prior-many');
  qualifies=support('fresh',100)&&support('prior',25)&&gap>=19.9&&(Math.max(Math.abs(gap-g1),Math.abs(gap-g2))>=11.9||Math.min(g1,g2)>=14.9||Math.sign(metric('prior').percent-metric('fresh').percent)!==Math.sign(metric('prior-many').percent-metric('fresh-many').percent));
 }else if(f.family==='pick-priority')qualifies=min(a,45)&&min(b,25)&&diff(a[0],a[1])>=21.9&&diff(b[0],b[1])>=19.9;
 else if(f.family==='curve-need')qualifies=min([...a,...b],18)&&diff(b[0],b[1])>=14.9&&Math.max(diff(a[0],b[0]),diff(a[0],b[1]))>=19.9;
 else if(f.family==='first-pick-deck')qualifies=min(a,45)&&min(b,18)&&diff(a[0],a[1])>=9.9&&diff(b[0],b[1])>=17.9&&metric('deck-lead').percent<=90;
 if(!qualifies)throw Error('lab-feature-support');
 return f;
}
export function featureResearchPackets(report){
 if(report?.schema_version!==1||report.kind!=='stored-corpus'||!Array.isArray(report.sets)||report.sets.length>5)throw Error('lab-feature-report');
 const out=[];
 for(const [rank,raw] of report.sets.entries()){
  const total=raw.complete_drafts,r=validateReport(raw.feature_research,total);
  if(total<100||r.known_offers<.8*8*total)continue;
  const catalog=raw.deck_sha256&&raw.deck_game_sha256===raw.game_sha256;
  const old=validateCardResearch(raw.card_research,total);
  const candidates=r.cards.filter(x=>!x.ambiguous&&safeName(x.card.name)&&rarity.has(x.card.rarity));
  const push=(row,args)=>{const p=buildPacket(raw,row,rank,args);if(p)out.push(p);};
  for(const row of candidates){
   const c=row.cells,name=row.card.name;
   if(enough(c.fresh,100)&&enough(c.prior,25)&&compare(c,'fresh','prior')>=.20&&['fresh-one','prior-one','fresh-many','prior-many'].every(k=>enough(c[k],10))){
    const gap=compare(c,'fresh','prior'),g1=compare(c,'fresh-one','prior-one'),g2=compare(c,'fresh-many','prior-many');
    // Prespecified two color bins. Admit a meaningful attenuation,
    // reversal, or persistent difference; not a restatement of the raw rate.
    if(Math.max(Math.abs(gap-g1),Math.abs(gap-g2))>=.12||Math.min(g1,g2)>=.15||Math.sign(rate(c.prior)-rate(c.fresh))!==Math.sign(rate(c['prior-many'])-rate(c['fresh-many']))){
     const extra=enough(c['fresh-zero'],30)?[m('fresh-zero','No earlier same-color pick',c['fresh-zero'])]:[];
     const rr=old.cards.find(x=>x.name===name&&!x.ambiguous)?.retention;
     if(catalog&&rr&&rr.single.matched>=50&&rr.multiple.matched>=25&&rr.single.matched>=.8*rr.single.eligible&&rr.multiple.matched>=.8*rr.multiple.eligible){
      extra.push(m('retained-single','One early copy: at least one in deck',{n:rr.single.matched,picked:rr.single.kept,drafts:rr.single.matched}),m('retained-multiple','Multiple early copies: at least two in deck',{n:rr.multiple.matched,picked:rr.multiple.kept,drafts:rr.multiple.matched}));
     }
     push(row,{family:'repeat-context',theme:'duplicates',question:'How much do drafters want another '+name+'?',followUp:'Does the repeat-pick preference survive comparing similar earlier color counts?',primary:[m('fresh','No earlier copy',c.fresh),m('prior','Earlier copy',c.prior)],follow:['fresh-one','prior-one','fresh-many','prior-many'].map((k,i)=>m(k,['One color pick, no copy','One color pick, earlier copy','Two or more, no copy','Two or more, earlier copy'][i],c[k])),extra,heading:'Taking another copy',unit:'Named common offers at picks four through eight; a draft may contribute several.',limits:[laneLimit,'Earlier copies count toward earlier color picks. Color groups do not control pack quality or pick position.',...(extra.some(x=>x.id==='retained-single')?['Last recorded trophy decks only; later copies may contribute. Inclusion is not performance.']:[])],score:gap+Math.max(Math.abs(gap-g1),Math.abs(gap-g2)),reference:'Compare the aggregate repeat association with both prespecified color groups. Explain what changes and why color preference and synergy are different hypotheses. If deck inclusion is supplied, distinguish it from game outcomes. No copy-count win-rate claim.',deck:extra.some(x=>x.id==='retained-single')});
    }
   }
   if(enough(c.opening,45)&&enough(c.fifth,45)&&enough(c['fifth-on'],25)&&enough(c['fifth-off'],25)&&compare(c,'opening','fifth')>=.22&&compare(c,'fifth-on','fifth-off')>=.20){
    push(row,{family:'pick-priority',theme:'colors',question:'When does '+name+' become a priority?',followUp:'At the same fifth pick, does earlier color choice explain the difference?',primary:[m('opening','Opening pick',c.opening),m('fifth','Fifth pick',c.fifth)],follow:[m('fifth-off','No earlier same-color spell',c['fifth-off']),m('fifth-on','Earlier same-color spell',c['fifth-on'])],heading:'Early versus fifth pick',unit:'Named card offered at the first or fifth pick.',limits:[laneLimit,'Pack alternatives change by pick. An earlier same-color spell is not proof of commitment.'],score:compare(c,'opening','fifth')+compare(c,'fifth-on','fifth-off'),reference:'Explore how a named card changes from an opening decision to a developing pool. Test whether the fifth-pick result is driven by already having that color; discuss the particular card role, not general pick timing.'});
   }
   if(['curve-short','curve-full','curve-off'].every(k=>enough(c[k],18))&&compare(c,'curve-short','curve-full')>=.15&&Math.max(compare(c,'curve-off','curve-short'),compare(c,'curve-off','curve-full'))>=.20){
    const on={n:c['curve-short'].n+c['curve-full'].n,picked:c['curve-short'].picked+c['curve-full'].picked,drafts:c['curve-short'].drafts+c['curve-full'].drafts};
    push(row,{family:'curve-need',theme:'curve',question:'When is '+name+' the two-drop you need?',followUp:'Among pools already in its color, do earlier two-drops change demand?',primary:[m('curve-off','No earlier same-color spell',c['curve-off']),m('curve-on','Two or more earlier same-color spells',on)],follow:[m('curve-short','No earlier same-color two-drop',c['curve-short']),m('curve-full','Earlier same-color two-drop',c['curve-full'])],heading:'Demand for the two-drop',unit:'Fifth-pick offers of this creature and a same-color creature costing three or more.',limits:[laneLimit,'The earlier curve comparison uses ordinary same-color two-mana creatures only. Different offered alternatives and spell quality remain.'],score:delta(c['curve-off'],on)+compare(c,'curve-short','curve-full'),reference:'Describe the actual low-cost creature and compare color context first. Then test whether prior two-drops matter within pools with at least two same-color picks. Do not claim the difference is caused by curve.'});
   }
   if(catalog&&enough(c['deck-all'],45)&&enough(c['deck-low'],18)&&enough(c['deck-high'],18)&&compare(c,'deck-low','deck-high')>=.18&&rate(c['deck-all'])<=.9){
    // Compare with the same-color opening card with the most supported
    // matched decks, not the card that maximizes a favorable difference.
    const alt=candidates.filter(x=>x!==row&&x.card.color===row.card.color&&enough(x.cells['deck-all'],45)).sort((a,b)=>b.cells['deck-all'].drafts-a.cells['deck-all'].drafts||a.card.name.localeCompare(b.card.name))[0];
    if(alt&&delta(c['deck-all'],alt.cells['deck-all'])>=.10){
     push(row,{family:'first-pick-deck',theme:'deck-inclusion',question:'How often does '+name+' survive the draft?',followUp:'Does taking more of its color after the first pick change main-deck inclusion?',primary:[m('deck-lead',name,c['deck-all']),m('deck-alt',alt.card.name,alt.cells['deck-all'])],follow:[m('deck-low','Fewer than two later same-color spells',c['deck-low']),m('deck-high','Two or more later same-color spells',c['deck-high'])],heading:'Opening pick in last deck',unit:'One matched trophy draft whose opening card name occurs in the last recorded main deck or sideboard.',limits:[laneLimit,'The later color count covers only picks two through eight. Later copies can contribute; last-deck name inclusion is not a win rate.'],score:delta(c['deck-all'],alt.cells['deck-all'])+compare(c,'deck-low','deck-high'),reference:'Compare two actual same-color opening choices and then examine the lead card within its later color groups. Explain when an opening pick gets left out without inventing a specific reason for individual drafts.',cards:[row.card,alt.card],deck:true});
    }
   }
  }
 }
 // Deterministic bounded topic library: at most the best two cards per
 // set and family, rank by qualified comparisons, never by review outcome.
 const counts=new Map(),seen=new Set();
 return out.sort((a,b)=>b.triage_score-a.triage_score||a.id.localeCompare(b.id)).filter(p=>{
  const k=p.set+'|'+p.feature.family;
  if((counts.get(k)||0)>=2||seen.has(p.id))return false;
  counts.set(k,(counts.get(k)||0)+1);seen.add(p.id);return true;
 });
}
