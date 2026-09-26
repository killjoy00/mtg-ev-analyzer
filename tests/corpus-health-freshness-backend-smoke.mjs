import assert from 'node:assert/strict';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {
 loadHealthEvidenceRows,
 classifyHealthEvidence,
 summarizeHealthEvidence,
 healthEvidenceMarkdown
} from '../scripts/corpus-health-freshness.mjs';

const connectionFile=process.argv[2];
if(!connectionFile||!process.argv.includes('--dev-fixtures'))
 throw Error('Usage: node tests/corpus-health-freshness-backend-smoke.mjs CONNECTION_FILE --dev-fixtures');
const rows=await loadHealthEvidenceRows(corpusDatabase(connectionFile));
assert.ok(rows.length>0,'Expected at least one active/Candidate corpus source snapshot after migration 0041.');
const items=classifyHealthEvidence(rows);
const states=new Set(['live-informational','ready','expiring','check-before-action','blocked']);
for(const item of items) {
 assert.ok(item.lifecycle_status==='Candidate'||item.active,'Evidence report must contain only Candidate or active snapshots.');
 assert.ok(states.has(item.state),'Unknown evidence state: '+item.state);
 if(item.active&&item.environment_status==='Live')
  assert.equal(item.state,'live-informational','A serving Live snapshot never needs a scheduled scan.');
}
const summary=summarizeHealthEvidence(items);
assert.equal(summary.scheduled_payload_scans,0);
assert.equal(summary.snapshots,rows.length);
assert.match(healthEvidenceMarkdown(summary,items),/## Corpus health evidence/);
console.log(JSON.stringify({smoke:'corpus_health_evidence_report',...summary}));
