// Score verified puzzles for Daily selection (puzzle-selection.mjs).
// Every loader calls scoreImportedPuzzles on each batch it inserts. Run this
// script directly to backfill a database, or after a strength table or
// decklist changes:
//
//   node scripts/score-puzzle-selection.mjs CONNECTION_FILE [--sets fra hob] [--rescore]
//
// The backfill reads the table once in physical order, a chunk of heap blocks
// at a time (a sequential TID range read; four stripes in parallel), and
// scores each puzzle that has no row for the current feature version or whose
// row used a different strength table than the checked-in one. --rescore
// recomputes every puzzle in scope. Rows are written only when a value
// changes. Payloads, ratings and grading are never touched. The run fails if
// any puzzle in scope is still unscored at the end (for example, a row that
// moved while it was read); run it again to finish.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {catalogLoaders} from '../corpus/trophy-decks/index.mjs';
import {decodeTrophyDeckCatalog} from '../worker/trophy-decks.mjs';
import {puzzleSelectionFeatures,SELECTION_FEATURE_VERSION} from '../puzzle-selection.mjs';
import {toPgArray} from '../worker/draft-run-selection.mjs';

const STRENGTH_DIR=new URL('../corpus/card-strength/',import.meta.url);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const CHUNK_ROWS=1000,STRIPES=4;

// corpus/card-strength/<set>.json, or null when the set has no table.
export function loadStrengthTable(setId,directory=STRENGTH_DIR) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(setId))throw Error('Invalid set id');
  let text;
  try {text=fs.readFileSync(new URL(`${setId}.json`,directory),'utf8');}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  const table=JSON.parse(text);
  if(table.set_id!==setId||!table.strength_version||!/^[a-f0-9]{64}$/.test(table.source?.sha256||'')||!table.cards||typeof table.cards!=='object')
    throw Error(`Invalid card strength table: ${setId}`);
  const cards=new Map(Object.entries(table.cards).map(([name,[points]])=>[name,points]));
  if([...cards.values()].some(points=>!Number.isFinite(points)))throw Error(`Invalid card strength table: ${setId}`);
  return {version:table.strength_version,sha256:table.source.sha256,cards};
}

// Main-deck card counts for a source draft: null when the set has no catalog
// or the catalog has no deck for that source.
export async function loadMainDecks(setId) {
  if(!Object.hasOwn(catalogLoaders,setId))return ()=>null;
  const catalog=decodeTrophyDeckCatalog((await catalogLoaders[setId]()).encoded);
  if(catalog.set_id!==setId)throw Error('Trophy deck catalog identity mismatch');
  return source=>{
    const index=catalog.sources[source];
    if(index===undefined)return null;
    const deck=new Map();
    for(const [card,quantity] of catalog.decks[index].deck){const name=catalog.cards[card].name;deck.set(name,(deck.get(name)||0)+quantity);}
    return deck;
  };
}

const inputs=new Map();
function setInputs(setId,strengthDir) {
  const key=`${String(strengthDir)}|${setId}`;
  if(!inputs.has(key))inputs.set(key,loadMainDecks(setId).then(decks=>({strength:loadStrengthTable(setId,strengthDir),decks})));
  return inputs.get(key);
}

export async function selectionFeaturesAvailable(query) {
  const {present}=(await query("SELECT to_regclass('draft_run_puzzle_selection_features') IS NOT NULL present")).rows[0];
  return present===true||present==='t';
}

