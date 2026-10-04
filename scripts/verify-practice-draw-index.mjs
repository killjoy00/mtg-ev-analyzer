import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {corpusDatabase} from './neon-corpus-db.mjs';
const sql=fs.readFileSync('migrations/0051_exact_pick_draw_index.sql','utf8');
const expected=sql.split('AS $function$')[1]?.split('$function$')[0];
assert.ok(expected);
const query=corpusDatabase(process.argv[2]);
const row=(await query(`SELECT p.prosrc,ix.indisvalid,ix.indisready,pg_get_indexdef(ix.indexrelid) indexdef
 FROM pg_proc p CROSS JOIN pg_index ix
 WHERE p.oid='pack1_select_serving_run_v1(bigint,bigint,text,text,text,jsonb)'::regprocedure
 AND ix.indexrelid=to_regclass('draft_run_inventory_pick_draw_idx')`)).rows[0];
assert.ok(row,'Exact pick draw index must exist');
assert.ok(row.indisvalid===true||row.indisvalid==='t');
assert.ok(row.indisready===true||row.indisready==='t');
assert.equal(row.prosrc,expected,'Installed function must match every byte of the reviewed migration body');
assert.match(row.indexdef,/\(snapshot_id, set_id, band, pick_number, puzzle_id\) INCLUDE \(source_draft_hash\)/);
const dir='artifacts/practice-draw-release';fs.mkdirSync(dir,{recursive:true});
const report={source_sha:process.env.DRAW_SOURCE_SHA,target:process.env.DRAW_TARGET,function_sha256:createHash('sha256').update(row.prosrc).digest('hex'),index_valid:true,index_definition:row.indexdef,observed_at:new Date().toISOString(),passed:true};
fs.writeFileSync(dir+'/installed-'+(process.env.DRAW_TARGET||'preflight')+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
