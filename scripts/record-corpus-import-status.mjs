import fs from 'node:fs';
import {corpusDatabase} from './neon-corpus-db.mjs';
if(fs.existsSync(process.argv[2])&&fs.existsSync(`${process.argv[3]}/catalog.json`)) {
 const query=corpusDatabase(process.argv[2]),catalog=JSON.parse(fs.readFileSync(`${process.argv[3]}/catalog.json`));
 for(const [set,error] of Object.entries(catalog.errors||{}))await query("UPDATE corpus_sources SET import_status='failed',last_error=$2 WHERE set_id=$1 AND event_type='PremierDraft'",[set,String(error).slice(0,2000)]);
}
