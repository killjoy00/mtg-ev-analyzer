// Lab research from already retained, verified trophy decisions. No raw archive
// download, player/account reads, scoring weights or external API calls.
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {catalogLoaders} from '../../corpus/trophy-decks/index.mjs';
import {decodeTrophyDeckCatalog} from '../../worker/trophy-decks.mjs';
import {articleHash} from '../../worker/lab-editorial.mjs';

export const MIN_DRAFTS=100,MIN_COVERAGE=.8,MAX_SETS=6,MAX_ROWS=80000;
const method='https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md';
const source='17Lands public PremierDraft data (CC BY 4.0), as retained in the verified Pack One trophy corpus and, when used, its last-recorded-game deck catalogs.';
const publicData='https://www.17lands.com/public_datasets';
const HEX=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error('lab-corpus-'+code);};
const integer=(x,min=0)=>Number.isSafeInteger(x)&&x>=min;
const count=x=>{if(!integer(x))fail('count');return x;};
const pct=(n,d)=>Math.round(1000*n/d)/10;
const knownRarity=new Set(['common','uncommon','rare','mythic']);
const specs={
  'rarity-choice':{title:'When Do Trophy Drafters Pass Rares for Commons?',theme:'rarity',stages:[1,5],labels:['Common spell','Rare or mythic spell','Other card'],focus:0,series:'Draft Theory',
    hook:'Imagine opening a rare and a common you like. How much should that rarity symbol matter?',
    limit:'Both common and rare/mythic nonland alternatives must be offered. Rarity is not a measure of card strength; offered alternatives and pack sizes differ by pick.'},
  'color-pivot':{title:'When Are Trophy Drafters Willing to Try a New Color?',theme:'colors',stages:[3,6],labels:['Same-color spell','New-color spell','Other card'],focus:1,series:'Draft Theory',
    hook:'Imagine your early spells all point toward black, but a blue spell arrives beside a black playable. How willing are you to take the blue card?',
    limit:'At least two prior ordinary colored spells must require the same single color, and both same-color and different-color mono-color spells must be offered. A new-color pick does not establish abandonment or a correct pivot.'},
  'colorless-flex':{title:'When Do Trophy Drafters Take Generic-Mana Spells?',theme:'flexibility',stages:[1,5],labels:['Generic-mana spell','Colored spell','Other card'],focus:0,series:'Draft Theory',
    hook:'Imagine a spell with a generic mana cost competing with a colored spell. How much is flexibility worth early in a draft?',
    limit:'Only simple printed mana costs and single-face cards are classified. Generic cost is not proof of strategic flexibility or lack of color-dependent abilities.'},
  'two-drop':{title:'When Do Trophy Drafters Prioritize Two-Drops?',theme:'curve',stages:[1,5],labels:['Two-mana creature','Creature costing three or more','Other card'],focus:0,series:'Draft Theory',
    hook:'Imagine choosing between a two-mana creature and a more expensive creature. When does the curve matter more than the bigger card?',
    limit:'Both ordinary two-mana and higher-cost creature options must be offered. Printed mana cost is a proxy; alternate costs, quality, roles and play patterns are not evaluated.'},
  'first-pick-last-deck':{title:'How Often Does the First Pick Make the Last Recorded Deck?',theme:'deck-inclusion',stages:[1],labels:['First-pick name in main deck','First-pick name only in sideboard'],focus:1,series:'Draft Theory',deck:true,
    hook:'Imagine taking a card first, then discovering a better direction. How willing are you to leave your opening pick out of the deck?',
    limit:'Only matched last-recorded PremierDraft decks where the opening pick name is present in the main deck or sideboard are counted. This is exact name-level inclusion, not copy-level inclusion, first-game inclusion, or a guarantee of the event-final deck.'},
  'last-deck-splash':{title:'How Often Do Trophy Drafters Splash?',theme:'mana',stages:[1],labels:['Last recorded deck has a recorded splash','No recorded splash'],focus:0,series:'Format Deep Dive',deck:true,
    hook:'Imagine a promising two-color pool with a tempting off-color spell. When do you invest in a splash?',
    limit:'One last recorded PremierDraft deck per matched source draft. Uses the stored recorded splash-color field, not a reconstructed mana base. It is not game-weighted, and it does not show whether splashing improved results.'}
};

