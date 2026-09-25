import {effectiveCardMetadata} from '../card-metadata.mjs';
import {meetsServingQuality,SERVING_QUALITY_SQL,SERVING_POLICY_VERSION} from '../serving-quality.mjs';
// Read every included puzzle once; persist an operational report, never gameplay mutations.
// node scripts/check-corpus-health.mjs CONNECTION [set-id ...]
import fs from 'node:fs';
import {validateAudit} from './load-source-exclusions.mjs';
import {probabilityMetrics,trajectoryHealth,matchesFrozenSourceAudit} from './corpus-health-evidence.mjs';
import {registerHealthyCandidate} from './corpus-candidate.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION,validateDraftRunPuzzle,interestingDraftRunPuzzle,runPickWindows} from '../draft-run.mjs';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import {corpusGates} from '../corpus-quality.mjs';
const query=corpusDatabase(process.argv[2]);
const frozenAudit=validateAudit(JSON.parse(fs.readFileSync('results/rebuild-2026-09-18/frozen-premier-outcomes.json')));
const requested=process.argv.slice(3),parse=x=>typeof x==='string'?JSON.parse(x):x;
const aging=(await query(`SELECT set_id,max(checked_at) checked_at FROM corpus_health_checks
 WHERE ready AND corpus_version=$1 GROUP BY set_id HAVING max(checked_at)<now()-interval '5 days'`,[DRAFT_RUN_CORPUS_VERSION])).rows;
for(const row of aging)console.warn(JSON.stringify({warning:'corpus_health_aging',set:row.set_id,last_health_verification:row.checked_at}));
const sets=(await query(`SELECT v.set_id,coalesce(s.manifest,v.manifest) manifest,
 md5(coalesce(s.manifest,v.manifest)::text) manifest_hash,s.source_snapshot_id
 FROM corpus_set_versions v
 LEFT JOIN LATERAL (
  SELECT * FROM corpus_source_snapshots q
  WHERE q.set_id=v.set_id AND q.corpus_version=v.corpus_version AND q.schema_version<>'historical-frozen'
  ORDER BY q.created_at DESC LIMIT 1
 ) s ON true
 WHERE v.corpus_version=$1 ORDER BY v.set_id`,[DRAFT_RUN_CORPUS_VERSION])).rows.filter(s=>!requested.length||requested.includes(s.set_id));
