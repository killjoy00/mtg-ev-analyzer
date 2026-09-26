import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

export const HEALTH_GATE_HOURS=7*24;
export const HEALTH_REFRESH_CADENCE_HOURS=4;
export const HEALTH_SAFETY_HOURS=24;
export const MAX_MANAGED_SNAPSHOTS=Math.floor((HEALTH_GATE_HOURS-HEALTH_SAFETY_HOURS)/HEALTH_REFRESH_CADENCE_HOURS);

const yes=value=>value===true||value==='t'||value===1||value==='1';
const time=value=>value?Date.parse(value):Number.NEGATIVE_INFINITY;

export function planCorpusHealthRefresh(rows,{now=Date.now()}={}) {
 const cadenceMs=HEALTH_REFRESH_CADENCE_HOURS*60*60*1000;
 const gateMs=HEALTH_GATE_HOURS*60*60*1000;
 const safetyMs=HEALTH_SAFETY_HOURS*60*60*1000;
 const ordered=[...rows].map(row=>{
  const evidenceCurrent=yes(row.evidence_current);
  const checkedAt=time(row.checked_at);
  const deadline=evidenceCurrent&&Number.isFinite(checkedAt)?checkedAt+gateMs:Number.NEGATIVE_INFINITY;
  return {...row,evidence_current:evidenceCurrent,deadline};
 }).sort((a,b)=>a.deadline-b.deadline||String(a.set_id).localeCompare(String(b.set_id))||String(a.source_snapshot_id).localeCompare(String(b.source_snapshot_id)));

 let minHardSlack=Number.POSITIVE_INFINITY,minSafetySlack=Number.POSITIVE_INFINITY;
 ordered.forEach((row,index)=>{
  const completion=now+(index+1)*cadenceMs;
  minHardSlack=Math.min(minHardSlack,row.deadline-completion);
  minSafetySlack=Math.min(minSafetySlack,row.deadline-completion-safetyMs);
 });
 const overCapacity=ordered.length>MAX_MANAGED_SNAPSHOTS;
 const hardDeadlineRisk=ordered.length>0&&minHardSlack<0;
 const first=ordered[0]||null;
 const invalidFirst=first&&!first.evidence_current;
 const shouldRefresh=Boolean(first)&&(invalidFirst||minSafetySlack<=0);
 return {
  policy:'oldest-deadline-first-v1',
  cadence_hours:HEALTH_REFRESH_CADENCE_HOURS,
  health_gate_hours:HEALTH_GATE_HOURS,
  safety_hours:HEALTH_SAFETY_HOURS,
  max_managed_snapshots:MAX_MANAGED_SNAPSHOTS,
  eligible_snapshots:ordered.length,
  cycle_hours:ordered.length*HEALTH_REFRESH_CADENCE_HOURS,
  over_capacity:overCapacity,
  hard_deadline_risk:hardDeadlineRisk,
  minimum_hard_slack_hours:Number.isFinite(minHardSlack)?Math.floor(minHardSlack/3600000):null,
  action:shouldRefresh?'refresh':'idle',
  selected:shouldRefresh&&first?{
   source_snapshot_id:first.source_snapshot_id,
   set_id:first.set_id,
   schema_version:first.schema_version,
   lifecycle_status:first.lifecycle_status,
   active:yes(first.active),
   checked_at:first.checked_at||null,
   evidence_current:first.evidence_current,
   estimated_puzzles:Number(first.estimated_puzzles||0)
  }:null
 };
}

export async function loadCorpusHealthRefreshRows(query) {
 return (await query(`WITH eligible AS (
  SELECT s.source_snapshot_id,s.set_id,s.schema_version,s.lifecycle_status,s.created_at,
   md5(s.manifest::text) manifest_hash,
   coalesce((s.manifest->'full_import'->>'total_puzzles')::bigint,0) estimated_puzzles,
   (p.active_snapshot_id=s.source_snapshot_id) active
  FROM corpus_source_snapshots s
  LEFT JOIN draft_run_environment_policy p ON p.set_id=s.set_id
  WHERE s.corpus_version=$1
    AND s.lifecycle_status NOT IN ('Retired','Superseded')
    AND (
      s.lifecycle_status='Candidate'
      OR (p.active_snapshot_id=s.source_snapshot_id AND p.status IN ('Live','Paused','Candidate'))
    )
 )
 SELECT e.*,h.checked_at,h.ready,h.manifest_hash health_manifest_hash,h.gate_version,
  (h.checked_at>now()-interval '7 days'
   AND h.manifest_hash=e.manifest_hash
   AND h.gate_version=$2) evidence_current
 FROM eligible e
 LEFT JOIN LATERAL(
  SELECT checked_at,ready,manifest_hash,gate_version
  FROM corpus_health_checks h
  WHERE h.source_snapshot_id=e.source_snapshot_id
  ORDER BY checked_at DESC,id DESC LIMIT 1
 ) h ON true
 ORDER BY e.set_id,e.source_snapshot_id`,[DRAFT_RUN_CORPUS_VERSION,CORPUS_GATE_VERSION])).rows;
}

async function main() {
 const connectionFile=process.argv[2];
 if(!connectionFile)throw Error('Usage: node scripts/plan-corpus-health-refresh.mjs CONNECTION_FILE');
 const query=corpusDatabase(connectionFile);
 const rows=await loadCorpusHealthRefreshRows(query);
 console.log(JSON.stringify(planCorpusHealthRefresh(rows)));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
