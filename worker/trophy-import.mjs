import {isDeepStrictEqual} from 'node:util';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import {validateDraftRunPuzzle,interestingDraftRunPuzzle,draftRunDifficulty,DRAFT_RUN_CORPUS_VERSION as VERSION} from '../draft-run.mjs';
import {verifyImportToken,IMPORT_WORKFLOW,IMAGE_REFRESH_WORKFLOW} from './trophy-import-auth.mjs';

const allowed=new Set(catalog.sets.map(s=>s.id));
const error=(message,status=400)=>Object.assign(Error(message),{status});
const DISPLAY_FIELDS=new Set(['image_url','mana_cost','rarity','type_line']);

const parse=value=>typeof value==='string'?JSON.parse(value):value;

function scrubCard(card) {
  return Object.fromEntries(Object.entries(card||{}).filter(([key])=>!DISPLAY_FIELDS.has(key)));
}

function scrubPuzzle(puzzle) {
  return {
    ...puzzle,
    candidates:(puzzle.candidates||[]).map(scrubCard),
    prior_picks:(puzzle.prior_picks||[]).map(scrubCard),
  };
}

function normalizeImageMapping(raw) {
  if(!Array.isArray(raw)||!raw.length||raw.length>2000)throw error('Invalid image mapping');
  const mapping=new Map();
  const allowedKeys=new Set(['name',...DISPLAY_FIELDS]);
  for(const entry of raw) {
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(key=>!allowedKeys.has(key)))throw error('Invalid image mapping');
    const name=String(entry.name||'').trim();
    if(!name||name.length>200||mapping.has(name)||typeof entry.image_url!=='string'||!entry.image_url.startsWith('https://'))throw error('Invalid image mapping');
    const display={image_url:entry.image_url};
    for(const key of ['mana_cost','rarity','type_line']) {
      if(entry[key]!==undefined) {
        if(typeof entry[key]!=='string'||entry[key].length>1000)throw error('Invalid image mapping');
        display[key]=entry[key];
      }
    }
    mapping.set(name,display);
  }
  return mapping;
}

function patchCards(cards,mapping,counters) {
  return cards.map(card=>{
    const display=mapping.get(card.name);
    if(!display)return card;
    let changed=false;
    const next={...card};
    for(const [key,value] of Object.entries(display)) {
      if(next[key]!==value){next[key]=value;changed=true;}
    }
    if(changed)counters.cards++;
    return next;
  });
}

export async function refreshTrophyImages(query,setId,rawMapping) {
  if(setId!=='powered-cube')throw error('Image refresh is limited to Powered Cube');
  const mapping=normalizeImageMapping(rawMapping);
  let after='',seen=0,updatedPuzzles=0,updatedCards=0;
  for(;;) {
    const page=await query(
      'SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND puzzle_id>$3 ORDER BY puzzle_id LIMIT 250',
      [setId,VERSION,after],
    );
    if(!page.rows.length)break;
    const updates=[];
    for(const row of page.rows) {
      const current=parse(row.payload);
      if(!validateDraftRunPuzzle(current)||current.set_id!==setId||current.puzzle_id!==row.puzzle_id)throw error('Stored Cube puzzle failed verification',409);
      const counters={cards:0};
      const next={
        ...current,
        candidates:patchCards(current.candidates,mapping,counters),
        prior_picks:patchCards(current.prior_picks,mapping,counters),
      };
      if(counters.cards) {
        if(!validateDraftRunPuzzle(next)||!isDeepStrictEqual(scrubPuzzle(current),scrubPuzzle(next)))throw error('Image refresh attempted to change gameplay data',409);
        updates.push({puzzle_id:row.puzzle_id,payload:next});
        updatedCards+=counters.cards;
      }
      seen++;
      after=row.puzzle_id;
    }
    if(updates.length) {
      const result=await query(
        `WITH incoming AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(puzzle_id text,payload jsonb)
        )
        UPDATE draft_run_verified_puzzles p
        SET payload=i.payload
        FROM incoming i
        WHERE p.puzzle_id=i.puzzle_id AND p.set_id=$2 AND p.corpus_version=$3
        RETURNING p.puzzle_id`,
        [JSON.stringify(updates),setId,VERSION],
      );
      if(result.rows.length!==updates.length)throw error('Cube image refresh update count mismatch',409);
      updatedPuzzles+=updates.length;
    }
    if(page.rows.length<250)break;
  }
  if(!seen)throw error('No Powered Cube puzzles are available',409);
  return {set_id:setId,mapping_entries:mapping.size,puzzles:seen,updated_puzzles:updatedPuzzles,updated_cards:updatedCards};
}

