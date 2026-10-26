// Build the blinded owner review sets for Pack One puzzle selection.
//
// Each review takes matched pairs: one contested puzzle (medium/hard) drawn
// the way the live selector draws it today, and one drawn by the proposed
// stakes rule, from the same set and pick. A review can also add unpaired
// probe puzzles that test a single rule. The rater sees only the shuffled
// puzzles; the key is a separate file fetched after rating. Inputs are checked
// in, so the output is reproducible: rerun this script and the committed
// files must not change. A rated review is frozen; changes need a new version.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodeTrophyDeckCatalog} from '../worker/trophy-decks.mjs';
import {seededRandom} from '../gameplay.mjs';

export const RULE=Object.freeze({
  credible_support_ratio:0.35,
  max_credible_options:3,
  deck_gate_from_pick:4,
  top_share:0.25,
  min_top_pool:3,
});
export const REVIEWS=Object.freeze({
  'puzzle-review-v1':Object.freeze({
    version:'puzzle-review-v1',seed:'pack-one-puzzle-review-2026-10-26',sets:['hob','msh','sos'],
    // Every pick appears once, then the even picks again: 12 pairs, 4 per set.
    pairPicks:[1,2,3,4,5,6,7,8,2,4,6,8],rule:RULE,
  }),
  'puzzle-review-v2':Object.freeze({
    version:'puzzle-review-v2',seed:'pack-one-puzzle-review-v2-2026-10-26',sets:['hob','msh','sos','blb','ecl'],
    // v1 repeated the even picks; v2 repeats picks 5 and 7. 10 pairs, 2 per set.
    pairPicks:[1,2,3,4,5,6,7,8,5,7],rule:Object.freeze({...RULE,no_land_answer_from_pick:5}),
    // Late land answers taken over a top-20% card strong players also rated.
    landProbe:Object.freeze({count:4,from_pick:5,to_pick:8,power_percentile:0.8}),
    excludeReviews:['puzzle-review-v1'],
  }),
});
export const LATEST_REVIEW='puzzle-review-v2';
const ROOT=new URL('../',import.meta.url);
const path=relative=>fileURLToPath(new URL(relative,ROOT));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const roundHalfUp=value=>Math.floor(value+0.5);
export const isLand=card=>/\bLand\b/.test(card?.type_line||'');

export function colours(cost) {return new Set(String(cost||'').match(/[WUBRG]/g)||[]);}

export function parseCsv(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else if(c!=='\r')field+=c;
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const [header,...body]=rows;
  return body.filter(r=>r.length===header.length).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]])));
}

// Smoothed GIH win rate minus the set's average game win rate, in percentage
// points, from the card-strength benchmark's checked-in tables.
export function strengthTable(csv) {
  return new Map(parseCsv(csv).map(r=>[r.name,100*Number(r.A_gih)]));
}

// The strength a card needs to be in the top (1 - share) of its set's table.
export function strengthPercentile(strength,share) {
  const values=[...strength.values()].filter(Number.isFinite).sort((a,b)=>a-b);
  return values[Math.min(values.length-1,Math.floor(share*values.length))];
}

function laneColours(prior) {
  const counts=new Map();
  for(const card of prior)for(const c of colours(card.mana_cost))counts.set(c,(counts.get(c)||0)+1);
  return new Set([...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([c])=>c));
}

// Rough decision type from mana costs versus the prior pool's two main colours.
export function decisionKind(puzzle,credible) {
  if(credible.length<2)return 'single';
  if(!puzzle.prior_picks.length)return 'opening';
  const lane=laneColours(puzzle.prior_picks);
  const fit=card=>{const cc=colours(card.mana_cost);if(!cc.size)return 'any';
    return [...cc].every(c=>lane.has(c))||(cc.size===1&&[...cc].some(c=>lane.has(c)))?'on':[...cc].some(c=>lane.has(c))?'partial':'off';};
  const fits=credible.map(fit),inLane=f=>f==='on'||f==='any';
  if(fits.every(inLane))return 'same-lane';
  if(fits.some(inLane))return 'power-vs-fit';
  return 'off-lane';
}

