import {isDeepStrictEqual} from 'node:util';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import {validateDraftRunPuzzle,interestingDraftRunPuzzle,draftRunDifficulty,DRAFT_RUN_CORPUS_VERSION as VERSION} from '../draft-run.mjs';
import {verifyImportToken,IMPORT_WORKFLOW,IMAGE_REFRESH_WORKFLOW} from './trophy-import-auth.mjs';
import {refreshServingStatistics} from './serving-statistics.mjs';
import {supportedComponent} from '../corpus-components.mjs';

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

const IMAGE_REFRESH_PAGE_SIZE=250;

export async function refreshTrophyImagePage(query,setId,rawMapping,rawAfter='') {
  if(!allowed.has(setId))throw error('Image refresh requires a registered environment');
  const mapping=normalizeImageMapping(rawMapping);
  const after=String(rawAfter||'');
  const page=await query(
    'SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND puzzle_id>$3 ORDER BY puzzle_id LIMIT $4',
    [setId,VERSION,after,IMAGE_REFRESH_PAGE_SIZE],
  );
  if(!page.rows.length)return {
    set_id:setId,
    mapping_entries:mapping.size,
    puzzles:0,
    updated_puzzles:0,
    updated_cards:0,
    next_after:null,
    done:true,
  };

  const updates=[];
  let updatedCards=0;
  for(const row of page.rows) {
    const current=parse(row.payload);
    if(!validateDraftRunPuzzle(current)||current.set_id!==setId||current.puzzle_id!==row.puzzle_id)throw error('Stored puzzle failed image-refresh verification',409);
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
    if(result.rows.length!==updates.length)throw error('Image refresh update count mismatch',409);
  }

  const nextAfter=page.rows.at(-1).puzzle_id;
  return {
    set_id:setId,
    mapping_entries:mapping.size,
    puzzles:page.rows.length,
    updated_puzzles:updates.length,
    updated_cards:updatedCards,
    next_after:page.rows.length===IMAGE_REFRESH_PAGE_SIZE?nextAfter:null,
    done:page.rows.length<IMAGE_REFRESH_PAGE_SIZE,
  };
}

export async function refreshTrophyImages(query,setId,rawMapping) {
  let after='',seen=0,updatedPuzzles=0,updatedCards=0,mappingEntries=null;
  for(;;) {
    const page=await refreshTrophyImagePage(query,setId,rawMapping,after);
    mappingEntries??=page.mapping_entries;
    seen+=page.puzzles;
    updatedPuzzles+=page.updated_puzzles;
    updatedCards+=page.updated_cards;
    if(page.done)break;
    if(!page.next_after||page.next_after===after)throw error('Image refresh cursor did not advance',409);
    after=page.next_after;
  }
  if(!seen)throw error('No verified puzzles are available for image refresh',409);
  return {set_id:setId,mapping_entries:mappingEntries,puzzles:seen,updated_puzzles:updatedPuzzles,updated_cards:updatedCards};
}

export async function normalizeResolvedImageMarkers(query,rawSetIds) {
  if(!Array.isArray(rawSetIds)||!rawSetIds.length||rawSetIds.length>allowed.size)throw error('Invalid image-marker set list');
  const setIds=rawSetIds.map(value=>String(value||'').trim());
  if(new Set(setIds).size!==setIds.length||setIds.some(setId=>!allowed.has(setId)))throw error('Image-marker normalization requires registered environments');
  const normalized=[];
  for(const setId of setIds) {
    const status=(await query(
      `SELECT s.corpus_version,
        (SELECT count(*)::int FROM draft_run_verified_puzzles p WHERE p.set_id=s.set_id AND p.corpus_version=$2) puzzles,
        (SELECT count(*)::int
          FROM draft_run_verified_puzzles p
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(p.payload->'candidates','[]'::jsonb) || COALESCE(p.payload->'prior_picks','[]'::jsonb)
          ) card
          WHERE p.set_id=s.set_id AND p.corpus_version=$2
            AND COALESCE(card->>'image_url','') NOT LIKE 'https://%') missing_images
       FROM draft_run_verified_sets s WHERE s.set_id=$1`,
      [setId,VERSION],
    )).rows[0];
    if(status?.corpus_version!==VERSION||Number(status.puzzles)<1)throw error(`Verified set unavailable for image-marker normalization: ${setId}`,409);
    if(Number(status.missing_images)!==0)throw error(`Cannot clear unresolved image markers while images are missing: ${setId}`,409);
    const result=await query(
      `UPDATE draft_run_verified_sets
       SET manifest=jsonb_set(
         jsonb_set(manifest,'{unresolved_image_names}','[]'::jsonb,true),
         '{full_import,missing_image_names}','[]'::jsonb,true
       )
       WHERE set_id=$1 AND corpus_version=$2
       RETURNING set_id`,
      [setId,VERSION],
    );
    if(result.rows.length!==1)throw error(`Image-marker normalization update failed: ${setId}`,409);
    normalized.push({set_id:setId,puzzles:Number(status.puzzles),missing_images:0});
  }
  return {normalized};
}

