// Score verified puzzles for Daily selection (puzzle-selection.mjs).
// Every loader calls scoreImportedPuzzles on each batch it inserts. Run this
// script directly to backfill a database, or after a strength table or
// decklist changes:
//
//   node scripts/score-puzzle-selection.mjs CONNECTION_FILE [--sets fra hob] [--rescore]
//
// The backfill scores a puzzle that has no row for the current feature
// version, or whose row used a different strength table than the checked-in
// one; --rescore recomputes every puzzle in scope. Rows are written only when
// a value changes. Payloads, ratings and grading are never touched.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {catalogLoaders} from '../corpus/trophy-decks/index.mjs';
import {decodeTrophyDeckCatalog} from '../worker/trophy-decks.mjs';
import {puzzleSelectionFeatures,SELECTION_FEATURE_VERSION} from '../puzzle-selection.mjs';

const STRENGTH_DIR=new URL('../corpus/card-strength/',import.meta.url);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const PAGE=500;

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
  if(!features.length)return 0;
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
      RETURNING 1
    ) SELECT count(*)::int written FROM written`,[JSON.stringify(features)]);
  return Number(result.rows[0].written);
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
  return writeFeatures(query,features);
}

async function scoreSet(query,setId,{rescore,strengthDir}) {
  const {strength,decks}=await setInputs(setId,strengthDir);
  let after='',scored=0,written=0;
  for(;;) {
    const page=(await query(`SELECT p.puzzle_id,p.source_draft_hash,p.payload->>'historical_pick_id' historical_pick_id,
        (SELECT jsonb_agg(jsonb_build_object('id',c->>'id','name',c->>'name','type_line',c->>'type_line',
          'model_probability',(c->>'model_probability')::float8)) FROM jsonb_array_elements(p.payload->'candidates') c) candidates
      FROM draft_run_verified_puzzles p
      WHERE p.set_id=$1 AND p.puzzle_id COLLATE "C">$2
        AND ($3::boolean OR NOT EXISTS(SELECT 1 FROM draft_run_puzzle_selection_features f
          WHERE f.puzzle_id=p.puzzle_id AND f.feature_version=$4
            AND f.strength_version IS NOT DISTINCT FROM $5 AND f.strength_sha256 IS NOT DISTINCT FROM $6))
      ORDER BY p.puzzle_id COLLATE "C" LIMIT $7`,
      [setId,after,rescore,SELECTION_FEATURE_VERSION,strength?.version??null,strength?.sha256??null,PAGE])).rows;
    if(!page.length)break;
    written+=await writeFeatures(query,page.map(row=>puzzleSelectionFeatures(
      {puzzle_id:row.puzzle_id,historical_pick_id:row.historical_pick_id,candidates:parse(row.candidates)},
      {strength,mainDeck:decks(row.source_draft_hash)})));
    scored+=page.length;after=page.at(-1).puzzle_id;
  }
  return {set_id:setId,scored,written,strength:strength?strength.sha256.slice(0,12):null,decklists:Object.hasOwn(catalogLoaders,setId)};
}

// Backfill: every puzzle of the given sets (default: every set with a corpus
// version). Requires the features table.
export async function scorePuzzleSelection(query,{setIds=null,rescore=false,strengthDir=STRENGTH_DIR,log=console.log,workers=4}={}) {
  if(!await selectionFeaturesAvailable(query))throw Error('Apply migration 0068 before scoring puzzle selection features.');
  const ids=setIds||(await query('SELECT DISTINCT set_id FROM corpus_set_versions ORDER BY set_id')).rows.map(r=>r.set_id);
  const results=[];let next=0;
  await Promise.all(Array.from({length:Math.max(1,workers)},async()=>{
    while(next<ids.length) {
      const result=await scoreSet(query,ids[next++],{rescore,strengthDir});
      results.push(result);log(JSON.stringify(result));
    }
  }));
  return results.sort((a,b)=>a.set_id.localeCompare(b.set_id));
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const {corpusDatabase}=await import('./neon-corpus-db.mjs');
  const args=process.argv.slice(2);
  if(!args[0]||args[0].startsWith('--'))throw Error('Usage: node scripts/score-puzzle-selection.mjs CONNECTION_FILE [--sets a b] [--rescore]');
  const setsAt=args.indexOf('--sets');
  const setIds=setsAt<0?null:args.slice(setsAt+1).filter(a=>!a.startsWith('--'));
  if(setIds&&!setIds.length)throw Error('--sets needs at least one set id');
  await scorePuzzleSelection(corpusDatabase(args[0]),{setIds,rescore:args.includes('--rescore')});
}