// Everything the current selector and the proposed rule need for one puzzle.
export function assessPuzzle(puzzle,{strength,mainDeck,rule=RULE}) {
  const ranked=[...puzzle.candidates].sort((a,b)=>b.model_probability-a.model_probability);
  const top=ranked[0].model_probability,ratio=ranked[1].model_probability/top;
  const rating=roundHalfUp(100*ratio);
  const band=rating<50?'easy':rating<80?'medium':'hard';
  const target=ranked.find(c=>c.id===puzzle.historical_pick_id);
  const interesting=ranked.length>=4&&top<=0.75&&ratio>=0.2;
  const serving=Boolean(target)&&roundHalfUp(95*target.model_probability/top)>=20;
  const credible=ranked.filter(c=>c.model_probability>=rule.credible_support_ratio*top).slice(0,rule.max_credible_options);
  const known=credible.map(c=>strength.get(c.name)).filter(Number.isFinite);
  const stakes=known.length?Math.max(...known):null;
  const trophyInMain=Boolean(target)&&(mainDeck.get(target.name)||0)>0;
  const landRule=rule.no_land_answer_from_pick!=null,lateLand=landRule&&puzzle.pick_number>=rule.no_land_answer_from_pick&&isLand(target);
  const contested=band!=='easy';
  const currentEligible=interesting&&serving&&contested;
  const proposedValid=currentEligible&&credible.length>=2&&stakes!==null&&(puzzle.pick_number<rule.deck_gate_from_pick||trophyInMain)&&!lateLand;
  return {puzzle_id:puzzle.puzzle_id,source:puzzle.source_draft_hash,pick:puzzle.pick_number,band,rating,
    current_eligible:currentEligible,proposed_valid:proposedValid,stakes,trophy_in_main_deck:trophyInMain,
    ...(landRule?{trophy_is_land:isLand(target)}:{}),
    trophy_gih_points:target?strength.get(target.name)??null:null,kind:decisionKind(puzzle,credible),
    credible:credible.map(c=>({name:c.name,support_ratio:Number((c.model_probability/top).toFixed(3)),
      gih_points:Number.isFinite(strength.get(c.name))?Number(strength.get(c.name).toFixed(1)):null}))};
}

// Non-land cards the trophy drafter passed over that strong players also
// rated (credible support) and that sit at or above the power threshold.
export function powerCardsPassedOver(puzzle,{strength,threshold,rule=RULE}) {
  const top=Math.max(...puzzle.candidates.map(c=>c.model_probability));
  return puzzle.candidates.filter(c=>c.id!==puzzle.historical_pick_id&&!isLand(c)
    &&c.model_probability>=rule.credible_support_ratio*top&&(strength.get(c.name)??-Infinity)>=threshold)
    .map(c=>({name:c.name,support_ratio:Number((c.model_probability/top).toFixed(3)),gih_points:Number(strength.get(c.name).toFixed(1))}));
}

export function proposedTop(valid,rule=RULE) {
  const ranked=[...valid].sort((a,b)=>b.stakes-a.stakes||a.puzzle_id.localeCompare(b.puzzle_id));
  const size=Math.min(ranked.length,Math.max(rule.min_top_pool,Math.ceil(rule.top_share*ranked.length)));
  return ranked.slice(0,size);
}

// Today's Daily: rounds 1-5 hold one hard among four contested slots, rounds
// 6-8 one hard among three; the puzzle is uniform within the chosen band.
function currentDraw(pool,pick,random) {
  const hardShare=pick>=6?1/3:1/4;
  const preferred=random()<hardShare?'hard':'medium',fallback=preferred==='hard'?'medium':'hard';
  const band=pool.some(x=>x.band===preferred)?preferred:fallback;
  const choices=pool.filter(x=>x.band===band);
  return choices[Math.floor(random()*choices.length)];
}

