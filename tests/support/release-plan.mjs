import fs from 'node:fs';
import assert from 'node:assert/strict';
export function assertSecurePlan(workflow,migration) {
 const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json'));
 assert.ok(manifest.release_paths['secure-auth-release'].migrations.includes(migration.replace(/^migrations\//,'')),'Migration belongs to reviewed release plan');
 assert.equal(workflow.split('node scripts/apply-release-migrations.mjs secure-auth-release').length-1,2,'Both environments must use the ledger runner');
}
