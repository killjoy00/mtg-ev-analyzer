import {gunzipSync} from 'node:zlib';
import {encoded} from '../corpus/trophy-decks/fra.mjs';

const catalog=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')));
const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
const has=(set,source)=>set===catalog.set_id&&Object.hasOwn(catalog.sources,source||'');
const expanded=new Map();

// A single bounded metadata read, only for already-revealed FRA answers.
// Full card lists are never included in run snapshots or fetched before click.
export async function withTrophyDeckAvailability(query,answers) {
  const ids=[...new Set(answers.filter(a=>a.puzzle?.set_id===catalog.set_id).map(a=>a.puzzle?.puzzle_id).filter(Boolean))];
  const available=new Set();
  if(ids.length) {
    try {
      const rows=(await query('SELECT puzzle_id,set_id,source_draft_hash FROM draft_run_verified_puzzles WHERE puzzle_id IN(SELECT jsonb_array_elements_text($1::jsonb))',[JSON.stringify(ids)])).rows;
      for(const row of rows)if(has(row.set_id,row.source_draft_hash))available.add(row.puzzle_id);
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
  if(!row||!has(row.set_id,row.source_draft_hash))fail('This decklist is not available.',404);
  const index=catalog.sources[row.source_draft_hash];
  if(!expanded.has(index)) {
    const deck=catalog.decks[index];
    const cards=values=>values.map(([card,count])=>({...catalog.cards[card],count}));
    expanded.set(index,{
      deck:cards(deck.deck),sideboard:cards(deck.sideboard),size:deck.size,
      event_type:deck.event_type,colors:deck.colors,splash_colors:deck.splash_colors,
      last_game_time:deck.last_game_time,
      source:{name:'17Lands',url:'https://www.17lands.com/public_datasets',license:'CC BY 4.0',
        note:'This is the deck used in the last game recorded by 17Lands. It may include sideboard changes. Later builds might not be recorded.'},
    });
  }
  return expanded.get(index);
}
