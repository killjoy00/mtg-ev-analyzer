// Build the blinded owner review set for Pack One puzzle selection.
//
// Twelve matched pairs: each pair takes one contested puzzle (medium/hard)
// drawn the way the live selector draws it today, and one drawn by the
// proposed stakes rule, from the same set and pick. The rater sees only the
// shuffled puzzles; the arm key is a separate file fetched after rating.
// Inputs are checked in, so the output is reproducible: rerun this script
// and the committed files must not change.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {decodeTrophyDeckCatalog} from '../worker/trophy-decks.mjs';
import {seededRandom} from '../gameplay.mjs';

export const REVIEW_VERSION='puzzle-review-v1';
export const REVIEW_SEED='pack-one-puzzle-review-2026-10-26';
export const REVIEW_SETS=Object.freeze(['hob','msh','sos']);
// Every pick appears once, then the even picks again: 12 pairs, 4 per set.
export const PAIR_PICKS=Object.freeze([1,2,3,4,5,6,7,8,2,4,6,8]);
export const RULE=Object.freeze({
  credible_support_ratio:0.35,
  max_credible_options:3,
  deck_gate_from_pick:4,
  top_share:0.25,
  min_top_pool:3,
});
const ROOT=new URL('../',import.meta.url);
const path=relative=>fileURLToPath(new URL(relative,ROOT));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const roundHalfUp=value=>Math.floor(value+0.5);

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
export function assessPuzzle(puzzle,{strength,mainDeck}) {
  const ranked=[...puzzle.candidates].sort((a,b)=>b.model_probability-a.model_probability);
  const top=ranked[0].model_probability,ratio=ranked[1].model_probability/top;
  const rating=roundHalfUp(100*ratio);
  const band=rating<50?'easy':rating<80?'medium':'hard';
  const target=ranked.find(c=>c.id===puzzle.historical_pick_id);
  const interesting=ranked.length>=4&&top<=0.75&&ratio>=0.2;
  const serving=Boolean(target)&&roundHalfUp(95*target.model_probability/top)>=20;
  const credible=ranked.filter(c=>c.model_probability>=RULE.credible_support_ratio*top).slice(0,RULE.max_credible_options);
  const known=credible.map(c=>strength.get(c.name)).filter(Number.isFinite);
  const stakes=known.length?Math.max(...known):null;
  const trophyInMain=Boolean(target)&&(mainDeck.get(target.name)||0)>0;
  const contested=band!=='easy';
  const currentEligible=interesting&&serving&&contested;
  const proposedValid=currentEligible&&credible.length>=2&&stakes!==null&&(puzzle.pick_number<RULE.deck_gate_from_pick||trophyInMain);
  return {puzzle_id:puzzle.puzzle_id,source:puzzle.source_draft_hash,pick:puzzle.pick_number,band,rating,
    current_eligible:currentEligible,proposed_valid:proposedValid,stakes,trophy_in_main_deck:trophyInMain,
    trophy_gih_points:target?strength.get(target.name)??null:null,kind:decisionKind(puzzle,credible),
    credible:credible.map(c=>({name:c.name,support_ratio:Number((c.model_probability/top).toFixed(3)),
      gih_points:Number.isFinite(strength.get(c.name))?Number(strength.get(c.name).toFixed(1)):null}))};
}

