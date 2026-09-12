// Usage: node scripts/refresh_powered_cube_backend_images.mjs BASE_URL [mapping.json]
import fs from 'node:fs';
import {importRequest} from './actions-import-auth.mjs';

const base=process.argv[2];
const mappingPath=process.argv[3]||'generated/powered-cube-standard-images.json';
if(!base?.startsWith('https://'))throw new Error('A HTTPS Draft Run API base URL is required.');
const mapping=JSON.parse(fs.readFileSync(mappingPath,'utf8'));
if(!Array.isArray(mapping)||!mapping.length)throw new Error('Powered Cube image mapping is empty.');
const result=await importRequest(base,{action:'refresh-images',setId:'powered-cube',mapping});
if(result?.set_id!=='powered-cube'||Number(result.mapping_entries)!==mapping.length||Number(result.puzzles)<1)throw new Error('Unexpected Cube image refresh response.');
console.log(JSON.stringify(result));