async function writeFeatures(query,features) {
  if(!features.length)return [];
  const result=await query(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS f(puzzle_id text,feature_version text,strength_version text,strength_sha256 text,
        stakes_points real,credible_count smallint,trophy_in_main_deck boolean,trophy_is_land boolean)
    ), written AS (
      INSERT INTO draft_run_puzzle_selection_features AS t(puzzle_id,feature_version,strength_version,strength_sha256,stakes_points,credible_count,trophy_in_main_deck,trophy_is_land)
      SELECT * FROM incoming
      ON CONFLICT(puzzle_id,feature_version) DO UPDATE SET strength_version=excluded.strength_version,strength_sha256=excluded.strength_sha256,
        stakes_points=excluded.stakes_points,credible_count=excluded.credible_count,trophy_in_main_deck=excluded.trophy_in_main_deck,
        trophy_is_land=excluded.trophy_is_land,computed_at=now()
      WHERE (t.strength_version,t.strength_sha256,t.stakes_points,t.credible_count,t.trophy_in_main_deck,t.trophy_is_land)
        IS DISTINCT FROM (excluded.strength_version,excluded.strength_sha256,excluded.stakes_points,excluded.credible_count,excluded.trophy_in_main_deck,excluded.trophy_is_land)
      RETURNING t.puzzle_id
    ) SELECT coalesce(jsonb_agg(puzzle_id),'[]'::jsonb) written FROM written`,[JSON.stringify(features)]);
  return parse(result.rows[0].written);
}

// Loaders: score the exact puzzles of one inserted batch from memory. A
// database without the features table (migration 0068) is skipped with one
// message, never failed, so release plans that predate it can still load
// puzzles; the latest-set Daily keeps the band draw until its set is scored.
const tablePresent=new WeakMap();
export async function scoreImportedPuzzles(query,puzzles,{strengthDir=STRENGTH_DIR,log=console.log}={}) {
  if(!tablePresent.has(query)) {
    tablePresent.set(query,selectionFeaturesAvailable(query).then(present=>{
      if(!present)log('Puzzle selection features skipped: migration 0068 is not applied. Run scripts/score-puzzle-selection.mjs after it is.');
      return present;
    }));
  }
  if(!await tablePresent.get(query))return 0;
  const features=[];
  for(const puzzle of puzzles) {
    const {strength,decks}=await setInputs(puzzle.set_id,strengthDir);
    features.push(puzzleSelectionFeatures(puzzle,{strength,mainDeck:decks(puzzle.source_draft_hash)}));
  }
  return (await writeFeatures(query,features)).length;
}

// [strength_version, sha256] per set with a table; a set without one is
// absent, so its rows compare against null.
function currentStrength(directory) {
  const current={};
  for(const file of fs.readdirSync(directory).filter(name=>name.endsWith('.json'))) {
    const setId=file.slice(0,-5),table=loadStrengthTable(setId,directory);
    current[setId]=[table.version,table.sha256];
  }
  return current;
}

// Puzzles in scope with no current row: none of the version, or scored against
// a different strength table. $1 feature version, $2 current strength map.
const STALE=`NOT EXISTS(SELECT 1 FROM draft_run_puzzle_selection_features f
  WHERE f.puzzle_id=p.puzzle_id AND f.feature_version=$1
    AND f.strength_version IS NOT DISTINCT FROM ($2::jsonb->p.set_id->>0)
    AND f.strength_sha256 IS NOT DISTINCT FROM ($2::jsonb->p.set_id->>1))`;
const setFilter=(setIds,params)=>setIds?(params.push(toPgArray(setIds)),`AND p.set_id=ANY($${params.length}::text[])`):'';

async function tableBlocks(query) {
  const row=(await query(`SELECT (pg_relation_size(c.oid)/current_setting('block_size')::int)::int blocks,c.reltuples::float8 tuples,c.relpages::int pages
    FROM pg_class c WHERE c.oid='draft_run_verified_puzzles'::regclass`)).rows[0];
  const perBlock=Number(row.tuples)>0&&Number(row.pages)>0?Number(row.tuples)/Number(row.pages):40;
  return {blocks:Number(row.blocks),chunk:Math.max(1,Math.round(CHUNK_ROWS/perBlock))};
}

async function scoreStripe(query,{first,last,open},{chunk,setIds,rescore,strengthDir,current,tally,log,stripe}) {
  let block=first,chunks=0;
  for(;;) {
    if(block>=last) {
      // The table can grow while it is read; the last stripe reads to its end.
      if(!open)return;
      last=(await tableBlocks(query)).blocks;
      if(block>=last)return;
    }
    const upper=open?block+chunk:Math.min(block+chunk,last);
    const params=[SELECTION_FEATURE_VERSION,JSON.stringify(current),`(${block},0)`,`(${upper},0)`,rescore];
    const sets=setFilter(setIds,params);
    const page=(await query(`SELECT p.puzzle_id,p.set_id,p.source_draft_hash,p.payload->>'historical_pick_id' historical_pick_id,
        (SELECT jsonb_agg(jsonb_build_object('id',c->>'id','name',c->>'name','type_line',c->>'type_line',
          'model_probability',(c->>'model_probability')::float8)) FROM jsonb_array_elements(p.payload->'candidates') c) candidates
      FROM draft_run_verified_puzzles p
      WHERE p.ctid>=$3::tid AND p.ctid<$4::tid ${sets} AND ($5::boolean OR ${STALE})`,params)).rows;
    if(page.length) {
      const features=[];
      for(const row of page) {
        const {strength,decks}=await setInputs(row.set_id,strengthDir);
        features.push(puzzleSelectionFeatures(
          {puzzle_id:row.puzzle_id,historical_pick_id:row.historical_pick_id,candidates:parse(row.candidates)},
          {strength,mainDeck:decks(row.source_draft_hash)}));
      }
      const written=new Set(await writeFeatures(query,features));
      for(const row of page) {
        const entry=tally(row.set_id);
        entry.scored++;if(written.has(row.puzzle_id))entry.written++;
      }
    }
    block=upper;
    if(++chunks%500===0)log(JSON.stringify({stripe,block,of:last}));
  }
}

// Puzzles in scope that still have no current row.
export async function unscoredPuzzles(query,{setIds=null,strengthDir=STRENGTH_DIR}={}) {
  const params=[SELECTION_FEATURE_VERSION,JSON.stringify(currentStrength(strengthDir))];
  const sets=setFilter(setIds,params);
  return Number((await query(`SELECT count(*)::int n FROM draft_run_verified_puzzles p WHERE true ${sets} AND ${STALE}`,params)).rows[0].n);
}

// Backfill: every puzzle, or every puzzle of the given sets. Requires the
// features table. Returns {sets, remaining}: one summary per set scored (and
// per requested set), and the number of puzzles in scope still unscored.
export async function scorePuzzleSelection(query,{setIds=null,rescore=false,strengthDir=STRENGTH_DIR,log=console.log,stripes=STRIPES}={}) {
  if(!await selectionFeaturesAvailable(query))throw Error('Apply migration 0068 before scoring puzzle selection features.');
  const current=currentStrength(strengthDir),totals=new Map();
  const tally=setId=>{
    if(!totals.has(setId))totals.set(setId,{set_id:setId,scored:0,written:0,strength:current[setId]?.[1].slice(0,12)??null,decklists:Object.hasOwn(catalogLoaders,setId)});
    return totals.get(setId);
  };
  for(const setId of setIds||[])tally(setId);
  const {blocks,chunk}=await tableBlocks(query);
  const count=Math.max(1,stripes);
  await Promise.all(Array.from({length:count},(_,i)=>scoreStripe(query,
    {first:Math.floor(i*blocks/count),last:Math.floor((i+1)*blocks/count),open:i===count-1},
    {chunk,setIds,rescore,strengthDir,current,tally,log,stripe:i})));
  const results=[...totals.values()].sort((a,b)=>a.set_id.localeCompare(b.set_id));
  for(const result of results)log(JSON.stringify(result));
  const remaining=await unscoredPuzzles(query,{setIds,strengthDir});
  log(JSON.stringify({unscored_remaining:remaining}));
  return {sets:results,remaining};
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  const args=process.argv.slice(2);
  if(!args[0]||args[0].startsWith('--'))throw Error('Usage: node scripts/score-puzzle-selection.mjs CONNECTION_FILE [--sets a b] [--rescore]');
  const setsAt=args.indexOf('--sets');
  const setIds=setsAt<0?null:args.slice(setsAt+1).filter(a=>!a.startsWith('--'));
  if(setIds&&!setIds.length)throw Error('--sets needs at least one set id');
  const {remaining}=await scorePuzzleSelection(corpusDatabase(args[0]),{setIds,rescore:args.includes('--rescore')});
  if(remaining)throw Error(`${remaining} puzzles in scope are still unscored; run the backfill again.`);
}
