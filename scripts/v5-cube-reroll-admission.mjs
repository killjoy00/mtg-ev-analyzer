// Final assembly only: retain immutable trained payloads that support the real
// eight-source session contract. Environment artifacts and model code stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import modelVersions from '../model-versions.json' with {type:'json'};
import {interestingDraftRunPuzzle,eligiblePickForRound,draftRunRerollDistance,runPickWindows} from '../draft-run.mjs';
import {rateDraftRunPuzzle,MAX_REROLL_RATING_DELTA} from '../draft-run-difficulty.mjs';
import {DRAFT_RUN_LENGTH,DRAFT_RUN_SELECTION_VERSION,eligibleRunPuzzle,earlyRoundsForSelection} from '../draft-run-policy.mjs';
import {meetsServingQuality} from '../serving-quality.mjs';

export const CUBE_SESSION_ADMISSION_VERSION='eight-source-two-pack-rerolls-v1';
const OTHER_SOURCES=DRAFT_RUN_LENGTH-1;
const distinct=rows=>new Set(rows.map(p=>p.source_draft_hash)).size;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function graph(rows) {
  const windows=runPickWindows('powered-cube',DRAFT_RUN_SELECTION_VERSION);
  if(DRAFT_RUN_LENGTH!==8||windows.length!==8||windows.some(([a,b])=>a!==b))throw Error('Review Cube admission for the changed selection contract.');
  const ids=new Set(),metrics=new Map(),groups=new Map(),pool=[];
  for(const p of rows) {
    if(p.set_id!=='powered-cube'||ids.has(p.puzzle_id))throw Error('Expected unique Powered Cube decisions.');
    ids.add(p.puzzle_id);
    if(!interestingDraftRunPuzzle(p)||!meetsServingQuality(p)||!eligibleRunPuzzle(p))continue;
    const round=windows.findIndex((_,i)=>eligiblePickForRound(i,p.pick_number,'powered-cube'));
    const rating=rateDraftRunPuzzle(p);
    if(round<0||(round>=earlyRoundsForSelection(DRAFT_RUN_SELECTION_VERSION)&&rating.band==='easy'))continue;
    metrics.set(p,rating);pool.push(p);
    const key=`${round}:${rating.band}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(p);
  }
  const neighbors=new Map();
  for(const group of groups.values())for(const a of group)neighbors.set(a,group.filter(b=>
    a.source_draft_hash!==b.source_draft_hash&&Math.abs(a.pick_number-b.pick_number)<=1&&
    Math.abs(metrics.get(a).rating-metrics.get(b).rating)<=MAX_REROLL_RATING_DELTA&&
    draftRunRerollDistance(a,b)<=.16));
  return {pool,metrics,neighbors,groups};
}

function secondChoices(current,metrics,origin,first) {
  return current.get(first).filter(p=>p.source_draft_hash!==origin.source_draft_hash&&
    Math.abs(metrics.get(p).rating-metrics.get(origin).rating)<=MAX_REROLL_RATING_DELTA);
}

function failures(kept,metrics,neighbors) {
  const current=new Map([...kept].map(p=>[p,neighbors.get(p).filter(q=>kept.has(q))]));
  // Nine alternatives leave two after any seven other session sources vanish.
  const sparse=[...kept].filter(p=>distinct(current.get(p))<OTHER_SOURCES+2);
  const endpoints=new Set();let minimumSecond=Infinity;
  for(const origin of kept)for(const first of current.get(origin)) {
    const n=distinct(secondChoices(current,metrics,origin,first));
    minimumSecond=Math.min(minimumSecond,n);
    // Eight distinct second choices leave one after those same seven exclusions.
    // Check ALL possible first choices: exclusions can change the closest 20.
    if(n<OTHER_SOURCES+1){endpoints.add(origin);endpoints.add(first);}
  }
  return {current,sparse,endpoints,minimumSecond};
}

export function verifyCubeSessionRerolls(rows) {
  const {pool,metrics,neighbors,groups}=graph(rows),kept=new Set(pool);
  const check=failures(kept,metrics,neighbors);
  return {valid:pool.length>0&&!check.sparse.length&&!check.endpoints.size,
    selectable_decisions:pool.length,other_run_sources:OTHER_SOURCES,
    minimum_first_sources:pool.length?Math.min(...pool.map(p=>distinct(check.current.get(p)))):0,
    minimum_second_sources:Number.isFinite(check.minimumSecond)?check.minimumSecond:0,
    coverage:Object.fromEntries([...groups].map(([key,items])=>[key,distinct(items)]))};
}

export function pruneCubeSessionRerollDeadEnds(rows) {
  const {pool,metrics,neighbors}=graph(rows),kept=new Set(pool),removed=[];
  while(kept.size) {
    const check=failures(kept,metrics,neighbors);
    // Remove low-degree nodes first. Removing every unsafe origin together can
    // destroy a sound dense cluster just because it still touches a sparse fringe.
    if(check.sparse.length) {
      for(const p of check.sparse){kept.delete(p);removed.push(p.puzzle_id);}
      continue;
    }
    if(!check.endpoints.size)break;
    // Trim one least-supported endpoint, then re-evaluate the remaining graph.
    const discard=[...check.endpoints].sort((a,b)=>distinct(check.current.get(a))-distinct(check.current.get(b))||a.puzzle_id.localeCompare(b.puzzle_id))[0];
    kept.delete(discard);removed.push(discard.puzzle_id);
  }
  const excluded=new Set(removed),result=rows.filter(p=>!excluded.has(p.puzzle_id));
  return {rows:result,removed:removed.sort(),proof:verifyCubeSessionRerolls(result)};
}

export function admitV5Cube(root='.') {
  const file=path.join(root,'corpus/draft-run/powered-cube.json.gz'),catalogFile=path.join(root,'corpus/draft-run/catalog.json');
  const reportFile=path.join(root,'generated/v5-cube-reroll-admission.json');
  const before=fs.readFileSync(file),catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
  const entry=catalog.sets.find(s=>s.id==='powered-cube');
  if(catalog.corpus_version!==modelVersions.v5.corpus_version||catalog.model_version!==modelVersions.v5.model_version||entry?.sha256!==digest(before))throw Error('Cube admission requires the exact assembled v5/v9 corpus.');
  if(fs.existsSync(reportFile)) {
    const saved=JSON.parse(fs.readFileSync(reportFile,'utf8'));
    if(saved.schema===CUBE_SESSION_ADMISSION_VERSION&&saved.output_sha256===digest(before))return saved;
  }
  const original=JSON.parse(gunzipSync(before));
  if(original.some(p=>p.corpus_version!==modelVersions.v5.corpus_version||p.model_version!==modelVersions.v5.model_version))throw Error('Mixed Cube model/corpus identity.');
  const {rows,removed,proof}=pruneCubeSessionRerollDeadEnds(original);
  if(!proof.valid)throw Error('No Cube corpus satisfies the session reroll contract.');
  for(let round=0;round<DRAFT_RUN_LENGTH;round++)for(const band of ['medium','hard']) {
    if(!(proof.coverage[`${round}:${band}`]>=OTHER_SOURCES+3))throw Error(`Cube admission cannot preserve balanced runs: round ${round} ${band}.`);
  }
  const bytes=gzipSync(JSON.stringify(rows),{mtime:0});
  const report={schema:CUBE_SESSION_ADMISSION_VERSION,corpus_version:modelVersions.v5.corpus_version,
    model_version:modelVersions.v5.model_version,input_sha256:digest(before),output_sha256:digest(bytes),
    input_decisions:original.length,output_decisions:rows.length,removed_decisions:removed.length,
    removed_puzzle_ids:removed,proof,model_payloads_changed:false,environment_artifacts_changed:false};
  entry.puzzles=rows.length;entry.trophy_drafts=distinct(rows);entry.sha256=report.output_sha256;
  entry.exclusions={...entry.exclusions,session_reroll_dead_end_decisions:removed.length};
  fs.writeFileSync(file,bytes);fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');
  fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const report=admitV5Cube();
  console.log(JSON.stringify({schema:report.schema,input:report.input_decisions,retained:report.output_decisions,removed:report.removed_decisions,proof:report.proof}));
}
