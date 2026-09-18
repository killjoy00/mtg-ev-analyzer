// Read every included puzzle once; persist an operational report, never gameplay mutations.
// node scripts/check-corpus-health.mjs CONNECTION [set-id ...]
import {registerHealthyCandidate} from './corpus-candidate.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION,validateDraftRunPuzzle,interestingDraftRunPuzzle,runPickWindows} from '../draft-run.mjs';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import {corpusGates} from '../corpus-quality.mjs';
const query=corpusDatabase(process.argv[2]);
const requested=process.argv.slice(3),parse=x=>typeof x==='string'?JSON.parse(x):x;
const sets=(await query('SELECT set_id,manifest,md5(manifest::text) manifest_hash FROM corpus_set_versions WHERE corpus_version=$1 ORDER BY set_id',[DRAFT_RUN_CORPUS_VERSION])).rows.filter(s=>!requested.length||requested.includes(s.set_id));
for(const s of sets) {
 const manifest=parse(s.manifest),f=manifest.full_import||{},windows=runPickWindows(s.set_id==='powered-cube'?'powered-cube':'mixed'),picks=new Set(windows.map(w=>w[0]));
 const groups=(await query(`SELECT p.pick_number,r.band,count(DISTINCT p.source_draft_hash)::int sources FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id) WHERE p.set_id=$1 AND p.corpus_version=$2 AND p.interesting AND r.difficulty_version='support-ratio-v1' GROUP BY p.pick_number,r.band`,[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows;
 const ledger=(await query(`SELECT count(*)::int trophies,count(*) FILTER(WHERE qualified)::int qualified,count(*) FILTER(WHERE included)::int included,count(*) FILTER(WHERE qualified AND NOT included)::int qualified_excluded,sum(puzzle_count)::int puzzles FROM corpus_trophy_trajectories WHERE set_id=$1 AND corpus_version=$2`,[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 const previous=(await query('SELECT report FROM corpus_health_checks WHERE set_id=$1 AND corpus_version=$2 ORDER BY checked_at DESC,id DESC LIMIT 1',[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 let after='',total=0,usable=0,cards=0,images=0,metadata=0,broken=0,invalidSupport=0,n=0,logLoss=0,top1=0,rank=0;
 const byPick={},bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
 for(;;) {
  const page=(await query('SELECT puzzle_id,payload FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND puzzle_id>$3 ORDER BY puzzle_id LIMIT 1000',[s.set_id,DRAFT_RUN_CORPUS_VERSION,after])).rows;
  if(!page.length)break;
  for(const row of page) {
   after=row.puzzle_id;total++;const p=parse(row.payload);
   if(!validateDraftRunPuzzle(p)){broken++;continue;}
   for(const c of [...p.candidates,...p.prior_picks]){cards++;images+=/^https:\/\//.test(c.image_url||'');metadata+=Boolean(c.id&&c.name&&c.type_line);}
   const probabilities=p.candidates.map(c=>c.model_probability),valid=probabilities.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)<=.01;
   if(!valid){invalidSupport++;continue;}
   if(!picks.has(p.pick_number))continue;
   if(interestingDraftRunPuzzle(p)){usable++;byPick[p.pick_number]=(byPick[p.pick_number]||0)+1;}
   const sorted=[...p.candidates].sort((a,b)=>b.model_probability-a.model_probability||a.id.localeCompare(b.id)),actual=sorted.findIndex(c=>c.id===p.historical_pick_id),prob=sorted[actual]?.model_probability;
   if(actual<0){broken++;continue;}
   n++;logLoss-=Math.log(Math.max(1e-12,prob));top1+=actual===0;rank+=actual+1;
   const confidence=sorted[0].model_probability,bin=bins[Math.min(9,Math.floor(confidence*10))];bin.n++;bin.p+=confidence;bin.y+=actual===0;
  }
 }
 const metrics={archiveValid:Boolean(f.source_archive?.sha256&&f.input_signature&&f.schema_verified),versionValid:f.corpus_version===DRAFT_RUN_CORPUS_VERSION&&f.model_version===catalog.model_version,qualifiedTrophies:Number(ledger.qualified),usablePuzzles:usable,
  minimumPickBandSources:Math.min(...[...picks].flatMap(p=>['medium','hard'].map(b=>Number(groups.find(g=>Number(g.pick_number)===p&&g.band===b)?.sources||0)))),
  accountingValid:Number(ledger.trophies)===f.source_trophies&&Number(ledger.included)===f.included_trophies&&Number(ledger.qualified)===f.qualified_trophies&&Number(ledger.puzzles)===total&&total===f.total_puzzles,
  brokenTrajectories:broken,qualifiedExclusionRate:Number(ledger.qualified)?Number(ledger.qualified_excluded)/Number(ledger.qualified):null,previousQualifiedExclusionRate:parse(previous?.report)?.metrics?.qualifiedExclusionRate,
  metadataCoverage:cards?metadata/cards:0,imageCoverage:cards?images/cards:0,invalidSupport,puzzlesByPick:byPick,totalPuzzles:total,
  validation:{heldout:f.holdout==='5-fold by draft_id',cohort:'Qualified trophy decisions, first eight; source-held-out model probabilities. Not population-wide calibration.',examples:n,logLoss:n?logLoss/n:null,top1:n?top1/n:null,meanRank:n?rank/n:null,calibrationError:n?bins.reduce((a,b)=>a+Math.abs(b.p-b.y),0)/n:null,bins}};
 const report=corpusGates(metrics);
 // Reject a report if an import changed the manifest while it was being scanned.
 const saved=await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report) SELECT set_id,corpus_version,$3,$4,$5::boolean,$6::jsonb FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2 AND md5(manifest::text)=$3 RETURNING id`,[s.set_id,DRAFT_RUN_CORPUS_VERSION,s.manifest_hash,report.gate_version,report.ready,JSON.stringify(report)]);
 if(!saved.rows.length)throw Error('Manifest changed during health verification: '+s.set_id);
 if(report.ready)await registerHealthyCandidate(query,s.set_id,s.manifest_hash);
 console.log(JSON.stringify({set:s.set_id,ready:report.ready,blocked:report.gates.filter(g=>!g.pass).map(g=>g.id),puzzles:total}));
}
