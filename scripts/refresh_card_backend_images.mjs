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
  const result=await importRequest(base,{action:'refresh-images',setId,mapping});
  if(result?.set_id!==setId||Number(result.mapping_entries)!==mapping.length||Number(result.puzzles)<1)throw new Error(`Unexpected image refresh response for ${setId}`);
  refreshed.push(result);
}

const normalized=await importRequest(base,{action:'normalize-image-markers',setIds});
const normalizedIds=(normalized?.normalized||[]).map(item=>item.set_id).sort();
if(JSON.stringify(normalizedIds)!==JSON.stringify([...setIds].sort())||(normalized?.normalized||[]).some(item=>Number(item.missing_images)!==0||Number(item.puzzles)<1))throw new Error('Unexpected image-marker normalization response.');

console.log(JSON.stringify({refreshed,normalized:normalized.normalized}));
