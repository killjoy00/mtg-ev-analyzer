// Reviewed pinned-source audit only; preserve all historical payloads/results.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DRAFT_RUN_CORPUS_VERSION as version} from '../draft-run.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
const reasonCodes=new Set(['source_missing_from_pinned_archive','inconsistent_source_metadata','not_a_premier_trophy','trophy_losses_unverified','invalid_premier_trophy_outcome']);
export function validateAudit(report) {
 if(report.production_changed!==false||!Array.isArray(report.sets)||report.sets.length!==32||new Set(report.sets.map(s=>s.set)).size!==32)throw Error('Complete read-only 32-set audit required');
 let blocked=0;
 for(const s of report.sets) {
  if(s.corpus_version!==version||!/^[-a-z0-9]+$/.test(s.set)||!Array.isArray(s.blocked_sources)||s.approved_sources+s.blocked_sources.length!==s.included_sources||!/^[a-f0-9]{64}$/.test(s.input_signature)||!/^[a-f0-9]{64}$/.test(s.source_archive?.sha256))throw Error('Invalid audit accounting');
  if(Object.keys(s.approved_outcomes).some(k=>!['7-0','7-1','7-2'].includes(k))||Object.values(s.approved_outcomes).reduce((n,v)=>n+v,0)!==s.approved_sources)throw Error('Invalid approved outcomes');
  if(new Set(s.blocked_sources.map(x=>x.source_draft_hash)).size!==s.blocked_sources.length||s.blocked_sources.some(x=>!/^[a-f0-9]{32}$/.test(x.source_draft_hash)||!reasonCodes.has(x.reason)||!Number.isInteger(x.puzzles)||x.puzzles<1))throw Error('Invalid source exclusions');
  if(s.blocked_sources.reduce((n,x)=>n+x.puzzles,0)!==s.excluded_decisions)throw Error('Excluded decision accounting mismatch');
  blocked+=s.blocked_sources.length;
 }
 if(blocked!==report.blocked_sources)throw Error('Total source accounting mismatch');
 return report;
}
export async function applyAudit(query,report,auditHash) {
 validateAudit(report);
 // Preflight every set before the first insert. The report cannot point at a
 // newer source archive or a corpus different from the one actually imported.
 for(const s of report.sets) {
  const found=(await query("SELECT manifest->'full_import' AS manifest FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2",[s.set,version])).rows[0];
  const m=typeof found?.manifest==='string'?JSON.parse(found.manifest):found?.manifest;
  if(m?.input_signature!==s.input_signature||m.source_archive?.sha256!==s.source_archive.sha256||m.included_trophies!==s.included_sources)throw Error('Audit does not match stored source manifest: '+s.set);
  if(s.blocked_sources.length) {
   const counts=(await query('SELECT source_draft_hash,count(*)::int n FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND source_draft_hash IN (SELECT value FROM jsonb_array_elements_text($3::jsonb)) GROUP BY source_draft_hash',[s.set,version,JSON.stringify(s.blocked_sources.map(x=>x.source_draft_hash))])).rows;
   const byHash=new Map(counts.map(x=>[x.source_draft_hash,Number(x.n)]));
   if(s.blocked_sources.some(x=>byHash.get(x.source_draft_hash)!==x.puzzles))throw Error('Audit does not match stored puzzle counts: '+s.set);
  }
 }
 for(const s of report.sets)if(s.blocked_sources.length)await query(`INSERT INTO corpus_source_exclusions(set_id,corpus_version,source_draft_hash,reason,evidence)
  SELECT $1,$2,x.source_draft_hash,x.reason,jsonb_build_object('audit_sha256',$4::text,'source_archive_sha256',$5::text,'source',to_jsonb(x))
  FROM jsonb_to_recordset($3::jsonb) x(source_draft_hash text,reason text,puzzles integer,wins integer,losses integer)
  ON CONFLICT(set_id,corpus_version,source_draft_hash) DO NOTHING`,[s.set,version,JSON.stringify(s.blocked_sources),auditHash,s.source_archive.sha256]);
 return {sets:report.sets.length,excluded_sources:report.blocked_sources,historical_payloads_changed:0};
}
if(process.argv[1]?.endsWith('/load-source-exclusions.mjs')) {
 const bytes=fs.readFileSync(process.argv[3]),report=validateAudit(JSON.parse(bytes));
 if(process.argv.includes('--validate-only'))console.log('Complete audit validated; no database mutation.');
 else console.log(JSON.stringify(await applyAudit(corpusDatabase(process.argv[2]),report,createHash('sha256').update(bytes).digest('hex'))));
}