export function proposedTop(valid) {
  const ranked=[...valid].sort((a,b)=>b.stakes-a.stakes||a.puzzle_id.localeCompare(b.puzzle_id));
  const size=Math.min(ranked.length,Math.max(RULE.min_top_pool,Math.ceil(RULE.top_share*ranked.length)));
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

function loadSet(setId) {
  const corpusBytes=readFileSync(path(`corpus/draft-run/${setId}.json.gz`));
  const strengthBytes=readFileSync(path(`research/card-strength-v1-results/strengths-${setId.toUpperCase()}.csv`));
  const deckModule=readFileSync(path(`corpus/trophy-decks/${setId}.mjs`),'utf8');
  const encoded=deckModule.match(/export const encoded="([^"]+)"/)[1];
  const catalog=decodeTrophyDeckCatalog(encoded);
  return {setId,puzzles:JSON.parse(gunzipSync(corpusBytes)),strength:strengthTable(strengthBytes.toString('utf8')),catalog,
    hashes:{corpus:sha256(corpusBytes),strength:sha256(strengthBytes),trophy_decks:sha256(Buffer.from(deckModule))}};
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

export function buildReviewSet({sets=REVIEW_SETS.map(loadSet),setNames={}}={}) {
  const random=seededRandom(REVIEW_SEED);
  const bySet=new Map(sets.map(s=>[s.setId,s]));
  const used=new Set(),items=[],key={},pairs=[];
  PAIR_PICKS.forEach((pick,index)=>{
    const set=bySet.get(REVIEW_SETS[index%REVIEW_SETS.length]);
    const assessed=set.puzzles.filter(p=>p.pick_number===pick).map(p=>({p,a:assessPuzzle(p,{strength:set.strength,mainDeck:mainDeckFor(set.catalog,p.source_draft_hash)})}));
    const open=assessed.filter(x=>!used.has(x.p.source_draft_hash));
    const currentPool=open.filter(x=>x.a.current_eligible).map(x=>({...x,band:x.a.band}));
    const valid=open.filter(x=>x.a.proposed_valid);
    const top=proposedTop(valid.map(x=>x.a)).map(a=>valid.find(x=>x.a.puzzle_id===a.puzzle_id));
    const proposed=top[Math.floor(random()*top.length)];
    if(!proposed)throw Error(`No proposed candidate for ${set.setId} P1P${pick}.`);
    used.add(proposed.p.source_draft_hash);
    const current=currentDraw(currentPool.filter(x=>!used.has(x.p.source_draft_hash)),pick,random);
    if(!current)throw Error(`No current candidate for ${set.setId} P1P${pick}.`);
    used.add(current.p.source_draft_hash);
    const pairId=`pair-${String(index+1).padStart(2,'0')}`,pool={current_eligible:currentPool.length,proposed_valid:valid.length,proposed_top:top.length};
    const ids={};
    for(const [arm,x] of [['current',current],['proposed',proposed]]) {
      const itemId=sha256(`${REVIEW_SEED}:${pairId}:${arm}`).slice(0,12);
      ids[arm]=itemId;
      items.push({item_id:itemId,set_id:set.setId,set_name:setNames[set.setId]||set.setId.toUpperCase(),pick_number:pick,
        prior_picks:x.p.prior_picks.map(cardView),candidates:x.p.candidates.map(cardView),historical_pick_id:x.p.historical_pick_id});
      const {source,current_eligible,proposed_valid,stakes,...diagnostics}=x.a;
      key[itemId]={arm,pair_id:pairId,...diagnostics,stakes_gih_points:stakes===null?null:Number(stakes.toFixed(1)),
        meets_proposed_rule:proposed_valid,pool};
    }
    pairs.push({pair_id:pairId,set_id:set.setId,pick_number:pick,current:ids.current,proposed:ids.proposed});
  });
  for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  const inputs=Object.fromEntries(sets.map(s=>[s.setId,s.hashes]));
  return {
    set:{version:REVIEW_VERSION,items},
    key:{version:REVIEW_VERSION,seed:REVIEW_SEED,rule:RULE,pair_picks:PAIR_PICKS,inputs,pairs,items:key},
  };
}

export const OUTPUT_DIR='admin/puzzle-review';
export const serialize=value=>JSON.stringify(value,null,1)+'\n';

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const names=JSON.parse(readFileSync(path('data/set-display-names.json'),'utf8')).names;
  const {set,key}=buildReviewSet({setNames:names});
  mkdirSync(path(OUTPUT_DIR),{recursive:true});
  writeFileSync(path(`${OUTPUT_DIR}/${REVIEW_VERSION}-set.json`),serialize(set));
  writeFileSync(path(`${OUTPUT_DIR}/${REVIEW_VERSION}-key.json`),serialize(key));
  console.log(`Wrote ${set.items.length} puzzles in ${key.pairs.length} pairs to ${OUTPUT_DIR}/.`);
}
