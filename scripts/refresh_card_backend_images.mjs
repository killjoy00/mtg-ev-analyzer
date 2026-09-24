// Usage: node scripts/refresh_card_backend_images.mjs BASE_URL [mapping-dir]
import fs from 'node:fs';
import path from 'node:path';
import {importRequest} from './actions-import-auth.mjs';

const base=process.argv[2];
const mappingDir=process.argv[3]||'generated/card-image-refresh';
if(!base?.startsWith('https://'))throw new Error('A HTTPS Draft Run API base URL is required.');

const catalog=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
const setIds=(catalog.sets||[]).map(set=>set.id);
if(!setIds.length)throw new Error('Draft Run catalog has no environments.');

const refreshed=[];
for(const setId of setIds) {
  const mappingPath=path.join(mappingDir,`${setId}.json`);
  if(!fs.existsSync(mappingPath))throw new Error(`Missing image mapping for ${setId}`);
  const mapping=JSON.parse(fs.readFileSync(mappingPath,'utf8'));
  if(!Array.isArray(mapping)||!mapping.length)throw new Error(`Image mapping is empty for ${setId}`);

  let after='',puzzles=0,updatedPuzzles=0,updatedCards=0;
  for(;;) {
    const page=await importRequest(base,{action:'refresh-image-page',setId,mapping,after});
    if(
      page?.set_id!==setId||
      Number(page.mapping_entries)!==mapping.length||
      !Number.isInteger(Number(page.puzzles))||
      Number(page.puzzles)<0||
      !Number.isInteger(Number(page.updated_puzzles))||
      Number(page.updated_puzzles)<0||
      !Number.isInteger(Number(page.updated_cards))||
      Number(page.updated_cards)<0||
      typeof page.done!=='boolean'
    )throw new Error(`Unexpected image refresh response for ${setId}`);

    puzzles+=Number(page.puzzles);
    updatedPuzzles+=Number(page.updated_puzzles);
    updatedCards+=Number(page.updated_cards);
    console.log(JSON.stringify({set_id:setId,page_puzzles:Number(page.puzzles),puzzles,updated_puzzles:updatedPuzzles,updated_cards:updatedCards,done:page.done}));

    if(page.done)break;
    if(typeof page.next_after!=='string'||!page.next_after||page.next_after===after)throw new Error(`Image refresh cursor did not advance for ${setId}`);
    after=page.next_after;
  }
  if(puzzles<1)throw new Error(`No verified puzzles are available for image refresh: ${setId}`);
  refreshed.push({set_id:setId,mapping_entries:mapping.length,puzzles,updated_puzzles:updatedPuzzles,updated_cards:updatedCards});
}

const normalized=[];
for(const setId of setIds) {
  const result=await importRequest(base,{action:'normalize-image-markers',setIds:[setId]});
  const items=result?.normalized||[];
  if(items.length!==1||items[0]?.set_id!==setId||Number(items[0].missing_images)!==0||Number(items[0].puzzles)<1)throw new Error(`Unexpected image-marker normalization response for ${setId}`);
  normalized.push(items[0]);
}

console.log(JSON.stringify({refreshed,normalized}));
