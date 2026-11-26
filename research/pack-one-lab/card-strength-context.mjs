// Optional context from the existing public game-data strength catalog.
// Match the exact retained game archive. Never mix these full-archive
// game-in-hand observations with trophy-only selection denominators.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const HASH=/^[a-f0-9]{64}$/;
const VERSION='gih-shrunk-400-v1';
const METHOD='https://github.com/killjoy00/mtg-ev-analyzer/blob/main/corpus/card-strength/README.md';
const MIN_GAMES=400;
const validName=name=>typeof name==='string'&&name.length>0&&name.length<=160&&!/[\u0000-\u001f<>]/.test(name);
const validRow=(row,total)=>Array.isArray(row)&&row.length===2&&Number.isFinite(row[0])&&Math.abs(row[0])<=100&&Number.isSafeInteger(row[1])&&row[1]>=MIN_GAMES&&row[1]<=total;
export function normalizeStrengthContext(meta,table,tableHash){
  if(!table||table.schema_version!==1||table.strength_version!==VERSION||table.set_id!==meta.set_id||table.source?.sha256!==meta.game_sha256||
    !HASH.test(tableHash||'')||!HASH.test(meta.game_sha256||'')||table.source?.provider!=='17Lands'||table.source?.license!=='CC BY 4.0'||
    !Number.isSafeInteger(table.game_rows)||table.game_rows<MIN_GAMES||!Number.isFinite(table.baseline_win_rate)||table.baseline_win_rate<0||table.baseline_win_rate>1||
    table.prior_games!==400||!table.cards||typeof table.cards!=='object'||Array.isArray(table.cards)||Object.keys(table.cards).length>3000)return null;
  return {version:VERSION,archive_sha256:meta.game_sha256,table_sha256:tableHash,game_rows:table.game_rows,
    cards:Object.fromEntries(Object.entries(table.cards).filter(([name,row])=>validName(name)&&validRow(row,table.game_rows)))};
}
export async function readStrengthContext(meta){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.set_id||''))return null;
  try{
    const bytes=await readFile(new URL('../../corpus/card-strength/'+meta.set_id+'.json',import.meta.url));
    if(bytes.length>1024*1024)return null;
    return normalizeStrengthContext(meta,JSON.parse(bytes.toString('utf8')),createHash('sha256').update(bytes).digest('hex'));
  }catch{return null;}
}
export function attachStrengthContext(packet,meta,context){
  if(!context||context.version!==VERSION||context.archive_sha256!==meta.game_sha256||!HASH.test(context.table_sha256||'')||
    !Number.isSafeInteger(context.game_rows)||context.game_rows<MIN_GAMES||!context.cards||typeof context.cards!=='object'||Array.isArray(context.cards))return packet;
  const names=[...new Set([...packet.research_context.cards.map(c=>c.name),...(packet.research_context.rare_examples||[]).map(c=>c.rare),...(packet.research_context.near_unanimous_exceptions||[]).flatMap(c=>c.alternatives.map(a=>a.name))])].slice(0,5);
  const cards=names.filter(n=>validName(n)&&Object.hasOwn(context.cards,n)&&validRow(context.cards[n],context.game_rows)).map(name=>({name,points:context.cards[name][0],in_hand_games:context.cards[name][1]}));
  if(!cards.length)return packet;
  return {...packet,research_context:{...packet.research_context,game_context:{measure:'Shrunk game-in-hand win rate minus set average, in percentage points',prior_games:400,game_rows:context.game_rows,scope:'All games in the matching public PremierDraft archive, not only the retained trophy drafts',cards,method:METHOD}},
    provenance:{...packet.provenance,hashes:{...packet.provenance.hashes,card_strength_table:context.table_sha256}},
    limitations:[...packet.limitations,'Separate full-archive game-in-hand context uses 400 pseudo-games of shrinkage toward the set average; it is observational, affected by players and decks, and not a causal card effect or a head-to-head win rate.']};
}
