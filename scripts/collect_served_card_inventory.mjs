// Usage: node scripts/collect_served_card_inventory.mjs DEV_BASE_URL PROD_BASE_URL [output]
//
// Card-image policy coverage starts from what players can actually be served.
// The replay catalog, checked-in corpus samples and replay shards are not the
// whole served inventory: trophy-only environments (Reality Fracture) have no
// shards, and served puzzles can contain cards absent from both samples. This
// records every registered environment's served card names on development and
// production so refresh_card_images.py resolves the policy for all of them.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {importRequest} from './actions-import-auth.mjs';

export async function collectServedInventory(bases,request=importRequest) {
  if(!bases.length||bases.some(base=>!String(base||'').startsWith('https://')))throw Error('HTTPS Draft Run API base URLs are required.');
  const environments={};
  for(const base of bases) {
    const listing=await request(base,{action:'image-environments'});
    if(!Array.isArray(listing?.environments)||!listing.environments.length||typeof listing.corpus_version!=='string')throw Error(`Unexpected image environment listing from ${base}`);
    for(const entry of listing.environments) {
      const setId=String(entry?.set_id||'');
      if(!setId)throw Error(`Unexpected image environment entry from ${base}`);
      const inventory=await request(base,{action:'image-inventory',setId});
      if(inventory?.set_id!==setId||inventory.corpus_version!==listing.corpus_version||!Array.isArray(inventory.names)||!inventory.names.length||inventory.names.some(name=>typeof name!=='string'||!name))
        throw Error(`Unexpected served card inventory for ${setId} from ${base}`);
      const target=environments[setId]??={catalog:false,names:new Set(),sources:[]};
      target.catalog||=entry.catalog===true;
      for(const name of inventory.names)target.names.add(name);
      target.sources.push({base,corpus_version:listing.corpus_version,status:entry.status??null,names:inventory.names.length});
    }
  }
  return {
    environments:Object.fromEntries(Object.keys(environments).sort().map(setId=>{
      const e=environments[setId];
      return [setId,{catalog:e.catalog,names:[...e.names].sort(),sources:e.sources}];
    })),
  };
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const [dev,prod,output='generated/served-card-inventory.json']=process.argv.slice(2);
  const inventory=await collectServedInventory([dev,prod].filter(Boolean));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(inventory,null,2)+'\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(inventory.environments).map(([setId,e])=>[setId,{catalog:e.catalog,names:e.names.length}]))));
}