for(const s of sets) {
 const manifest=parse(s.manifest),f=manifest.full_import||{},windows=runPickWindows(s.set_id==='powered-cube'?'powered-cube':'mixed'),picks=new Set(windows.map(w=>w[0]));
 const groups=(await query(`SELECT p.pick_number,r.band,count(DISTINCT p.source_draft_hash)::int sources FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id) WHERE p.set_id=$1 AND p.corpus_version=$2 AND ($3::text IS NULL OR p.source_snapshot_id=$3) AND p.interesting AND ${SERVING_QUALITY_SQL} AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash) AND r.difficulty_version='support-ratio-v1' GROUP BY p.pick_number,r.band`,[s.set_id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id||null])).rows;
 const ledger=s.source_snapshot_id
  ?(await query(`SELECT count(*)::int trophies,count(*) FILTER(WHERE qualified)::int qualified,count(*) FILTER(WHERE included)::int included,count(*) FILTER(WHERE qualified AND NOT included)::int qualified_excluded,sum(puzzle_count)::int puzzles FROM corpus_source_snapshot_trajectories WHERE source_snapshot_id=$1`,[s.source_snapshot_id])).rows[0]
  :(await query(`SELECT count(*)::int trophies,count(*) FILTER(WHERE qualified)::int qualified,count(*) FILTER(WHERE included)::int included,count(*) FILTER(WHERE qualified AND NOT included)::int qualified_excluded,sum(puzzle_count)::int puzzles FROM corpus_trophy_trajectories WHERE set_id=$1 AND corpus_version=$2`,[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 const previous=(await query('SELECT report FROM corpus_health_checks WHERE set_id=$1 AND corpus_version=$2 AND source_snapshot_id IS NOT DISTINCT FROM $3 ORDER BY checked_at DESC,id DESC LIMIT 1',[s.set_id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id||null])).rows[0];
 const audit=frozenAudit.sets.find(a=>a.set===s.set_id),sourceAuditMatches=matchesFrozenSourceAudit(f,audit);
 const excluded=new Set((await query('SELECT source_draft_hash FROM corpus_source_exclusions WHERE set_id=$1 AND corpus_version=$2',[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows.map(x=>x.source_draft_hash));
 if(sourceAuditMatches&&audit.blocked_sources.some(x=>!excluded.has(x.source_draft_hash)))throw Error('Missing audited source exclusion: '+s.set_id);
 let after='',total=0,usable=0,cards=0,images=0,metadata=0,storedMetadata=0,broken=0,invalidSupport=0,excludedDecisions=0;
 const byPick={},probabilitiesAudit=probabilityMetrics(null,DRAFT_RUN_CORPUS_VERSION),trajectoryAudit=trajectoryHealth();
 for(;;) {
  const page=(await query('SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND ($3::text IS NULL OR source_snapshot_id=$3) AND puzzle_id>$4 ORDER BY puzzle_id LIMIT 1000',[s.set_id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id||null,after])).rows;
  if(!page.length)break;
  for(const row of page) {
   after=row.puzzle_id;total++;const p=parse(row.payload);
   if(!validateDraftRunPuzzle(p)){broken++;continue;}
   if(excluded.has(p.source_draft_hash)){excludedDecisions++;continue;}
   trajectoryAudit.add(p);
   for(const c of [...p.candidates,...p.prior_picks]){cards++;images+=/^https:\/\//.test(c.image_url||'');storedMetadata+=Boolean(c.id&&c.name&&c.type_line);metadata+=Boolean(c.id&&c.name&&effectiveCardMetadata(c).type_line);}
   const probabilities=p.candidates.map(c=>c.model_probability),valid=probabilities.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)<=.01;
   if(!valid){invalidSupport++;continue;}
   if(!picks.has(p.pick_number))continue;
   if(interestingDraftRunPuzzle(p)&&meetsServingQuality(p)){usable++;byPick[p.pick_number]=(byPick[p.pick_number]||0)+1;}
   probabilitiesAudit.add(p);
  }
 }
 const metrics={archiveValid:Boolean(f.source_archive?.sha256&&f.input_signature&&(f.schema_verified||sourceAuditMatches)),versionValid:f.corpus_version===DRAFT_RUN_CORPUS_VERSION&&f.model_version===catalog.model_version,qualifiedTrophies:Number(ledger.qualified),usablePuzzles:usable,
  minimumPickBandSources:Math.min(...[...picks].flatMap(p=>['medium','hard'].map(b=>Number(groups.find(g=>Number(g.pick_number)===p&&g.band===b)?.sources||0)))),
  accountingValid:Number(ledger.trophies)===f.source_trophies&&Number(ledger.included)===f.included_trophies&&Number(ledger.qualified)===f.qualified_trophies&&Number(ledger.puzzles)===total&&total===f.total_puzzles,
  servingPolicyVersion:SERVING_POLICY_VERSION,fingerprintVariations:trajectoryAudit.fingerprintVariations(),brokenTrajectories:broken+trajectoryAudit.errors(),excludedDecisions,sourceAudit:sourceAuditMatches?{sourceArchiveSha256:audit.source_archive.sha256,outcomes:audit.approved_outcomes,approvedSources:audit.approved_sources,excludedSources:audit.blocked_sources.length}:null,qualifiedExclusionRate:Number(ledger.qualified)?Number(ledger.qualified_excluded)/Number(ledger.qualified):null,previousQualifiedExclusionRate:parse(previous?.report)?.metrics?.qualifiedExclusionRate,
  metadataCoverage:cards?metadata/cards:0,storedMetadataCoverage:cards?storedMetadata/cards:0,metadataRepairs:metadata-storedMetadata,imageCoverage:cards?images/cards:0,invalidSupport,puzzlesByPick:byPick,totalPuzzles:total,
  validation:{heldout:f.holdout==='5-fold by draft_id',cohort:'Qualified trophy decisions, first eight; source-held-out model probabilities with the frozen display calibration. Raw log loss is also reported. Not population-wide calibration.',...probabilitiesAudit.report()}};
 const report=corpusGates(metrics);
 // Reject a report if an import changed the manifest while it was being scanned.
 const saved=s.source_snapshot_id
  ?await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,source_snapshot_id,manifest_hash,gate_version,ready,report)
    SELECT set_id,corpus_version,source_snapshot_id,$4,$5,$6::boolean,$7::jsonb FROM corpus_source_snapshots
    WHERE source_snapshot_id=$3 AND set_id=$1 AND corpus_version=$2 AND md5(manifest::text)=$4 RETURNING id`,
    [s.set_id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id,s.manifest_hash,report.gate_version,report.ready,JSON.stringify(report)])
  :await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report)
    SELECT set_id,corpus_version,$3,$4,$5::boolean,$6::jsonb FROM corpus_set_versions
    WHERE set_id=$1 AND corpus_version=$2 AND md5(manifest::text)=$3 RETURNING id`,
    [s.set_id,DRAFT_RUN_CORPUS_VERSION,s.manifest_hash,report.gate_version,report.ready,JSON.stringify(report)]);
 if(!saved.rows.length)throw Error('Manifest changed during health verification: '+s.set_id);
 if(report.ready)await registerHealthyCandidate(query,s.set_id,s.manifest_hash,s.source_snapshot_id||null);
 console.log(JSON.stringify({set:s.set_id,ready:report.ready,blocked:report.gates.filter(g=>!g.pass).map(g=>g.id),puzzles:total}));
}
