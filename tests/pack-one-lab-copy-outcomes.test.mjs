import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readCatalogCopyArtifacts,storeCopyArtifact} from '../scripts/lab-copy-outcome-ingest.mjs';
import {readCopyOutcomes} from '../research/pack-one-lab/copy-outcomes.mjs';
const meta={set_id:'fixture',game_sha256:'a'.repeat(64)};
const report={schema_version:1,definition:'copy-outcomes-v1',set_id:meta.set_id,event_type:'PremierDraft',source_sha256:meta.game_sha256,source:'17Lands public game data (CC BY 4.0)',raw_games:500,games:500,wins:250,drafts:80,invalid_games:0,duplicate_games:0,known_stratum_games:0,minimum_games:150,minimum_drafts:30,cards:{'Fixture Card':{all:{'1':[75,150,30],'2+':[100,200,40]},strata:{}}}};
const raw=JSON.stringify(report)+'\n',sha=createHash('sha256').update(raw).digest('hex');
const entry={...meta,definition:'copy-outcomes-v1',artifact_sha256:sha};
const catalog={sets:[{id:meta.set_id,source_event_type:'PremierDraft',skill_source:{sha256:meta.game_sha256}}],lab_copy_outcomes:[entry]};
test('reviewed catalog binds artifact bytes and source, and DB read verifies exact bytes',async()=>{
  const tmp=await mkdtemp(path.join(tmpdir(),'lab-outcomes-'));
  try{
    await mkdir(path.join(tmp,meta.set_id));
    const file=path.join(tmp,meta.set_id,'lab-copy-outcomes.json');
    await writeFile(file,raw);
    const [artifact]=await readCatalogCopyArtifacts(tmp,catalog);
    assert.equal(artifact.report,raw);
    let row=null;
    const query=async(sql,args)=>{
      if(sql.startsWith('INSERT')){row??={artifact_sha256:args[3],report:args[4]};return {rows:[]};}
      return {rows:row?[row]:[]};
    };
    await storeCopyArtifact(query,artifact);
    await storeCopyArtifact(query,artifact);
    assert.deepEqual(await readCopyOutcomes(meta,query),{report,artifact_sha256:sha});
    row.report=raw+' ';
    await assert.rejects(readCopyOutcomes(meta,query),/lab-copy-outcomes-invalid/);
    await assert.rejects(storeCopyArtifact(query,artifact),/lab-copy-artifact-invalid/);
    await writeFile(file,raw+' ');
    await assert.rejects(readCatalogCopyArtifacts(tmp,catalog),/lab-copy-artifact-invalid/);
    assert.deepEqual(await readCatalogCopyArtifacts(tmp,{sets:[]}),[]);
    await assert.rejects(readCatalogCopyArtifacts(tmp,{...catalog,lab_copy_outcomes:[{...entry,set_id:'../other'}]}),/lab-copy-artifact-invalid/);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
