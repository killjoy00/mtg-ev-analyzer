import assert from 'node:assert/strict';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {
 MAX_MANAGED_SNAPSHOTS,
 loadCorpusHealthRefreshRows,
 planCorpusHealthRefresh
} from '../scripts/plan-corpus-health-refresh.mjs';

const connectionFile=process.argv[2];
if(!connectionFile)throw Error('Usage: node tests/corpus-health-refresh-backend-smoke.mjs CONNECTION_FILE');
const query=corpusDatabase(connectionFile);
const rows=await loadCorpusHealthRefreshRows(query);
assert.ok(rows.length>0,'Expected at least one active/Candidate corpus source snapshot after migration 0041.');
assert.ok(rows.length<=MAX_MANAGED_SNAPSHOTS,
 `Current production-shaped inventory (${rows.length}) exceeds bounded health scheduler capacity (${MAX_MANAGED_SNAPSHOTS}).`);
for(const row of rows) {
 assert.ok(row.lifecycle_status==='Candidate'||row.active===true||row.active==='t',
  'Health scheduler inventory must contain only Candidate or active snapshots.');
}
const plan=planCorpusHealthRefresh(rows);
assert.equal(plan.over_capacity,false);
assert.equal(plan.eligible_snapshots,rows.length);
console.log(JSON.stringify({
 smoke:'corpus_health_refresh',
 eligible_snapshots:rows.length,
 max_managed_snapshots:MAX_MANAGED_SNAPSHOTS,
 action:plan.action,
 hard_deadline_risk:plan.hard_deadline_risk
}));