const loaded=new Map();
function loadSet(setId) {
  if(loaded.has(setId))return loaded.get(setId);
  const corpusBytes=readFileSync(path(`corpus/draft-run/${setId}.json.gz`));
  const strengthBytes=readFileSync(path(`research/card-strength-v1-results/strengths-${setId.toUpperCase()}.csv`));
  const deckModule=readFileSync(path(`corpus/trophy-decks/${setId}.mjs`),'utf8');
  const encoded=deckModule.match(/export const encoded="([^"]+)"/)[1];
  const catalog=decodeTrophyDeckCatalog(encoded);
  const set={setId,puzzles:JSON.parse(gunzipSync(corpusBytes)),strength:strengthTable(strengthBytes.toString('utf8')),catalog,
    hashes:{corpus:sha256(corpusBytes),strength:sha256(strengthBytes),trophy_decks:sha256(Buffer.from(deckModule))}};
  loaded.set(setId,set);
  return set;
}

function mainDeckFor(catalog,source) {
  const index=catalog.sources[source];
  const deck=new Map();
  if(index===undefined)return deck;
  for(const [card,quantity] of catalog.decks[index].deck){const name=catalog.cards[card].name;deck.set(name,(deck.get(name)||0)+quantity);}
  return deck;
}

const cardView=({name,mana_cost,image_url,type_line,rarity,id,model_probability})=>
  ({id,name,mana_cost:mana_cost||'',image_url,type_line:type_line||'',rarity:rarity||'',
    ...(model_probability===undefined?{}:{model_probability})});

// Source drafts a review served, so a later review never repeats them.
export function reviewSources(version,{load=loadSet,setNames={}}={}) {
  const {key}=buildReviewSet(version,{load,setNames});
  const ids=new Set(Object.values(key.items).map(item=>item.puzzle_id));
  return new Set(REVIEWS[version].sets.flatMap(id=>load(id).puzzles.filter(p=>ids.has(p.puzzle_id)).map(p=>p.source_draft_hash)));
}

