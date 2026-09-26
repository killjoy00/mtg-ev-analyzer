// Health evidence is a pre-flight inspection, not a heartbeat. Serving never
// reads health rows; only an administrative action does: activating a Candidate
// snapshot, first publication of a Candidate environment, returning a Paused
// environment to Live, or publishing a component under its parent. Unchanged
// snapshots are immutable, so there is nothing to rescan on a timer.
//
// This report reads snapshot, policy and health metadata only - never puzzle
// payloads - so it is safe to schedule. It never writes and never fails because
// evidence is old; an operator runs one exact snapshot check when an action
// actually needs it.
// node scripts/corpus-health-freshness.mjs CONNECTION_FILE [--summary PATH]
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {CORPUS_GATE_VERSION,CORPUS_THRESHOLDS} from '../corpus-quality.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

export const HEALTH_EVIDENCE_HOURS=CORPUS_THRESHOLDS.healthMaxAgeDays*24;
export const EXPIRY_WARNING_HOURS=48;
export const SNAPSHOT_CHECK_WORKFLOW='Corpus snapshot health check';

const HOUR=60*60*1000;
const yes=value=>value===true||value==='t'||value===1||value==='1';

export async function loadHealthEvidenceRows(query) {
 return (await query(`WITH eligible AS (
  SELECT s.source_snapshot_id,s.set_id,s.schema_version,s.lifecycle_status,
   md5(s.manifest::text) manifest_hash,p.status environment_status,
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
 SELECT e.*,h.checked_at,h.ready,
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

// Only a snapshot an administrator could activate or reactivate consumes
// evidence. Everything else is an already-serving Live snapshot, whose evidence
// age is informational because serving does not depend on it.
export function classifyHealthEvidence(rows,{now=Date.now()}={}) {
 return rows.map(row=>{
  const active=yes(row.active),current=yes(row.evidence_current),ready=yes(row.ready);
  const checked=row.checked_at?Date.parse(row.checked_at):NaN;
  const expires=Number.isFinite(checked)?checked+HEALTH_EVIDENCE_HOURS*HOUR:null;
  const hoursLeft=current&&expires!=null?Math.max(0,Math.floor((expires-now)/HOUR)):null;
  // An active snapshot waits on an action only while its environment does (first
  // publication or reactivation); a non-active Candidate waits on activation.
  const actionPending=active?['Paused','Candidate'].includes(row.environment_status):row.lifecycle_status==='Candidate';
  let state;
  if(!actionPending)state='live-informational';
  else if(current&&!ready)state='blocked';
  else if(!current)state='check-before-action';
  else if(hoursLeft<=EXPIRY_WARNING_HOURS)state='expiring';
  else state='ready';
  return {
   set_id:row.set_id,
   source_snapshot_id:row.source_snapshot_id,
   lifecycle_status:row.lifecycle_status,
   environment_status:row.environment_status??null,
   active,
   state,
   last_result:row.checked_at?(ready?'passed':'failed'):'never checked',
   checked_at:row.checked_at?new Date(checked).toISOString():null,
   expires_at:current&&expires!=null?new Date(expires).toISOString():null,
   hours_left:hoursLeft,
   next_step:['check-before-action','expiring'].includes(state)
    ?`Before activation or reactivation, run "${SNAPSHOT_CHECK_WORKFLOW}" with snapshot_id=${row.source_snapshot_id}.`
    :state==='blocked'?'Latest health check failed; diagnose the blocked gates before any activation.':null,
  };
 });
}

export function summarizeHealthEvidence(items) {
 const count=state=>items.filter(item=>item.state===state).length;
 const live=items.filter(item=>item.state==='live-informational');
 const oldest=live.map(item=>item.checked_at).filter(Boolean).sort()[0]||null;
 return {
  report:'corpus-health-evidence-v1',
  scheduled_payload_scans:0,
  snapshots:items.length,
  live_informational:live.length,
  oldest_live_verification:oldest,
  ready:count('ready'),
  expiring:count('expiring'),
  check_before_action:count('check-before-action'),
  blocked:count('blocked'),
 };
}

const cell=value=>String(value??'—').replaceAll('|','\\|');

export function healthEvidenceMarkdown(summary,items) {
 const pending=items.filter(item=>item.state!=='live-informational');
 const lines=[
  '## Corpus health evidence',
  '',
  'Health evidence is checked before an administrative action, not on a timer. Live serving never depends on it, so old evidence on Live snapshots is expected and needs no scan.',
  '',
  `- Live snapshots: ${summary.live_informational} (oldest verification: ${summary.oldest_live_verification||'never'})`,
  `- Pending actions ready now: ${summary.ready}`,
  `- Evidence expiring within ${EXPIRY_WARNING_HOURS} hours: ${summary.expiring}`,
  `- Needs one exact snapshot check before activation or reactivation: ${summary.check_before_action}`,
  `- Latest check failed: ${summary.blocked}`,
  '',
 ];
 if(pending.length) {
  lines.push('| Set | Snapshot | Lifecycle | Environment | State | Last check | Expires | Next step |','|---|---|---|---|---|---|---|---|');
  for(const item of pending)lines.push(`| ${cell(item.set_id)} | \`${cell(item.source_snapshot_id)}\` | ${cell(item.lifecycle_status)} | ${cell(item.environment_status)} | ${cell(item.state)} | ${cell(item.checked_at)} (${cell(item.last_result)}) | ${cell(item.expires_at)} | ${cell(item.next_step)} |`);
 } else lines.push('No Candidate or Paused snapshot is waiting on an action.');
 return lines.join('\n')+'\n';
}

async function main() {
 const args=process.argv.slice(2);
 const connectionFile=args[0];
 if(!connectionFile||connectionFile.startsWith('--'))throw Error('Usage: node scripts/corpus-health-freshness.mjs CONNECTION_FILE [--summary PATH]');
 const summaryIndex=args.indexOf('--summary');
 const summaryPath=summaryIndex>=0?args[summaryIndex+1]:null;
 if(summaryIndex>=0&&!summaryPath)throw Error('--summary requires a file path.');
 const items=classifyHealthEvidence(await loadHealthEvidenceRows(corpusDatabase(connectionFile)));
 const summary=summarizeHealthEvidence(items);
 console.log(JSON.stringify({...summary,items}));
 // Annotations surface pending work without failing the run.
 for(const item of items)if(['expiring','check-before-action','blocked'].includes(item.state))
  console.log(`::warning title=Corpus health ${item.state}::${item.set_id} ${item.source_snapshot_id}: ${item.next_step}`);
 if(summaryPath)fs.appendFileSync(summaryPath,healthEvidenceMarkdown(summary,items));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