function card(c){
  if(!c||typeof c.id!=='string'||!c.id||typeof c.name!=='string'||!c.name)return null;
  const type=typeof c.type_line==='string'?c.type_line.split(' — ')[0].trim():'';
  const knownType=type.length>0&&!type.includes('//');
  const land=knownType&&/(^|\s)Land($|\s)/.test(type);
  const rarity=knownRarity.has(c.rarity)?c.rarity:null;
  const isSimple=knownType&&!land&&c.multi_face===false&&typeof c.mana_cost==='string'&&/^(?:\{(?:[0-9]+|[WUBRG])\})+$/.test(c.mana_cost);
  let colors=null,mana=null;
  if(isSimple){
    const tokens=[...c.mana_cost.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
    colors=[...new Set(tokens.filter(t=>/^[WUBRG]$/.test(t)))].sort();
    mana=tokens.reduce((sum,t)=>sum+(/^[0-9]+$/.test(t)?Number(t):1),0);
    if(!integer(mana)||mana>99){colors=null;mana=null;}
  }
  return {id:c.id,name:c.name,knownType,land,rarity,colors,mana,creature:knownType&&/(^|\s)Creature($|\s)/.test(type)};
}
function observation(id,p,prior,deck){
  const {chosen,offered}=p;
  if(id==='first-pick-last-deck'){
    if(!deck)return null;
    const name=chosen.name.normalize('NFC').toLowerCase();
    return deck.main.has(name)?0:deck.side.has(name)?1:null;
  }
  if(id==='last-deck-splash'){
    if(!deck||typeof deck.splash!=='string'||!(/^[WUBRG]*$/).test(deck.splash))return null;
    return deck.splash?0:1;
  }
  // undefined = known, but no qualifying opportunity; null = unknown.
  if(id==='rarity-choice'){
    if(offered.some(c=>!c.knownType||(!c.land&&!c.rarity)))return null;
    const classify=c=>!c.land&&c.rarity==='common'?0:!c.land&&['rare','mythic'].includes(c.rarity)?1:2;
    const alternatives=new Set(offered.map(classify));
    return alternatives.has(0)&&alternatives.has(1)?classify(chosen):undefined;
  }
  if(offered.some(c=>!c.knownType||(!c.land&&c.colors===null)))return null;
  if(id==='color-pivot'){
    if(prior.some(c=>!c.knownType||(!c.land&&c.colors===null)))return null;
    const colored=prior.filter(c=>c.colors?.length);
    const colors=new Set(colored.flatMap(c=>c.colors));
    if(colored.length<2||colors.size!==1)return undefined;
    const color=[...colors][0],classify=c=>c.colors?.length===1?(c.colors[0]===color?0:1):2;
    const alternatives=new Set(offered.map(classify));
    return alternatives.has(0)&&alternatives.has(1)?classify(chosen):undefined;
  }
  const classify=id==='colorless-flex'
    ?c=>!c.land&&c.colors?.length===0?0:c.colors?.length?1:2
    :c=>c.creature&&c.mana===2?0:c.creature&&c.mana>=3?1:2;
  const alternatives=new Set(offered.map(classify));
  return alternatives.has(0)&&alternatives.has(1)?classify(chosen):undefined;
}
function initCell(stage,s){return {stage,eligible:0,known:0,counts:s.labels.map(()=>0)};}
function deckFor(catalog,sourceHash){
  if(!catalog||!Object.hasOwn(catalog.sources,sourceHash))return null;
  const deck=catalog.decks[catalog.sources[sourceHash]];
  if(deck?.event_type!=='PremierDraft'||!integer(deck.size,40))return null;
  const names=values=>{
    if(!Array.isArray(values))return null;
    const out=new Set();
    for(const item of values){
      if(!Array.isArray(item)||!integer(item[0])||!integer(item[1],1))return null;
      const name=catalog.cards[item[0]]?.name;
      if(typeof name!=='string'||!name)return null;
      out.add(name.normalize('NFC').toLowerCase());
    }
    return out;
  };
  const main=names(deck.deck),side=names(deck.sideboard);
  return main&&side?{main,side,splash:deck.splash_colors}:null;
}
export async function readStoredDeckCatalog(setId){
  const load=catalogLoaders[setId];
  if(typeof load!=='function')return null;
  const {encoded,sha256}=await load();
  if(typeof encoded!=='string'||!HEX.test(sha256||'')||createHash('sha256').update(brotliDecompressSync(Buffer.from(encoded,'base64'))).digest('hex')!==sha256)fail('deck-catalog-hash');
  const catalog=decodeTrophyDeckCatalog(encoded);
  if(catalog.set_id!==setId)fail('deck-catalog-identity');
  return {catalog,sha256};
}
function identity(meta){
  if(!meta||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.set_id||'')||typeof meta.set_name!=='string'||!meta.set_name.trim()||meta.set_name.length>150||
    typeof meta.corpus_version!=='string'||!meta.corpus_version||!HEX.test(meta.source_snapshot_id||'')||!HEX.test(meta.draft_sha256||'')||!HEX.test(meta.game_sha256||''))fail('source-identity');
  return {set_id:meta.set_id,set_name:meta.set_name,corpus_version:meta.corpus_version,source_snapshot_id:meta.source_snapshot_id,draft_sha256:meta.draft_sha256,game_sha256:meta.game_sha256};
}
export function summarizeStoredSet(meta,rows,deckInput=null){
  const provenance=identity(meta);
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)fail('row-limit');
  const groups=new Map();
  for(const r of rows){
    if(!/^[a-f0-9]{32}$/.test(r.source_draft_hash||'')||!integer(r.pick_number,1)||r.pick_number>8)fail('row-identity');
    const group=groups.get(r.source_draft_hash)||new Map();
    if(group.has(r.pick_number))fail('duplicate-pick');
    const offered=Array.isArray(r.candidates)?r.candidates.map(card):[];
    const chosen=offered.find(c=>c?.id===r.historical_pick_id);
    const valid=offered.length>=2&&offered.every(Boolean)&&new Set(offered.map(c=>c.id)).size===offered.length&&chosen;
    group.set(r.pick_number,valid?{chosen,offered}:null);
    groups.set(r.source_draft_hash,group);
  }
  const analyses=Object.entries(specs).map(([id,s])=>({id,stages:s.stages.map(stage=>initCell(stage,s))}));
  let complete=0;
  const catalog=deckInput?.catalog;
  if(deckInput&&(!HEX.test(deckInput.sha256||'')||catalog?.set_id!==meta.set_id))fail('deck-input');
  for(const [hash,group] of groups){
    const picks=Array.from({length:8},(_,i)=>group.get(i+1));
    if(picks.some(x=>!x))continue;
    complete++;
    const deck=deckFor(catalog,hash);
    for(const analysis of analyses){
      for(const cell of analysis.stages){
        cell.eligible++;
        const i=cell.stage-1;
        const answer=observation(analysis.id,picks[i],picks.slice(0,i).map(p=>p.chosen),deck);
        if(answer!==null){cell.known++;if(answer!==undefined)cell.counts[answer]++;}
      }
    }
  }
  return {...provenance,source_drafts:groups.size,complete_drafts:complete,deck_sha256:deckInput?.sha256||null,analyses};
}
export function storedCorpusPackets(report){
  if(report?.schema_version!==1||report.kind!=='stored-corpus'||!Array.isArray(report.sets)||report.sets.length>MAX_SETS)fail('report');
  const packets=[],seen=new Set();
  for(const [rank,raw] of report.sets.entries()){
    const meta=identity(raw);
    if(seen.has(meta.set_id))fail('duplicate-set');seen.add(meta.set_id);
    const total=count(raw.complete_drafts);
    if(total>count(raw.source_drafts)||raw.deck_sha256!==null&&!HEX.test(raw.deck_sha256||''))fail('coverage');
    if(!Array.isArray(raw.analyses)||raw.analyses.length!==Object.keys(specs).length||new Set(raw.analyses.map(x=>x.id)).size!==Object.keys(specs).length)fail('analyses');
    for(const analysis of raw.analyses){
      const s=specs[analysis.id];
      if(!s||!Array.isArray(analysis.stages)||analysis.stages.length!==s.stages.length)fail('analysis');
      const rows=analysis.stages.map((row,i)=>{
        if(row.stage!==s.stages[i]||row.eligible!==total||count(row.known)>total||
           !Array.isArray(row.counts)||row.counts.length!==s.labels.length)fail('cell');
        const n=row.counts.map(count).reduce((a,b)=>a+b,0);
        if(n>row.known||s.deck&&n!==row.known||s.deck&&!raw.deck_sha256&&row.known!==0)fail('denominator');
        return {...row,n,coverage:total?row.known/total:0};
      });
      if(rows.some(r=>r.n<MIN_DRAFTS||r.coverage<MIN_COVERAGE)||!total)continue;
      const focus=rows.map(row=>row.counts[s.focus]/row.n);
      const signal=focus.length===2?Math.abs(focus[0]-focus[1]):Math.min(focus[0],1-focus[0]);
      if(signal<.05)continue;
      const coverage=Math.min(...rows.map(r=>r.coverage)),sample=Math.min(...rows.map(r=>r.n));
      const score=Math.round(100*(.5*Math.min(signal/.25,1)+.3*Math.min(sample/1000,1)+.2*coverage))+Math.max(0,20-rank*4);
      const metrics=rows.flatMap(row=>s.labels.map((label,i)=>({id:'p'+row.stage+'-'+i,
        label:(s.stages.length>1?'P1P'+row.stage+' — ':'')+label,numerator:row.counts[i],denominator:row.n,percent:pct(row.counts[i],row.n)})));
      packets.push({schema_version:1,id:'corpus-'+meta.set_id+'-'+analysis.id,series:s.series,headline:s.title,set:meta.set_name,
        unit:s.deck?'one matched source draft':'one qualifying source draft per real pick position',
        cohort:{complete_trajectories:total,stored_source_drafts:raw.source_drafts,min_coverage:coverage,min_opportunity_drafts:sample,
          corpus_version:meta.corpus_version,source_snapshot_id:meta.source_snapshot_id},
        metrics,limitations:[s.limit,'Only retained, verified high-win-rate PremierDraft trophy sources with complete first-eight histories; not all players or drafts. Distinct sources can share a drafter, and comparisons across pick positions can overlap. Descriptive, not a causal or significance claim.'],
        provenance:{attribution:source,method,archive:publicData,hashes:{draft:meta.draft_sha256,game:meta.game_sha256,...(s.deck?{deck_catalog:raw.deck_sha256}:{})}},
        reference:s.hook,theme:s.theme,triage_score:score,kind:'stored-corpus',status:'draft-only'});
    }
  }
  return packets;
}
export async function buildStoredCorpusReport(query,{loadDeck=readStoredDeckCatalog}={}){
  // One bounded read-only transaction/snapshot in the caller. Only the
  // projected retained public-source fields, never the Pack One user tables.
  const sets=(await query(`SELECT set_id,set_name,release_date,corpus_version,source_snapshot_id,draft_sha256,game_sha256
    FROM pack1_lab_corpus_sources ORDER BY release_date DESC NULLS LAST,set_id LIMIT `+MAX_SETS,[])).rows;
  const out=[];
  for(const meta of sets){
    const rows=(await query(`SELECT source_draft_hash,pick_number,historical_pick_id,candidates
      FROM pack1_lab_corpus_picks WHERE set_id=$1 AND source_snapshot_id=$2
      ORDER BY source_draft_hash,pick_number LIMIT `+(MAX_ROWS+1),[meta.set_id,meta.source_snapshot_id])).rows;
    const decks=await loadDeck(meta.set_id);
    out.push(summarizeStoredSet(meta,rows,decks));
  }
  const report={schema_version:1,kind:'stored-corpus',sets:out};
  storedCorpusPackets(report);
  return report;
}
export async function cachedStoredCorpusPackets(query,{week,build=buildStoredCorpusReport}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week||''))fail('week');
  const key='stored-corpus-v1-'+week;
  const old=(await query('SELECT state,report,report_hash FROM pack1_lab_research WHERE source_key=$1',[key])).rows[0];
  if(old?.state==='ready'){
    if(articleHash(old.report)!==old.report_hash)fail('cache-hash');
    return storedCorpusPackets(old.report);
  }
  // The outer weekly worker holds the session advisory lock. A failed
  // research build retries on the next scheduled tick; no partial report saved.
  await query(`INSERT INTO pack1_lab_research(source_key,state) VALUES($1,'preparing')
    ON CONFLICT(source_key) DO UPDATE SET state='preparing',attempted_at=now(),report=NULL,report_hash=NULL`,[key]);
  let report;
  try{
    // Pin reads to a single database snapshot even during a source cutover.
    await query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',[]);
    try{report=await build(query);await query('COMMIT',[]);}catch(error){await query('ROLLBACK',[]);throw error;}
    const packets=storedCorpusPackets(report);
    const saved=await query(`UPDATE pack1_lab_research SET state='ready',report=$2::jsonb,report_hash=$3
      WHERE source_key=$1 AND state='preparing' RETURNING source_key`,[key,JSON.stringify(report),articleHash(report)]);
    if(saved.rows.length!==1)fail('cache-write');
    return packets;
  }catch(error){
    await query("UPDATE pack1_lab_research SET state='failed',report=NULL,report_hash=NULL WHERE source_key=$1 AND state='preparing'",[key]);
    throw error;
  }
}