export function buildReviewSet(version=LATEST_REVIEW,{load=loadSet,setNames={}}={}) {
  const config=REVIEWS[version];
  if(!config)throw Error(`Unknown review version ${version}.`);
  const {seed,rule}=config;
  const random=seededRandom(seed);
  const sets=config.sets.map(load),bySet=new Map(sets.map(s=>[s.setId,s]));
  const excluded=new Set((config.excludeReviews||[]).flatMap(v=>[...reviewSources(v,{load,setNames})]));
  const used=new Set(),items=[],key={},pairs=[],probes=[];
  const blocked=source=>used.has(source)||excluded.has(source);
  const assess=(set,p)=>assessPuzzle(p,{strength:set.strength,mainDeck:mainDeckFor(set.catalog,p.source_draft_hash),rule});
  const addItem=(itemId,set,p)=>items.push({item_id:itemId,set_id:set.setId,set_name:setNames[set.setId]||set.setId.toUpperCase(),pick_number:p.pick_number,
    prior_picks:p.prior_picks.map(cardView),candidates:p.candidates.map(cardView),historical_pick_id:p.historical_pick_id});
  // Land probes are scarce, so they are drawn before the pairs.
  if(config.landProbe) {
    const probe=config.landProbe,thresholds=new Map(sets.map(s=>[s.setId,strengthPercentile(s.strength,probe.power_percentile)]));
    const pool=sets.flatMap(set=>set.puzzles.filter(p=>p.pick_number>=probe.from_pick&&p.pick_number<=probe.to_pick).map(p=>{
      const target=p.candidates.find(c=>c.id===p.historical_pick_id);
      if(!isLand(target))return null;
      const a=assess(set,p),passed=powerCardsPassedOver(p,{strength:set.strength,threshold:thresholds.get(set.setId),rule});
      return a.current_eligible&&a.trophy_in_main_deck&&passed.length?{set,p,a,passed}:null;
    }).filter(Boolean)).sort((x,y)=>x.p.puzzle_id.localeCompare(y.p.puzzle_id));
    for(let n=1;n<=probe.count;n++) {
      const open=pool.filter(x=>!blocked(x.p.source_draft_hash));
      if(!open.length)throw Error(`Only ${n-1} land probes are available.`);
      const x=open[Math.floor(random()*open.length)],probeId=`land-${n}`,itemId=sha256(`${seed}:${probeId}`).slice(0,12);
      used.add(x.p.source_draft_hash);
      addItem(itemId,x.set,x.p);
      const {source,current_eligible,proposed_valid,stakes,...diagnostics}=x.a;
      key[itemId]={arm:'land-probe',probe_id:probeId,...diagnostics,stakes_gih_points:stakes===null?null:Number(stakes.toFixed(1)),
        meets_proposed_rule:proposed_valid,passed_over:x.passed,power_threshold_gih_points:Number(thresholds.get(x.set.setId).toFixed(1)),
        pool:{land_probe_candidates:pool.length}};
      probes.push({probe_id:probeId,set_id:x.set.setId,pick_number:x.p.pick_number,item:itemId});
    }
  }
  config.pairPicks.forEach((pick,index)=>{
    const set=bySet.get(config.sets[index%config.sets.length]);
    const assessed=set.puzzles.filter(p=>p.pick_number===pick).map(p=>({p,a:assess(set,p)}));
    const open=assessed.filter(x=>!blocked(x.p.source_draft_hash));
    const currentPool=open.filter(x=>x.a.current_eligible).map(x=>({...x,band:x.a.band}));
    const valid=open.filter(x=>x.a.proposed_valid);
    const top=proposedTop(valid.map(x=>x.a),rule).map(a=>valid.find(x=>x.a.puzzle_id===a.puzzle_id));
    const proposed=top[Math.floor(random()*top.length)];
    if(!proposed)throw Error(`No proposed candidate for ${set.setId} P1P${pick}.`);
    used.add(proposed.p.source_draft_hash);
    const current=currentDraw(currentPool.filter(x=>!blocked(x.p.source_draft_hash)),pick,random);
    if(!current)throw Error(`No current candidate for ${set.setId} P1P${pick}.`);
    used.add(current.p.source_draft_hash);
    const pairId=`pair-${String(index+1).padStart(2,'0')}`,pool={current_eligible:currentPool.length,proposed_valid:valid.length,proposed_top:top.length};
    const ids={};
    for(const [arm,x] of [['current',current],['proposed',proposed]]) {
      const itemId=sha256(`${seed}:${pairId}:${arm}`).slice(0,12);
      ids[arm]=itemId;
      addItem(itemId,set,x.p);
      const {source,current_eligible,proposed_valid,stakes,...diagnostics}=x.a;
      key[itemId]={arm,pair_id:pairId,...diagnostics,stakes_gih_points:stakes===null?null:Number(stakes.toFixed(1)),
        meets_proposed_rule:proposed_valid,pool};
    }
    pairs.push({pair_id:pairId,set_id:set.setId,pick_number:pick,current:ids.current,proposed:ids.proposed});
  });
  for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  const inputs=Object.fromEntries(sets.map(s=>[s.setId,s.hashes]));
  if(!config.landProbe)return {
    set:{version,items},
    key:{version,seed,rule,pair_picks:config.pairPicks,inputs,pairs,items:key},
  };
  return {
    set:{version,pairs:pairs.length,probes:probes.length,items},
    key:{version,seed,rule,pair_picks:config.pairPicks,land_probe:config.landProbe,excluded_reviews:config.excludeReviews,inputs,pairs,probes,items:key},
  };
}

export const OUTPUT_DIR='admin/puzzle-review';
export const serialize=value=>JSON.stringify(value,null,1)+'\n';

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const names=JSON.parse(readFileSync(path('data/set-display-names.json'),'utf8')).names;
  mkdirSync(path(OUTPUT_DIR),{recursive:true});
  for(const version of process.argv.slice(2).length?process.argv.slice(2):Object.keys(REVIEWS)) {
    const {set,key}=buildReviewSet(version,{setNames:names});
    writeFileSync(path(`${OUTPUT_DIR}/${version}-set.json`),serialize(set));
    writeFileSync(path(`${OUTPUT_DIR}/${version}-key.json`),serialize(key));
    console.log(`Wrote ${version}: ${set.items.length} puzzles, ${key.pairs.length} pairs${key.probes?`, ${key.probes.length} land probes`:''}.`);
  }
}