export async function insertTrophyBatch(query,puzzles,{componentVersion=null,sourceSnapshotId=null}={}) {
  if(!Array.isArray(puzzles)||!puzzles.length||puzzles.length>250||new Set(puzzles.map(p=>p.puzzle_id)).size!==puzzles.length)throw error('Invalid batch');
  if(componentVersion) {
    if(!supportedComponent(componentVersion))throw error('Unsupported source component');
    for(const sid of new Set(puzzles.map(p=>p.set_id))) {
      if(!(await query("SELECT 1 FROM corpus_components WHERE set_id=$1 AND component_version=$2 AND parent_version=$3 AND status='Candidate'",[sid,componentVersion,VERSION])).rows.length)throw error('Only an unpublished Candidate component accepts imports');
    }
  }
  if(sourceSnapshotId&&!/^[a-f0-9]{64}$/.test(sourceSnapshotId))throw error('Invalid source snapshot');
  if(sourceSnapshotId&&!(await query("SELECT 1 FROM corpus_source_snapshots WHERE source_snapshot_id=$1 AND lifecycle_status='Blocked'",[sourceSnapshotId])).rows.length)throw error('Source snapshot is not open for import',409);
  const dynamic=[...new Set(puzzles.map(p=>p.set_id).filter(s=>!allowed.has(s)))];
  const registered=new Set();
  for(const sid of dynamic){const r=await query("SELECT v.set_id FROM corpus_set_versions v LEFT JOIN corpus_sources s ON s.set_id=v.set_id AND s.event_type='PremierDraft' LEFT JOIN draft_run_environment_policy p ON p.set_id=v.set_id WHERE v.set_id=$1 AND v.corpus_version=$2 AND ((p.status='Candidate' AND p.source_event_type='PremierDraft') OR (p.set_id IS NULL AND v.manifest->>'discovered'='true' AND s.archive_available AND s.import_status IN ('building','validating')))",[sid,VERSION]);if(r.rows.length)registered.add(sid);}
  const batch=puzzles.map(p=>{
    if((!allowed.has(p.set_id)&&!registered.has(p.set_id))||!validateDraftRunPuzzle(p,componentVersion||VERSION)||!['puzzle_id','source_draft_hash','source_fingerprint'].every(k=>new RegExp(k==='source_fingerprint'?'^[a-f0-9]{64}$':'^[a-f0-9]{32}$').test(p[k]))||[...p.candidates,...p.prior_picks].some(c=>!c.image_url?.startsWith('https://')))throw error('Invalid verified puzzle');
    if(sourceSnapshotId&&p.source_snapshot_id!==sourceSnapshotId)throw error('Puzzle snapshot provenance mismatch');
    return {puzzle_id:p.puzzle_id,set_id:p.set_id,source_snapshot_id:sourceSnapshotId,source_draft_hash:p.source_draft_hash,corpus_version:p.corpus_version,pick_number:p.pick_number,candidate_count:p.candidates.length,consensus_top_gap:draftRunDifficulty(p).topGap,support_entropy:draftRunDifficulty(p).entropy,interesting:interestingDraftRunPuzzle(p),payload:p};
  });
  const r=await query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(puzzle_id text,set_id text,source_snapshot_id text,source_draft_hash text,corpus_version text,pick_number smallint,candidate_count smallint,consensus_top_gap real,support_entropy real,interesting boolean,payload jsonb)), conflicts AS (SELECT i.puzzle_id FROM incoming i JOIN draft_run_verified_puzzles e USING(puzzle_id) WHERE e.payload IS DISTINCT FROM i.payload), added AS (INSERT INTO draft_run_verified_puzzles(puzzle_id,set_id,source_snapshot_id,source_draft_hash,corpus_version,pick_number,candidate_count,consensus_top_gap,support_entropy,interesting,payload) SELECT * FROM incoming WHERE NOT EXISTS(SELECT 1 FROM conflicts) ON CONFLICT(puzzle_id) DO NOTHING RETURNING puzzle_id) SELECT (SELECT count(*) FROM conflicts)::int conflicts,(SELECT count(*) FROM added)::int added`,[JSON.stringify(batch)]);
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

  if(body.action==='refresh-images'||body.action==='refresh-image-page'||body.action==='normalize-image-markers') {
    if(identity.workflow_ref!==IMAGE_REFRESH_WORKFLOW)throw error('Image refresh identity denied',403);
    if(body.action==='refresh-images')return refreshTrophyImages(query,body.setId,body.mapping);
    if(body.action==='refresh-image-page')return refreshTrophyImagePage(query,body.setId,body.mapping,body.after);
    return normalizeResolvedImageMarkers(query,body.setIds);
  }
  if(identity.workflow_ref!==IMPORT_WORKFLOW)throw error('Trophy import identity denied',403);

  if(body.action==='refresh-statistics')return refreshServingStatistics(query);
  if(body.action==='batch')return {added:await insertTrophyBatch(query,body.puzzles,{sourceSnapshotId:body.sourceSnapshotId||null})};
  const sid=body.setId||body.manifest?.id;
  if(!allowed.has(sid))throw error('Environment not registered');
  const sourceSnapshotId=body.manifest?.source_snapshot_id||null;
  const status=(await query('SELECT s.corpus_version,(SELECT count(*)::int FROM draft_run_verified_puzzles p WHERE p.set_id=s.set_id AND p.corpus_version=$2 AND ($3::text IS NULL OR p.source_snapshot_id=$3)) puzzles FROM draft_run_verified_sets s WHERE s.set_id=$1',[sid,VERSION,sourceSnapshotId])).rows[0];
  if(status?.corpus_version!==VERSION)throw error('Baseline environment missing',409);
  if(body.action==='status')return {...status,puzzles:Number(status.puzzles)};
  if(body.action==='finish-set') {
    const m=body.manifest;
    if(!/^[a-f0-9]{64}$/.test(m?.source_snapshot_id||''))throw error('Missing source snapshot identity',409);
    const snapshotManifest=JSON.stringify({full_import:m});
    const snapshot=(await query(`INSERT INTO corpus_source_snapshots(
      source_snapshot_id,set_id,event_type,corpus_version,schema_version,draft_sha256,game_sha256,draft_etag,game_etag,
      draft_last_modified,game_last_modified,importer_identity,model_identity,manifest,lifecycle_status)
      VALUES($1,$2,'PremierDraft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'Blocked')
      ON CONFLICT(source_snapshot_id) DO NOTHING RETURNING source_snapshot_id,manifest`,
      [m.source_snapshot_id,sid,VERSION,m.schema_version,m.source_archive?.sha256,m.skill_source?.sha256,m.source_archive?.etag||null,m.skill_source?.etag||null,
       m.source_archive?.last_modified||null,m.skill_source?.last_modified||null,m.import_version,m.model_version,snapshotManifest])).rows[0]
      ||(await query('SELECT source_snapshot_id,manifest FROM corpus_source_snapshots WHERE source_snapshot_id=$1',[m.source_snapshot_id])).rows[0];
    const storedManifest=typeof snapshot?.manifest==='string'?JSON.parse(snapshot.manifest):snapshot?.manifest;
    if(snapshot?.source_snapshot_id!==m.source_snapshot_id||JSON.stringify(storedManifest)!==JSON.stringify(JSON.parse(snapshotManifest)))throw error('Existing source snapshot differs',409);
    if(m.corpus_version!==VERSION||m.import_version!=='all-premier-trophies-v1'||!Number.isInteger(m.total_puzzles)||m.total_puzzles<1||m.total_puzzles!==m.existing_puzzles_preserved+m.additional_puzzles||m.source_trophies!==m.included_trophies+m.excluded_trophies||!/^[a-f0-9]{64}$/.test(m.input_signature)||Number(status.puzzles)!==m.total_puzzles)throw error('Import accounting mismatch',409);
    await query("UPDATE draft_run_verified_sets SET manifest=jsonb_set(manifest,'{full_import}',$2::jsonb) WHERE set_id=$1",[sid,JSON.stringify({...m,github_run_id:identity.run_id,github_sha:identity.sha})]);
    return {puzzles:Number(status.puzzles)};
  }
  throw error('Unknown import action');
}
