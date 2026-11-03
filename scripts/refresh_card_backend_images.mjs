// Usage: node scripts/refresh_card_backend_images.mjs BASE_URL [mapping-dir]
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {importRequest} from './actions-import-auth.mjs';
import {servedNames} from './collect_served_card_inventory.mjs';

// Environments to propagate: the replay catalog plus every environment in the
// served card inventory (trophy-only environments such as FRA are not in the
// catalog but still serve puzzles).
export function propagationSetIds(catalog,served) {
  const setIds=[...new Set([...(catalog?.sets||[]).map(set=>set.id),...Object.keys(served||{})])];
  if(!setIds.length)throw new Error('Draft Run catalog has no environments.');
  return setIds;
}

export async function refreshBackendImages(base,{request=importRequest,catalog,served=null,mappingDir='generated/card-image-refresh',readMapping}={}) {
  if(!base?.startsWith('https://'))throw new Error('A HTTPS Draft Run API base URL is required.');
  const setIds=propagationSetIds(catalog,served);
  readMapping??=setId=>{
    const mappingPath=path.join(mappingDir,`${setId}.json`);
    if(!fs.existsSync(mappingPath))throw new Error(`Missing image mapping for ${setId}`);
    return JSON.parse(fs.readFileSync(mappingPath,'utf8'));
  };

  const refreshed=[];
  for(const setId of setIds) {
    const mapping=readMapping(setId);
    if(!Array.isArray(mapping)||!mapping.length)throw new Error(`Image mapping is empty for ${setId}`);

    let after='',puzzles=0,updatedPuzzles=0,updatedCards=0;
    for(;;) {
      const page=await request(base,{action:'refresh-image-page-v2',setId,mapping,after});
      if(
        page?.set_id!==setId||
        Number(page.mapping_entries)!==mapping.length||
        !Number.isInteger(Number(page.puzzles))||
        Number(page.puzzles)<0||
        !Number.isInteger(Number(page.updated_puzzles))||
        Number(page.updated_puzzles)<0||
        !Number.isInteger(Number(page.updated_cards))||
        Number(page.updated_cards)<0||
        typeof page.done!=='boolean'||
        typeof page.corpus_available!=='boolean'
      )throw new Error(`Unexpected image refresh response for ${setId}`);

      if(!page.corpus_available)throw new Error(`No verified puzzles are available for image refresh: ${setId}`);
      puzzles+=Number(page.puzzles);
      updatedPuzzles+=Number(page.updated_puzzles);
      updatedCards+=Number(page.updated_cards);
      console.log(JSON.stringify({set_id:setId,page_puzzles:Number(page.puzzles),puzzles,updated_puzzles:updatedPuzzles,updated_cards:updatedCards,done:page.done}));

      if(page.done)break;
      if(typeof page.next_after!=='string'||!page.next_after||page.next_after===after)throw new Error(`Image refresh cursor did not advance for ${setId}`);
      after=page.next_after;
    }
    // Zero returned payloads is a valid no-op: the server now filters already-
    // matching JSON before it crosses the Neon proxy. The normalization pass
    // below independently verifies that the set exists and contains puzzles.

    // Fail closed when the backend serves a card the policy did not resolve.
    // Unmapped cards keep whatever art they were imported with, which is how
    // cards outside the replay samples escaped the policy before.
    const inventory=await servedNames(request,base,setId);
    const mapped=new Set(mapping.map(entry=>entry.name));
    const unmapped=inventory.names.filter(name=>!mapped.has(name));
    if(unmapped.length)throw new Error(`${setId}: ${unmapped.length} served cards have no card-image policy selection (${unmapped.slice(0,10).join(', ')}). Collect the served inventory and rerun the refresh.`);

    refreshed.push({set_id:setId,mapping_entries:mapping.length,served_names:inventory.names.length,puzzles,updated_puzzles:updatedPuzzles,updated_cards:updatedCards});
  }

  const normalized=[];
  for(const setId of setIds) {
    const result=await request(base,{action:'normalize-image-markers',setIds:[setId]});
    const items=result?.normalized||[];
    if(items.length!==1||items[0]?.set_id!==setId||Number(items[0].missing_images)!==0||Number(items[0].puzzles)<1)throw new Error(`Unexpected image-marker normalization response for ${setId}`);
    normalized.push(items[0]);
  }
  return {refreshed,normalized};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const base=process.argv[2];
  const mappingDir=process.argv[3]||'generated/card-image-refresh';
  const catalog=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
  const servedPath=process.env.SERVED_INVENTORY_PATH||'generated/served-card-inventory.json';
  if(process.env.REQUIRE_SERVED_INVENTORY==='1'&&!fs.existsSync(servedPath))throw new Error(`Served card inventory is required but missing: ${servedPath}`);
  const served=fs.existsSync(servedPath)?JSON.parse(fs.readFileSync(servedPath,'utf8')).environments:null;
  console.log(JSON.stringify(await refreshBackendImages(base,{catalog,served,mappingDir})));
}
