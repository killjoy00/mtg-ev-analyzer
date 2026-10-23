import {brotliDecompressSync} from 'node:zlib';
import {catalogLoaders} from '../corpus/trophy-decks/index.mjs';

const catalogs=new Map();
const availability=new Map();
const expanded=new Map();
function cached(map,key) {
  if(!map.has(key))return undefined;
  const value=map.get(key);map.delete(key);map.set(key,value);return value;
}
function remember(map,key,value,limit) {
  map.delete(key);map.set(key,value);
  while(map.size>limit)map.delete(map.keys().next().value);
  return value;
}
const registered=set=>Object.hasOwn(catalogLoaders,set||'');
async function catalogFor(set) {
  if(!registered(set))return null;
  const existing=cached(catalogs,set);if(existing)return existing;
  const promise=catalogLoaders[set]().then(({encoded})=>{
    const catalog=JSON.parse(brotliDecompressSync(Buffer.from(encoded,'base64')));
    if(catalog.set_id!==set)throw Error('Trophy deck catalog identity mismatch');
    return catalog;
  }).catch(error=>{if(catalogs.get(set)===promise)catalogs.delete(set);throw error;});
  return remember(catalogs,set,promise,6);
}
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const has=(catalog,source)=>Boolean(catalog&&Object.hasOwn(catalog.sources,source||''));
async function sourceAvailable(set,source) {
  const key=`${set}:${source}`,existing=cached(availability,key);
  if(existing!==undefined)return existing;
  return remember(availability,key,has(await catalogFor(set),source),1024);
}

// Release-time coverage for puzzles being added, read through the same catalog
// path that serves decks. Missing decks are counted, never invented.
export async function trophyDeckCoverage(set,sourcePuzzleCounts) {
  const catalog=await catalogFor(set);
  let sources=0,withDeck=0,puzzles=0,puzzlesWithDeck=0;
  for(const [source,count] of sourcePuzzleCounts) {
    sources++;puzzles+=count;
    if(has(catalog,source)){withDeck++;puzzlesWithDeck+=count;}
  }
  return {set,catalog:Boolean(catalog),sources,sources_with_deck:withDeck,puzzles,puzzles_with_deck:puzzlesWithDeck};
}

// One bounded metadata read for already-revealed answers. Catalogs load only
// for the relevant sets; full card lists are never sent before a deck click.
export async function withTrophyDeckAvailability(query,answers) {
  const ids=[...new Set(answers.filter(a=>registered(a.puzzle?.set_id)).map(a=>a.puzzle?.puzzle_id).filter(Boolean))];
  const available=new Set();
  if(ids.length) {
    try {
      const rows=(await query('SELECT puzzle_id,set_id,source_draft_hash FROM draft_run_verified_puzzles WHERE puzzle_id IN(SELECT jsonb_array_elements_text($1::jsonb))',[JSON.stringify(ids)])).rows;
      await Promise.all(rows.map(async row=>{
        if(await sourceAvailable(row.set_id,row.source_draft_hash))available.add(row.puzzle_id);
      }));
    } catch {
      // Optional context must not stop a pick, replay, or result from rendering.
      console.error('Trophy deck availability lookup failed');
    }
  }
  return answers.map(answer=>({...answer,deckAvailable:available.has(answer.puzzle?.puzzle_id)}));
}

export async function trophyDeckForRound(query,session,value) {
  if(!/^(?:0|[1-9][0-9]?)$/.test(String(value??'')))fail('Choose a revealed pick.',400);
  const round=Number(value),answer=session.answers[round];
  if(!answer||round>=session.puzzle_ids.length||answer.puzzle?.puzzle_id!==session.puzzle_ids[round])
    fail('Lock this pick before viewing the deck.',403);
  const row=(await query('SELECT set_id,source_draft_hash FROM draft_run_verified_puzzles WHERE puzzle_id=$1',[answer.puzzle.puzzle_id])).rows[0];
  const key=row?`${row.set_id}:${row.source_draft_hash}`:null;
  const existing=key?cached(expanded,key):null;
  if(existing)return existing;
  const catalog=row?await catalogFor(row.set_id):null;
  if(!has(catalog,row?.source_draft_hash))fail('This decklist is not available.',404);
  const index=catalog.sources[row.source_draft_hash];
  const deck=catalog.decks[index];
  const cards=values=>values.map(([card,count])=>({...catalog.cards[card],count}));
  return remember(expanded,key,{
      deck:cards(deck.deck),sideboard:cards(deck.sideboard),size:deck.size,
      event_type:deck.event_type,colors:deck.colors,splash_colors:deck.splash_colors,
      last_game_time:deck.last_game_time,
      source:{name:'17Lands',url:'https://www.17lands.com/public_datasets',license:'CC BY 4.0',
        note:'This is the deck used in the last game recorded by 17Lands. It may include sideboard changes. Later builds might not be recorded.'},
  },128);
}