export async function insertTrophyBatch(query,puzzles) {
  if(!Array.isArray(puzzles)||!puzzles.length||puzzles.length>250||new Set(puzzles.map(p=>p.puzzle_id)).size!==puzzles.length)throw error('Invalid batch');
  const batch=puzzles.map(p=>{
    if(!allowed.has(p.set_id)||!validateDraftRunPuzzle(p)||!['puzzle_id','source_draft_hash','source_fingerprint'].every(k=>new RegExp(k==='source_fingerprint'?'^[a-f0-9]{64}$':'^[a-f0-9]{32}$').test(p[k]))||[...p.candidates,...p.prior_picks].some(c=>!c.image_url?.startsWith('https://')))throw error('Invalid verified puzzle');
    return {puzzle_id:p.puzzle_id,set_id:p.set_id,source_draft_hash:p.source_draft_hash,corpus_version:p.corpus_version,pick_number:p.pick_number,candidate_count:p.candidates.length,consensus_top_gap:draftRunDifficulty(p).topGap,support_entropy:draftRunDifficulty(p).entropy,interesting:interestingDraftRunPuzzle(p),payload:p};
  });
  const r=await query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(puzzle_id text,set_id text,source_draft_hash text,corpus_version text,pick_number smallint,candidate_count smallint,consensus_top_gap real,support_entropy real,interesting boolean,payload jsonb)), conflicts AS (SELECT i.puzzle_id FROM incoming i JOIN draft_run_verified_puzzles e USING(puzzle_id) WHERE e.payload IS DISTINCT FROM i.payload), added AS (INSERT INTO draft_run_verified_puzzles SELECT * FROM incoming WHERE NOT EXISTS(SELECT 1 FROM conflicts) ON CONFLICT(puzzle_id) DO NOTHING RETURNING puzzle_id) SELECT (SELECT count(*) FROM conflicts)::int conflicts,(SELECT count(*) FROM added)::int added`,[JSON.stringify(batch)]);
  if(Number(r.rows[0].conflicts))throw error('Existing puzzle differs; no payload overwritten',409);
  return Number(r.rows[0].added);
}

export async function handleTrophyImport(request,query) {
  if(request.method!=='POST')throw error('POST required',405);
  const identity=await verifyImportToken(request.headers.get('authorization')?.replace(/^Bearer /,''));
  if(!request.headers.get('content-type')?.includes('application/json'))throw error('JSON required',415);
  let size=0;
  const chunks=[];
  for await(const chunk of request.body){
    size+=chunk.byteLength;
    if(size>8*1024*1024)throw error('Batch too large',413);
    chunks.push(chunk);
  }
  let body;
  try{body=JSON.parse(Buffer.concat(chunks));}catch{throw error('Invalid JSON');}

  if(body.action==='refresh-images') {
    if(identity.workflow_ref!==IMAGE_REFRESH_WORKFLOW)throw error('Image refresh identity denied',403);
    return refreshTrophyImages(query,body.setId,body.mapping);
  }
  if(identity.workflow_ref!==IMPORT_WORKFLOW)throw error('Trophy import identity denied',403);

  if(body.action==='batch')return {added:await insertTrophyBatch(query,body.puzzles)};
  const sid=body.setId||body.manifest?.id;
  if(!allowed.has(sid))throw error('Environment not registered');
  const status=(await query('SELECT s.corpus_version,(SELECT count(*)::int FROM draft_run_verified_puzzles p WHERE p.set_id=s.set_id AND p.corpus_version=$2) puzzles FROM draft_run_verified_sets s WHERE s.set_id=$1',[sid,VERSION])).rows[0];
  if(status?.corpus_version!==VERSION)throw error('Baseline environment missing',409);
  if(body.action==='status')return {...status,puzzles:Number(status.puzzles)};
  if(body.action==='finish-set') {
    const m=body.manifest;
    if(m.corpus_version!==VERSION||m.import_version!=='all-premier-trophies-v1'||!Number.isInteger(m.total_puzzles)||m.total_puzzles<1||m.total_puzzles!==m.existing_puzzles_preserved+m.additional_puzzles||m.source_trophies!==m.included_trophies+m.excluded_trophies||!/^[a-f0-9]{64}$/.test(m.input_signature)||Number(status.puzzles)<m.total_puzzles)throw error('Import accounting mismatch',409);
    await query("UPDATE draft_run_verified_sets SET manifest=jsonb_set(manifest,'{full_import}',$2::jsonb) WHERE set_id=$1",[sid,JSON.stringify({...m,github_run_id:identity.run_id,github_sha:identity.sha})]);
    return {puzzles:Number(status.puzzles)};
  }
  throw error('Unknown import action');
}
