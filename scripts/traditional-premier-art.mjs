// Traditional components must show the same card art as Premier puzzles of the
// same environment. This module checks that and repairs Traditional rows only.
//
// It never writes Premier rows, replay shards or checked-in card files. Use it
// instead of the full card-image refresh when Traditional art has drifted: the
// full refresh rewrites every environment's Premier rows too and does not fit
// its workflow time limit for a whole corpus.
//
//   node scripts/traditional-premier-art.mjs <connection-file> check [set ...]
//   node scripts/traditional-premier-art.mjs <connection-file> repair [--dry-run] [set ...]
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {toPgArray} from '../worker/draft-run-selection.mjs';

export const DISPLAY_FIELDS=Object.freeze(['image_url','mana_cost','rarity','type_line','display_faces']);
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canon=x=>JSON.stringify(sorted(x??{}));
const parse=x=>typeof x==='string'?JSON.parse(x):x;
// The HTTP SQL client sends params as JSON, so arrays go as Postgres array literals.
const FIELDS=toPgArray(DISPLAY_FIELDS);

// Display variants per card name, with how many card entries use each.
const VARIANTS_SQL=`SELECT c->>'name' AS name, d.display, count(*)::int AS n
 FROM draft_run_verified_puzzles p
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.payload->'candidates','[]'::jsonb)||coalesce(p.payload->'prior_picks','[]'::jsonb)) c
 CROSS JOIN LATERAL (SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) AS display FROM jsonb_each(c) e(k,v) WHERE k=ANY($3::text[])) d
 WHERE p.set_id=$1 AND p.corpus_version=$2`;
const PREMIER_SQL=`${VARIANTS_SQL} AND c->>'image_url' LIKE 'https://%' GROUP BY 1,2`;
const TRADITIONAL_SQL=`${VARIANTS_SQL} GROUP BY 1,2`;

// Premier rows for one name can legitimately differ (for example a land stored
// with mana_cost "" in some rows and without the key in others). A Traditional
// card passes when it equals any Premier variant. A repair writes the most
// frequent variant, with ties broken by canonical text so it is deterministic.
export function premierArt(rows) {
 const art=new Map();
 for(const r of rows) {
  const display=parse(r.display),key=canon(display),n=Number(r.n);
  const entry=art.get(r.name)||{variants:new Map()};
  entry.variants.set(key,{display,n:(entry.variants.get(key)?.n||0)+n});
  art.set(r.name,entry);
 }
 for(const entry of art.values())
  entry.chosen=[...entry.variants.entries()].sort(([a,x],[b,y])=>y.n-x.n||(a<b?-1:a>b?1:0))[0][1].display;
 return art;
}

export function artDrift(premierRows,traditionalRows) {
 const art=premierArt(premierRows),mismatched=new Map(),unmatched=new Map();let cards=0;
 for(const r of traditionalRows) {
  const n=Number(r.n),entry=art.get(r.name);cards+=n;
  if(!entry)unmatched.set(r.name,(unmatched.get(r.name)||0)+n);
  else if(!entry.variants.has(canon(parse(r.display))))mismatched.set(r.name,(mismatched.get(r.name)||0)+n);
 }
 const list=m=>[...m].sort(([a],[b])=>a<b?-1:1).map(([name,n])=>({name,cards:n}));
 return {cards,mismatched_cards:[...mismatched.values()].reduce((a,b)=>a+b,0),mismatched:list(mismatched),unmatched:list(unmatched)};
}

const premierCache=new WeakMap();
async function premierRows(query,sid,parent) {
 if(!premierCache.has(query))premierCache.set(query,new Map());
 const cache=premierCache.get(query),key=`${sid}|${parent}`;
 if(!cache.has(key))cache.set(key,(await query(PREMIER_SQL,[sid,parent,FIELDS])).rows);
 return cache.get(key);
}
const requireComponent=(component,parent)=>{if(!component||component===parent)throw Error('Traditional art checks only accept a component version, never the Premier parent');};

export async function checkTraditionalArt(query,sid,component,parent=DRAFT_RUN_CORPUS_VERSION) {
 requireComponent(component,parent);
 const premier=await premierRows(query,sid,parent);
 if(!premier.length)throw Error(`${sid}: no Premier ${parent} card art to compare Traditional against`);
 const traditional=(await query(TRADITIONAL_SQL,[sid,component,FIELDS])).rows;
 return {set:sid,component,...artDrift(premier,traditional)};
}

