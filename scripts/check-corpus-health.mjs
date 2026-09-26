import {effectiveCardMetadata} from '../card-metadata.mjs';
import {meetsServingQuality,SERVING_QUALITY_SQL,SERVING_POLICY_VERSION} from '../serving-quality.mjs';
// Read every included puzzle once; persist an operational report, never gameplay mutations.
// node scripts/check-corpus-health.mjs CONNECTION [set-id ...]
// node scripts/check-corpus-health.mjs CONNECTION --snapshot SOURCE_SNAPSHOT_ID
// Evidence age is reported by scripts/corpus-health-freshness.mjs, which reads no payloads.
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
const rawArgs=process.argv.slice(3),requested=[],parse=x=>typeof x==='string'?JSON.parse(x):x;
let requestedSnapshot=null;
for(let i=0;i<rawArgs.length;i++) {
 if(rawArgs[i]==='--snapshot') {
  if(requestedSnapshot||!rawArgs[i+1])throw Error('Use --snapshot exactly once with a source snapshot ID.');
  requestedSnapshot=rawArgs[++i];
 } else if(rawArgs[i].startsWith('--'))throw Error('Unknown corpus health option: '+rawArgs[i]);
 else requested.push(rawArgs[i]);
}
if(requestedSnapshot&&requested.length)throw Error('Choose exact --snapshot health or set IDs, not both.');
let sets;
if(requestedSnapshot) {
 sets=(await query(`SELECT s.set_id,s.manifest,md5(s.manifest::text) manifest_hash,s.source_snapshot_id,
   (s.schema_version='historical-frozen') historical
  FROM corpus_source_snapshots s
  JOIN corpus_set_versions v ON v.set_id=s.set_id AND v.corpus_version=s.corpus_version
  WHERE s.source_snapshot_id=$2 AND s.corpus_version=$1 AND s.lifecycle_status<>'Retired'`,
  [DRAFT_RUN_CORPUS_VERSION,requestedSnapshot])).rows;
 if(sets.length!==1)throw Error('Requested source snapshot is missing, retired, or outside the current corpus: '+requestedSnapshot);
} else {
 sets=(await query(`WITH versions AS (
 SELECT * FROM corpus_set_versions WHERE corpus_version=$1
), first_class AS (
 SELECT s.*,row_number() OVER(PARTITION BY s.set_id ORDER BY s.created_at DESC,s.source_snapshot_id DESC) rn
 FROM corpus_source_snapshots s JOIN versions v USING(set_id,corpus_version)
 WHERE s.schema_version<>'historical-frozen' AND s.lifecycle_status<>'Retired'
), wanted_first_class AS (
 SELECT * FROM first_class WHERE rn=1
 UNION
 SELECT s.* FROM corpus_source_snapshots s
 JOIN draft_run_environment_policy p ON p.active_snapshot_id=s.source_snapshot_id
 JOIN versions v ON v.set_id=s.set_id AND v.corpus_version=s.corpus_version
 WHERE s.schema_version<>'historical-frozen'
), historical AS (
 SELECT s.* FROM corpus_source_snapshots s JOIN versions v USING(set_id,corpus_version)
 WHERE s.schema_version='historical-frozen'
), wanted_historical AS (
 SELECT v.set_id,coalesce(h.manifest,v.manifest) manifest,
  md5(coalesce(h.manifest,v.manifest)::text) manifest_hash,h.source_snapshot_id,true historical
 FROM versions v
 LEFT JOIN draft_run_environment_policy p USING(set_id)
 LEFT JOIN historical h ON h.set_id=v.set_id AND h.corpus_version=v.corpus_version
 WHERE NOT EXISTS(SELECT 1 FROM first_class s WHERE s.set_id=v.set_id)
    OR (h.source_snapshot_id IS NOT NULL AND p.active_snapshot_id=h.source_snapshot_id)
)
SELECT set_id,manifest,manifest_hash,source_snapshot_id,historical FROM wanted_historical
UNION ALL
SELECT s.set_id,s.manifest,md5(s.manifest::text),s.source_snapshot_id,false
FROM wanted_first_class s
ORDER BY set_id,source_snapshot_id NULLS FIRST`,[DRAFT_RUN_CORPUS_VERSION])).rows.filter(s=>!requested.length||requested.includes(s.set_id));
}
for(const s of sets) {
 const manifest=parse(s.manifest),f=manifest.full_import||{},windows=runPickWindows(s.set_id==='powered-cube'?'powered-cube':'mixed'),picks=new Set(windows.map(w=>w[0]));
 const historical=s.historical===true||s.historical==='t';
 const puzzleSnapshotId=historical?null:(s.source_snapshot_id||null);
 const groups=(await query(`SELECT p.pick_number,r.band,count(DISTINCT p.source_draft_hash)::int sources FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id) WHERE p.set_id=$1 AND p.corpus_version=$2 AND ($3::text IS NULL OR p.source_snapshot_id=$3) AND p.interesting AND ${SERVING_QUALITY_SQL} AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash) AND r.difficulty_version='support-ratio-v1' GROUP BY p.pick_number,r.band`,[s.set_id,DRAFT_RUN_CORPUS_VERSION,puzzleSnapshotId])).rows;
 const ledger=s.source_snapshot_id&&!historical
  ?(await query(`SELECT count(*)::int trophies,count(*) FILTER(WHERE qualified)::int qualified,count(*) FILTER(WHERE included)::int included,count(*) FILTER(WHERE qualified AND NOT included)::int qualified_excluded,sum(puzzle_count)::int puzzles FROM corpus_source_snapshot_trajectories WHERE source_snapshot_id=$1`,[s.source_snapshot_id])).rows[0]
  :(await query(`SELECT count(*)::int trophies,count(*) FILTER(WHERE qualified)::int qualified,count(*) FILTER(WHERE included)::int included,count(*) FILTER(WHERE qualified AND NOT included)::int qualified_excluded,sum(puzzle_count)::int puzzles FROM corpus_trophy_trajectories WHERE set_id=$1 AND corpus_version=$2`,[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 const previous=(await query('SELECT report FROM corpus_health_checks WHERE set_id=$1 AND corpus_version=$2 AND source_snapshot_id IS NOT DISTINCT FROM $3 ORDER BY checked_at DESC,id DESC LIMIT 1',[s.set_id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id||null])).rows[0];
 const audit=frozenAudit.sets.find(a=>a.set===s.set_id),sourceAuditMatches=matchesFrozenSourceAudit(f,audit);
 const excluded=new Set((await query('SELECT source_draft_hash FROM corpus_source_exclusions WHERE set_id=$1 AND corpus_version=$2',[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows.map(x=>x.source_draft_hash));
 if(sourceAuditMatches&&audit.blocked_sources.some(x=>!excluded.has(x.source_draft_hash)))throw Error('Missing audited source exclusion: '+s.set_id);
 let after='',total=0,usable=0,cards=0,images=0,metadata=0,storedMetadata=0,broken=0,invalidSupport=0,excludedDecisions=0;
 const byPick={},probabilitiesAudit=probabilityMetrics(null,DRAFT_RUN_CORPUS_VERSION),trajectoryAudit=trajectoryHealth();
 for(;;) {
  const page=(await query('SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND ($3::text IS NULL OR source_snapshot_id=$3) AND puzzle_id>$4 ORDER BY puzzle_id LIMIT 1000',[s.set_id,DRAFT_RUN_CORPUS_VERSION,puzzleSnapshotId,after])).rows;
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
 if(report.ready)await registerHealthyCandidate(query,s.set_id,s.manifest_hash,historical?null:(s.source_snapshot_id||null));
 console.log(JSON.stringify({set:s.set_id,ready:report.ready,blocked:report.gates.filter(g=>!g.pass).map(g=>g.id),puzzles:total}));
}
