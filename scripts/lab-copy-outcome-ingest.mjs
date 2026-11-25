// Reviewed additive import only. Validate before any SQL write; preserve
// exact bytes and reject a changed result for the same source/definition.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {COPY_VERSION,validateCopyOutcomes} from '../research/pack-one-lab/copy-outcomes.mjs';
const SHA=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('lab-copy-artifact-invalid');};
export async function readCatalogCopyArtifacts(directory,catalog){
  const entries=catalog.lab_copy_outcomes??[];
  if(!Array.isArray(entries)||entries.length>catalog.sets.length)fail();
  const seen=new Set(),out=[];
  for(const e of entries){
    if(!e||!SHA.test(e.artifact_sha256||'')||!SHA.test(e.game_sha256||'')||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.set_id||'')||e.definition!==COPY_VERSION||seen.has(e.set_id))fail();
    seen.add(e.set_id);
    const set=catalog.sets.find(s=>s.id===e.set_id);
    if(!set||set.skill_source?.sha256!==e.game_sha256||set.source_event_type!=='PremierDraft')fail();
    const bytes=await readFile(path.join(directory,e.set_id,'lab-copy-outcomes.json'));
    if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==e.artifact_sha256)fail();
    const report=bytes.toString('utf8');
    // Re-encoding must preserve original artifact bytes.
    if(createHash('sha256').update(report).digest('hex')!==e.artifact_sha256)fail();
    validateCopyOutcomes(JSON.parse(report),{set_id:e.set_id,game_sha256:e.game_sha256});
    out.push({...e,report});
  }
  return out;
}
export async function storeCopyArtifact(query,e){
  if(!SHA.test(e.artifact_sha256||'')||typeof e.report!=='string'||Buffer.byteLength(e.report)>16*1024*1024||createHash('sha256').update(e.report).digest('hex')!==e.artifact_sha256||e.definition!==COPY_VERSION)fail();
  validateCopyOutcomes(JSON.parse(e.report),{set_id:e.set_id,game_sha256:e.game_sha256});
  const params=[e.set_id,e.game_sha256,e.definition,e.artifact_sha256,e.report];
  await query("INSERT INTO public.pack1_lab_copy_outcomes(set_id,game_sha256,definition,artifact_sha256,report) SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM corpus_source_snapshots WHERE set_id=$1 AND game_sha256=$2 AND event_type='PremierDraft') ON CONFLICT(set_id,game_sha256,definition) DO NOTHING",params);
  const row=(await query('SELECT artifact_sha256,report FROM public.pack1_lab_copy_outcomes WHERE set_id=$1 AND game_sha256=$2 AND definition=$3',params.slice(0,3))).rows[0];
  if(row?.artifact_sha256!==e.artifact_sha256||row.report!==e.report)fail();
}
