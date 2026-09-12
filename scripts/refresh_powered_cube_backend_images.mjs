// Usage: node scripts/refresh_powered_cube_backend_images.mjs BASE_URL [mapping.json]
import fs from 'node:fs';
import {importRequest} from './actions-import-auth.mjs';

const base=process.argv[2];
const mappingPath=process.argv[3]||'generated/powered-cube-standard-images.json';
const markerSets=['powered-cube','hbg','tmt'];
if(!base?.startsWith('https://'))throw new Error('A HTTPS Draft Run API base URL is required.');
const mapping=JSON.parse(fs.readFileSync(mappingPath,'utf8'));
if(!Array.isArray(mapping)||!mapping.length)throw new Error('Powered Cube image mapping is empty.');
const result=await importRequest(base,{action:'refresh-images',setId:'powered-cube',mapping});
if(result?.set_id!=='powered-cube'||Number(result.mapping_entries)!==mapping.length||Number(result.puzzles)<1)throw new Error('Unexpected Cube image refresh response.');

const normalized=await importRequest(base,{action:'normalize-image-markers',setIds:markerSets});
const normalizedIds=(normalized?.normalized||[]).map(item=>item.set_id).sort();
if(JSON.stringify(normalizedIds)!==JSON.stringify([...markerSets].sort())||(normalized?.normalized||[]).some(item=>Number(item.missing_images)!==0||Number(item.puzzles)<1))throw new Error('Unexpected image-marker normalization response.');

const catalogPath='corpus/draft-run/catalog.json';
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
for(const set of catalog.sets||[]) {
  if(markerSets.includes(set.id))set.unresolved_image_names=[];
}
const catalogIds=(catalog.sets||[]).filter(set=>markerSets.includes(set.id)).map(set=>set.id).sort();
if(JSON.stringify(catalogIds)!==JSON.stringify([...markerSets].sort()))throw new Error('Legacy image-marker sets missing from catalog.');
fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({image_refresh:result,marker_normalization:normalized}));
