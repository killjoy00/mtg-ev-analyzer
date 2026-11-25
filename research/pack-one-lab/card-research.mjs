import {attachStrengthContext} from './card-strength-context.mjs';
// Card-level Lab investigations over the already normalized, complete retained
// trajectories. Only name-level aggregates leave this module, never source IDs,
// packs, player data, model predictions or arbitrary AI-chosen queries.
export const CARD_RESEARCH_VERSION=1;
const MIN_COVERAGE=.8,MAX_CARDS=3000;
const fail=code=>{throw Error('lab-card-research-'+code);};
const int=n=>Number.isSafeInteger(n)&&n>=0;
const ratio=(n,d)=>d?n/d:0;
const percent=(n,d)=>Math.round(1000*n/d)/10;
const byName=(a,b)=>a.name<b.name?-1:a.name>b.name?1:0;
const safeText=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f<>]/.test(v)&&!/https?:\/\//i.test(v);
const raritySet=new Set(['common','uncommon','rare','mythic']);
const counter=()=>({n:0,picked:0});
function tally(c,selected){c.n++;if(selected)c.picked++;}
const spell=c=>c.knownType&&!c.land;
const known=c=>c.knownType&&(c.land||raritySet.has(c.rarity));
const metadata=c=>({name:c.name,rarity:c.rarity,type:c.type||null,mana_cost:c.mana_cost||null});
const shortName=c=>safeText(c.name,65);
const stableKey=c=>JSON.stringify(metadata(c));
function makeEntry(c){
  return {...metadata(c),ambiguous:false,rare:counter(),p1:counter(),p5:counter(),
    repeat:{prior:{...counter(),drafts:0},fresh:{...counter(),drafts:0},stages:Array.from({length:5},()=>({prior:counter(),fresh:counter()}))},
    noncreature:counter(),pairs:new Map(),otherPicks:new Map()};
}
function distinctByName(offered,chosen){
  // Duplicate name printings in one pack count as ONE opportunity. If the
  // chosen printing is one of them, use that printing for the selected name.
  const names=new Map();
  for(const c of offered){
    if(!names.has(c.name)||c.id===chosen.id)names.set(c.name,c);
  }
  return [...names.values()];
}
export function createCardResearch(){
  const entries=new Map();
  let complete=0,rarePacks=0,noncreaturePacks=0,noncreaturePicks=0;
  const knownStages=Array(8).fill(0),typeStages=Array(8).fill(0);
  const get=c=>{
    let v=entries.get(c.name);
    if(!v){v=makeEntry(c);entries.set(c.name,v);}
    else if(stableKey(c)!==stableKey(v))v.ambiguous=true;
    if(entries.size>MAX_CARDS)fail('card-limit');
    return v;
  };
  function observe(picks){
    if(!Array.isArray(picks)||picks.length!==8)fail('trajectory');
    complete++;
    const seen=new Set(),draftPrior=new Set(),draftFresh=new Set();
    for(let i=0;i<8;i++){
      const {offered,chosen}=picks[i],stage=i+1;
      // Track metadata conflicts even when the opportunity does not qualify.
      for(const c of offered)get(c);
      const cards=distinctByName(offered,chosen);
      const typeKnown=offered.every(c=>c.knownType),rarityKnown=offered.every(known);
      if(typeKnown)typeStages[i]++;
      if(rarityKnown)knownStages[i]++;
      const selected=c=>c.name===chosen.name;
      if(stage===1&&rarityKnown){
        const rares=cards.filter(c=>spell(c)&&['rare','mythic'].includes(c.rarity));
        if(rares.length){
          rarePacks++;
          for(const c of cards.filter(c=>spell(c)&&c.rarity==='common')){
            const v=get(c);
            tally(v.rare,selected(c));
            for(const other of rares){
              if(other.name===c.name)continue;
              let pair=v.pairs.get(other.name);
              if(!pair){pair=counter();v.pairs.set(other.name,pair);}
              tally(pair,selected(c));
            }
          }
        }
      }
      if(rarityKnown&&(stage===1||stage===5)){
        for(const c of cards.filter(c=>spell(c)&&['common','uncommon'].includes(c.rarity)))tally(get(c)[stage===1?'p1':'p5'],selected(c));
      }
      if(stage>=4&&rarityKnown){
        for(const c of cards.filter(c=>spell(c)&&c.rarity==='common')){
          const v=get(c),group=seen.has(c.name)?'prior':'fresh';
          tally(v.repeat[group],selected(c));
          tally(v.repeat.stages[stage-4][group],selected(c));
          (group==='prior'?draftPrior:draftFresh).add(c.name);
        }
      }
      if(stage===1&&typeKnown&&cards.some(c=>spell(c)&&c.creature)&&cards.some(c=>spell(c)&&!c.creature)){
        noncreaturePacks++;
        if(spell(chosen)&&!chosen.creature)noncreaturePicks++;
        for(const c of cards.filter(c=>spell(c)&&!c.creature)){
          const v=get(c);tally(v.noncreature,selected(c));
          if(!selected(c)&&v.otherPicks!==null){
            const other=v.otherPicks;
            other.set(chosen.name,(other.get(chosen.name)||0)+1);
            // Keep at most ten distinct alternatives. Only near-unanimous
            // supported cards expose the complete aggregate exceptions.
            if(other.size>10)v.otherPicks=null;
          }
        }
      }
      seen.add(chosen.name);
    }
    for(const name of draftPrior)entries.get(name).repeat.prior.drafts++;
    for(const name of draftFresh)entries.get(name).repeat.fresh.drafts++;
  }
  function finish(){
    const cards=[...entries.values()].sort(byName).map(v=>({
      ...v,otherPicks:v.noncreature.n>=40&&v.noncreature.picked/v.noncreature.n>=.9&&v.noncreature.n-v.noncreature.picked<=10&&v.otherPicks!==null?[...v.otherPicks].map(([name,picked])=>({name,picked})).sort((a,b)=>b.picked-a.picked||byName(a,b)):null,pairs:[...v.pairs].map(([name,c])=>({name,...c})).filter(p=>p.n>=5&&p.picked>=3&&safeText(p.name,100))
        .sort((a,b)=>b.picked-a.picked||b.n-a.n||byName(a,b)).slice(0,3)
    }));
    return {version:CARD_RESEARCH_VERSION,complete,known_stages:knownStages,type_stages:typeStages,
      rare_packs:rarePacks,noncreature_packs:noncreaturePacks,noncreature_picks:noncreaturePicks,cards};
  }
  return {observe,finish};
}
function validCounter(v,max){
  if(!v||!int(v.n)||!int(v.picked)||v.picked>v.n||v.n>max)fail('count');
}
export function validateCardResearch(raw,total){
  if(!raw||raw.version!==CARD_RESEARCH_VERSION||!int(total)||raw.complete!==total||!Array.isArray(raw.cards)||raw.cards.length>MAX_CARDS)fail('report');
  for(const key of ['known_stages','type_stages']){
    if(!Array.isArray(raw[key])||raw[key].length!==8||raw[key].some(n=>!int(n)||n>total))fail('coverage');
  }
  if(raw.known_stages.some((n,i)=>n>raw.type_stages[i]))fail('coverage');
  if(!int(raw.rare_packs)||raw.rare_packs>raw.known_stages[0]||!int(raw.noncreature_packs)||raw.noncreature_packs>raw.type_stages[0]||!int(raw.noncreature_picks)||raw.noncreature_picks>raw.noncreature_packs)fail('opening');
  const names=new Set();
  let noncreaturePicks=0,rarePicks=0;
  for(const v of raw.cards){
    if(!v||!safeText(v.name,160)||names.has(v.name)||typeof v.ambiguous!=='boolean'||v.rarity!==null&&!raritySet.has(v.rarity)||
      v.type!==null&&!safeText(v.type,150)||v.mana_cost!==null&&!safeText(v.mana_cost,150))fail('card');
    names.add(v.name);
    validCounter(v.rare,raw.rare_packs);validCounter(v.p1,raw.known_stages[0]);validCounter(v.p5,raw.known_stages[4]);validCounter(v.noncreature,raw.noncreature_packs);
    noncreaturePicks+=v.noncreature.picked;rarePicks+=v.rare.picked;
    if(!Array.isArray(v.pairs)||v.pairs.length>3||new Set(v.pairs.map(p=>p.name)).size!==v.pairs.length)fail('pairs');
    for(const p of v.pairs){
      if(!safeText(p.name,100)||p.name===v.name)fail('pairs');
      validCounter(p,v.rare.n);
      if(p.picked>v.rare.picked||p.n<5||p.picked<3)fail('pairs');
    }
    if(v.otherPicks!==null){
      if(v.noncreature.n<40||v.noncreature.picked/v.noncreature.n<.9||!Array.isArray(v.otherPicks)||v.otherPicks.length>10||new Set(v.otherPicks.map(c=>c.name)).size!==v.otherPicks.length||v.otherPicks.some(c=>!safeText(c.name,160)||c.name===v.name||!int(c.picked)||!c.picked)||v.otherPicks.reduce((n,c)=>n+c.picked,0)!==v.noncreature.n-v.noncreature.picked||v.noncreature.n-v.noncreature.picked>10)fail('opening-exceptions');
    }
    const rep=v.repeat;
    if(!rep||!Array.isArray(rep.stages)||rep.stages.length!==5)fail('repeat');
    for(const group of ['prior','fresh']){
      const a=rep[group];
      validCounter(a,total*5);
      if(!int(a.drafts)||a.drafts>total||a.drafts>a.n||a.n>a.drafts*5)fail('distinct');
      for(const [i,stage] of rep.stages.entries())validCounter(stage[group],raw.known_stages[i+3]);
      if(rep.stages.reduce((sum,s)=>sum+s[group].n,0)!==a.n||rep.stages.reduce((sum,s)=>sum+s[group].picked,0)!==a.picked)fail('repeat-total');
    }
    for(const [i,s] of rep.stages.entries())if(s.prior.n+s.fresh.n>raw.known_stages[i+3])fail('repeat-overlap');
  }
  if(noncreaturePicks!==raw.noncreature_picks||rarePicks>raw.rare_packs)fail('opening-total');
  for(const v of raw.cards)for(const pair of [...v.pairs,...(v.otherPicks||[])])if(!names.has(pair.name))fail('pair-identity');
  return raw;
}
const metric=(id,label,c)=>({id,label,numerator:c.picked,denominator:c.n,percent:percent(c.picked,c.n)});
const cardInfo=c=>({name:c.name,rarity:c.rarity,type:c.type,mana_cost:c.mana_cost});
const contrast=(a,b)=>ratio(b.picked,b.n)-ratio(a.picked,a.n);
const strongest=(rows,score)=>rows.slice().sort((a,b)=>score(b)-score(a)||byName(a,b));
const sharedLimit='Only retained verified high-win-rate PremierDraft trophy sources with complete first-eight histories. Observations describe choices in offered packs, not win-rate effects or objectively correct picks. The same player may appear in several sources. These exploratory leads are selected for editorial interest, not statistical significance.';
const source='17Lands public PremierDraft data (CC BY 4.0), as retained in the verified Pack One trophy corpus.';
const method='https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md';
const archive='https://www.17lands.com/public_datasets';
function provenance(meta){
  return {attribution:source,method,archive,hashes:{draft:meta.draft_sha256,game:meta.game_sha256}};
}
function setContext(meta,total,coverage){
  return {set:meta.set_name,complete_trajectories:total,metadata_coverage:coverage,corpus_version:meta.corpus_version,source_snapshot_id:meta.source_snapshot_id};
}
function rankValue(signal,support,coverage,rank,context=0){
  // Effect size is capped so small-sample extremes cannot dominate. Reward
  // independent source support, coverage, recency and useful follow-up evidence.
  return Math.round(65+35*Math.min(signal/.45,1)+20*Math.min(support/200,1)+10*coverage+context+(rank<3?20:0)+(5-rank));
}
function makePacket(meta,rank,total,{family,theme,headline,unit,metrics,focus=metrics,supportMetrics=[],context,cards,coverage,support,signal,limits,reference,mode='quick-hit',chartHeading,followup=0}){
  if(!metrics.length||focus.length<1||focus.length>4||new Set(metrics.map(m=>m.id)).size!==metrics.length)fail('metrics');
  return {schema_version:1,id:'corpus-card-'+meta.set_id+'-'+family,series:mode==='quick-hit'?'Draft Note':'Draft Theory',
    headline,set:meta.set_name,kind:'stored-card-analysis',theme,editorial_mode:mode,chart_heading:chartHeading,unit,metrics,
    focus_metrics:focus.map(m=>m.id),support_metrics:supportMetrics.map(m=>m.id),
    cohort:{...setContext(meta,total,coverage),min_source_support:support},
    research_context:{family,cards:cards.map(cardInfo),...context},
    limitations:[...limits,sharedLimit],provenance:provenance(meta),reference,
    triage_score:rankValue(signal,support,coverage,rank,followup),status:'draft-only'};
}
const supported=c=>!c.ambiguous&&shortName(c);
export function namedSetPackets(meta,raw,total,rank){
  const report=validateCardResearch(raw,total),out=[];
  if(!total)return out;
  const eligible=report.cards.filter(supported),coverage=ratio(report.known_stages[0],total);
  if(coverage>=MIN_COVERAGE){
    const ranked=strongest(eligible.filter(c=>c.rarity==='common'&&c.rare.n>=60&&c.rare.picked>=10&&ratio(c.rare.picked,c.rare.n)>=.15),c=>ratio(c.rare.picked,c.rare.n)).slice(0,3);
    if(ranked.length){
      const focus=ranked.map((c,i)=>metric('common-'+i,c.name,c.rare));
      // Named rare examples are actual co-offers, with denominators. Do not
      // describe the small pair counts as head-to-head preference estimates.
      const pairs=ranked.slice(0,1).flatMap(c=>c.pairs.slice(0,2).map((p,i)=>({card:c.name,rare:p.name,metric:metric('rare-example-'+i,c.name+' with '+p.name,p)})));
      const supporting=pairs.map(p=>p.metric);
      out.push(makePacket(meta,rank,total,{family:'commons-over-rares',theme:'rarity',headline:'Commons trophy drafters take when a rare is available',
        unit:'one opening pack containing the named common and at least one rare or mythic nonland spell',metrics:[...focus,...supporting],focus,supportMetrics:supporting,
        cards:ranked,context:{rare_examples:pairs.map(({card,rare,metric})=>({card,rare,selected:metric.numerator,co_offered:metric.denominator})),
          rare_eligible_packs:report.rare_packs},coverage,support:Math.min(...ranked.map(c=>c.rare.n)),signal:ratio(ranked[0].rare.picked,ranked[0].rare.n),
        chartHeading:'P1P1 · Common chosen',limits:['Each card rate conditions on that common and a rare or mythic nonland being offered; packs can contain several qualifying commons or rares. Small named co-offer examples are descriptive, not pairwise win rates or general card rankings.'],
        reference:'Lead with the most interesting named common and actual rare co-offers if present. Explain what the observed choices show without inventing card abilities. A short useful note is enough.',followup:pairs.length?8:0}));
    }
  }
  const stageCoverage=Math.min(coverage,ratio(report.known_stages[4],total));
  if(stageCoverage>=MIN_COVERAGE){
    const ranked=strongest(eligible.filter(c=>['common','uncommon'].includes(c.rarity)&&c.p1.n>=45&&c.p5.n>=45&&c.p5.picked>=10&&contrast(c.p1,c.p5)>=.25),c=>contrast(c.p1,c.p5)).slice(0,2);
    if(ranked.length){
      const focus=ranked.flatMap((c,i)=>[metric('stage-'+i+'-1','P1P1 — '+c.name,c.p1),metric('stage-'+i+'-5','P1P5 — '+c.name,c.p5)]);
      const supporting=[];
      for(const rarity of [...new Set(ranked.map(c=>c.rarity))]){
        // Pooled card-offer baseline: every named card opportunity counts,
        // not one source per pack. It is context, not a causal adjustment.
        const all=report.cards.filter(c=>!c.ambiguous&&c.rarity===rarity);
        for(const stage of [1,5]){
          const key=stage===1?'p1':'p5';
          const cell=all.reduce((a,c)=>({n:a.n+c[key].n,picked:a.picked+c[key].picked}),counter());
          if(cell.n) supporting.push(metric('baseline-'+rarity+'-'+stage,'P1P'+stage+' — all '+rarity+' offers',cell));
        }
      }
      out.push(makePacket(meta,rank,total,{family:'pick-five-priorities',theme:'pick-timing',headline:'Which cards become priorities by pick five?',
        unit:'one qualifying card opportunity per real pick position and source draft',metrics:[...focus,...supporting],focus,supportMetrics:supporting,cards:ranked,context:{stages:[1,5]},coverage:stageCoverage,
        support:Math.min(...ranked.flatMap(c=>[c.p1.n,c.p5.n])),signal:contrast(ranked[0].p1,ranked[0].p5),chartHeading:'Card selection by pick',
        limits:['Same named card offered at P1P1 versus P1P5. Different packs, fewer remaining cards and developing pools can explain the difference; it does not show the card became intrinsically stronger or should be passed early. The pooled rarity baseline counts card offers rather than unique drafts; it is context, not a causal adjustment.'],
        reference:'Contrast the named cards, not a general statement about later picks. The result is a selection-rate change, not a causal effect or card-quality ranking.'}));
    }
  }
  const repeatCoverage=Math.min(...report.known_stages.slice(3).map(n=>ratio(n,total)));
  if(repeatCoverage>=MIN_COVERAGE){
    const qualified=eligible.filter(c=>c.rarity==='common'&&c.repeat.prior.drafts>=25&&c.repeat.fresh.drafts>=100);
    const candidates=qualified.filter(c=>c.repeat.prior.picked+c.repeat.fresh.picked>=10&&Math.abs(contrast(c.repeat.fresh,c.repeat.prior))>=.20);
    const ranked=strongest(candidates,c=>Math.abs(contrast(c.repeat.fresh,c.repeat.prior))).slice(0,2);
    if(ranked.length){
      const focus=ranked.flatMap((c,i)=>[metric('repeat-'+i+'-fresh',c.name+' — no prior copy',c.repeat.fresh),metric('repeat-'+i+'-prior',c.name+' — prior copy',c.repeat.prior)]);
      // Follow up at a fixed pick number, when both strata have enough
      // observations. Use the largest joint sample, not largest effect.
      const lead=ranked[0],checks=lead.repeat.stages.map((s,i)=>({...s,stage:i+4})).filter(s=>s.prior.n>=10&&s.fresh.n>=30)
        .sort((a,b)=>Math.min(b.prior.n,b.fresh.n)-Math.min(a.prior.n,a.fresh.n)||a.stage-b.stage);
      const check=checks[0],supporting=check?[metric('repeat-fixed-fresh','P1P'+check.stage+' — no prior copy',check.fresh),metric('repeat-fixed-prior','P1P'+check.stage+' — prior copy',check.prior)]:[];
      out.push(makePacket(meta,rank,total,{family:'repeat-card-context',theme:'duplicates',headline:'Which commons get picked again?',
        unit:'one named common opportunity at P1P4–P1P8; a draft can contribute multiple opportunities',metrics:[...focus,...supporting],focus,supportMetrics:supporting,cards:ranked,
        context:{distinct_drafts:ranked.map(c=>({card:c.name,with_prior:c.repeat.prior.drafts,without_prior:c.repeat.fresh.drafts})),qualified_cards:qualified.length,
          positive_cards:qualified.filter(c=>contrast(c.repeat.fresh,c.repeat.prior)>0).length,
          large_difference_cards:candidates.length,fixed_stage_check:check?{card:lead.name,stage:check.stage}:null},coverage:repeatCoverage,
        support:Math.min(...ranked.flatMap(c=>[c.repeat.prior.drafts,c.repeat.fresh.drafts])),signal:Math.abs(contrast(lead.repeat.fresh,lead.repeat.prior)),
        chartHeading:'Selection with a prior copy',mode:'draft-decision',limits:['A prior copy means the exact name was picked earlier in the recorded trajectory, not that it made the deck. Pooled opportunities can overlap within drafts and groups. Prior preferences, color commitment, synergy, pick position and available alternatives can explain the association. A fixed-pick check, if shown, only controls pick position.'],
        reference:'Focus on the named commons with the largest supported differences. Discuss why prior preference and a developing pool may explain the pattern. Do not assert that an extra copy causes a change in demand or that any card has a specific unverified ability.',followup:check?8:0}));
    }
  }
  const noncreature=noncreatureSummary(meta,report,total,rank);
  if(noncreature){
    const top=noncreature.top.filter(c=>supported(c)&&c.noncreature.n>=30&&c.noncreature.picked>=10).slice(0,3);
    if(top.length>=2){
      const focus=top.map((c,i)=>metric('spell-'+i,c.name,c.noncreature));
      const supporting=top.map((c,i)=>metric('spell-share-'+i,c.name+' — share of spell picks',{n:report.noncreature_picks,picked:c.noncreature.picked}));
      const signal=top.reduce((sum,c)=>sum+c.noncreature.picked,0)/report.noncreature_picks;
      const exceptions=top.filter(c=>Array.isArray(c.otherPicks)&&c.otherPicks.length).map(c=>({card:c.name,offered:c.noncreature.n,selected:c.noncreature.picked,alternatives:c.otherPicks}));
      if(signal>=.10)out.push(makePacket(meta,rank,total,{family:'opening-spells',theme:'card-type',headline:'The noncreature spells shaping opening picks',
        unit:'one qualifying opening pack containing the named noncreature spell and a creature; spell-share denominator is noncreature nonland picks in that opening cohort',
        metrics:[...focus,...supporting],focus,supportMetrics:supporting,cards:top,
        context:{noncreature_picks:report.noncreature_picks,qualifying_openings:report.noncreature_packs,near_unanimous_exceptions:exceptions},coverage:noncreature.coverage,
        support:Math.min(...top.map(c=>c.noncreature.n)),signal,chartHeading:'P1P1 · Named spells',mode:'draft-decision',
        limits:['Printed type line defines noncreature spells, not their role or whether they generate creatures. Card selection when offered and share of all noncreature choices are different denominators. Frequency of appearing, rarity and alternative card strength influence these counts.'],
        reference:'Name the actual noncreature spells selected and distinguish the opportunity rate from their contribution to all noncreature selections. When near-unanimous exceptions are present, those actual other selections can be the specific lead. Do not turn the pattern into a recommendation to avoid creatures.',followup:5+(exceptions.length?8:0)}));
    }
  }
  return out;
}
export function noncreatureSummary(meta,raw,total,rank){
  const coverage=ratio(raw.type_stages[0],total);
  if(!total||coverage<MIN_COVERAGE||raw.noncreature_picks<100)return null;
  // All names, not just commons or supported chart labels, determine the top
  // five. Ties resolve by exact name. Reject ambiguous leaders.
  const top=strongest(raw.cards.filter(c=>c.noncreature.picked>0),c=>c.noncreature.picked).slice(0,5);
  if(top.length!==5||top.some(c=>c.ambiguous||!shortName(c)))return null;
  return {meta,total,rank,coverage,top,picked:top.reduce((n,c)=>n+c.noncreature.picked,0),n:raw.noncreature_picks};
}
export function concentrationPacket(summaries){
  const recent=summaries.filter(s=>s&&s.rank<3).sort((a,b)=>a.rank-b.rank);
  if(recent.length<2)return null;
  const shares=recent.map(s=>ratio(s.picked,s.n)),spread=Math.max(...shares)-Math.min(...shares);
  if(spread<.12)return null;
  const metrics=recent.map(s=>metric(s.meta.set_id,s.meta.set_name,{n:s.n,picked:s.picked}));
  const withoutLeader=recent.map(s=>metric(s.meta.set_id+'-without-leader',s.meta.set_name+' — excluding leading card',{n:s.n-s.top[0].noncreature.picked,picked:s.picked-s.top[0].noncreature.picked}));
  const coverage=Math.min(...recent.map(s=>s.coverage)),support=Math.min(...recent.map(s=>s.n));
  const hashes=Object.fromEntries(recent.flatMap(({meta})=>[[meta.set_id+'_draft',meta.draft_sha256],[meta.set_id+'_game',meta.game_sha256]]));
  return {schema_version:1,id:'corpus-card-compare-concentration-'+metrics.map(m=>m.id).join('-'),series:'Format Deep Dive',
    headline:'Do a handful of spells dominate first picks?',set:recent[0].meta.set_name,sets:recent.map(s=>s.meta.set_name),
    kind:'stored-card-comparison',theme:'card-type',editorial_mode:'format-comparison',chart_heading:'Top five share of spell picks',
    unit:'one noncreature nonland opening pick in a pack also containing a creature, per source draft and set',metrics:[...metrics,...withoutLeader],focus_metrics:metrics.map(m=>m.id),support_metrics:withoutLeader.map(m=>m.id),
    cohort:{sets:recent.map(s=>setContext(s.meta,s.total,s.coverage))},
    research_context:{family:'opening-spell-concentration',cards:recent.flatMap(s=>s.top.map(cardInfo)),leaders:recent.map(s=>({set:s.meta.set_name,cards:s.top.map(c=>({name:c.name,picks:c.noncreature.picked})),total_spell_picks:s.n}))},
    limitations:['Top five names are ranked independently by observed noncreature opening-pick counts in each set. The five names differ by set. The follow-up removes the leading card from numerator and denominator in each set, measuring the next four among remaining spell picks. Differences in set size, rarity, card availability and card types can affect the observed concentration.',sharedLimit],
    provenance:{attribution:source,method,archive,hashes},
    reference:'Identify the actual leading spells in each recent set and explain the descriptive concentration difference. It is not evidence that any format rewards a particular card type more.',
    triage_score:rankValue(spread,support,coverage,0,10),status:'draft-only'};
}
export function cardResearchPackets(report){
  if(!report||report.kind!=='stored-corpus'||!Array.isArray(report.sets)||report.sets.length>5)fail('sets');
  const out=[],summaries=[],seen=new Set();
  for(const [rank,raw] of report.sets.entries()){
    if(!raw||seen.has(raw.set_id)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.set_id||'')||!safeText(raw.set_name,150)||
      !safeText(raw.corpus_version,150)||![raw.source_snapshot_id,raw.draft_sha256,raw.game_sha256].every(v=>/^[a-f0-9]{64}$/.test(v||'')))fail('identity');
    seen.add(raw.set_id);
    out.push(...namedSetPackets(raw,raw.card_research,raw.complete_drafts,rank).map(p=>attachStrengthContext(p,raw,raw.strength_context)));
    summaries.push(noncreatureSummary(raw,raw.card_research,raw.complete_drafts,rank));
  }
  const compare=concentrationPacket(summaries);
  if(compare)out.push(compare);
  return out.sort((a,b)=>b.triage_score-a.triage_score||(a.id<b.id?-1:a.id>b.id?1:0));
}