// Replace the five display keys only on cards whose display matches no Premier
// variant. Every other key and the card order are kept, and only rows whose
// payload changes are written. Rows are processed in 16 puzzle-id chunks so no
// single request approaches the SQL client's timeout.
const fix=`CASE WHEN m.name IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(m.variants) v
   WHERE v=(SELECT coalesce(jsonb_object_agg(k,x),'{}'::jsonb) FROM jsonb_each(c) j(k,x) WHERE k=ANY($5::text[])))
  THEN c ELSE (c-$5::text[])||m.display END`;
const cards=path=>`(SELECT coalesce(jsonb_agg(${fix} ORDER BY o),'[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p.payload->'${path}','[]'::jsonb)) WITH ORDINALITY e(c,o) LEFT JOIN m ON m.name=c->>'name')`;
const target=`WITH m AS (SELECT * FROM jsonb_to_recordset($3::jsonb) x(name text,display jsonb,variants jsonb)),
 target AS (SELECT p.puzzle_id,p.payload,jsonb_set(jsonb_set(p.payload,'{candidates}',${cards('candidates')}),'{prior_picks}',${cards('prior_picks')},false) AS next
  FROM draft_run_verified_puzzles p WHERE p.set_id=$1 AND p.corpus_version=$2 AND p.puzzle_id LIKE $4)`;
const REPAIR_SQL=`${target}, u AS (UPDATE draft_run_verified_puzzles p SET payload=t.next FROM target t
 WHERE p.puzzle_id=t.puzzle_id AND p.corpus_version=$2 AND t.next IS DISTINCT FROM t.payload RETURNING 1) SELECT count(*)::int AS changed FROM u`;
const DRY_RUN_SQL=`${target} SELECT count(*) FILTER (WHERE next IS DISTINCT FROM payload)::int AS changed FROM target`;
export const SQL=Object.freeze({premier:PREMIER_SQL,traditional:TRADITIONAL_SQL,repair:REPAIR_SQL,dryRun:DRY_RUN_SQL});
export const CHUNKS=Object.freeze([...'0123456789abcdef']);

export async function repairTraditionalArt(query,sid,component,parent=DRAFT_RUN_CORPUS_VERSION,{dryRun=false}={}) {
 requireComponent(component,parent);
 const art=premierArt(await premierRows(query,sid,parent));
 if(!art.size)throw Error(`${sid}: no Premier ${parent} card art to copy`);
 const map=JSON.stringify([...art].map(([name,e])=>({name,display:e.chosen,variants:[...e.variants.values()].map(v=>v.display)})));
 let changed=0;
 for(const chunk of CHUNKS)changed+=Number((await query(dryRun?DRY_RUN_SQL:REPAIR_SQL,[sid,component,map,chunk+'%',FIELDS])).rows[0].changed);
 return {set:sid,component,[dryRun?'would_change_puzzles':'changed_puzzles']:changed};
}

// Candidate and Live components of the current parent; the repair may need to
// run before or after publication.
export async function traditionalComponents(query,sets=[],parent=DRAFT_RUN_CORPUS_VERSION) {
 const rows=(await query(`SELECT set_id,component_version,status FROM corpus_components
  WHERE parent_version=$1 AND status IN ('Candidate','Live') AND (cardinality($2::text[])=0 OR set_id=ANY($2::text[])) ORDER BY set_id,component_version`,[parent,toPgArray(sets)])).rows;
 const missing=sets.filter(sid=>!rows.some(r=>r.set_id===sid));
 if(missing.length)throw Error('No Candidate or Live Traditional component for: '+missing.join(', '));
 return rows;
}

if(process.argv[1]?.endsWith('/traditional-premier-art.mjs')) {
 const [connection,action,...rest]=process.argv.slice(2),dryRun=rest.includes('--dry-run'),sets=rest.filter(a=>a!=='--dry-run');
 if(!connection||!['check','repair'].includes(action))throw Error('Usage: traditional-premier-art.mjs <connection-file> check|repair [--dry-run] [set ...]');
 const query=corpusDatabase(connection);let failed=false;
 for(const c of await traditionalComponents(query,sets)) {
  if(action==='repair')console.log(JSON.stringify(await repairTraditionalArt(query,c.set_id,c.component_version,DRAFT_RUN_CORPUS_VERSION,{dryRun})));
  if(dryRun)continue;
  const drift=await checkTraditionalArt(query,c.set_id,c.component_version);
  failed||=drift.mismatched_cards>0;
  console.log(JSON.stringify({...drift,status:c.status}));
 }
 if(failed){console.error('Traditional art differs from Premier. Run: node scripts/traditional-premier-art.mjs <connection-file> repair [set ...]');process.exitCode=1;}
}
