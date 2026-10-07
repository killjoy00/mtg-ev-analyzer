import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));
const migrationDir='migrations';
const sqlFiles=fs.readdirSync(migrationDir).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
const ordered=manifest.ordered||[];
const historical=new Set(manifest.historical_or_one_time||[]);
const releasePaths=manifest.release_paths||{};

const sorted=value=>[...value].sort();

test('migration manifest registers every SQL migration exactly once',()=>{
  assert.equal(new Set(ordered).size,ordered.length,'manifest.ordered contains duplicates');
  assert.deepEqual(sorted(ordered),sqlFiles,'every migration SQL file must be registered in manifest.ordered');
});

test('every migration has an explicit lifecycle disposition',()=>{
  const releaseOwned=new Set();
  for(const plan of Object.values(releasePaths)) {
    for(const migration of plan.migrations||[]) releaseOwned.add(migration);
  }
  const covered=new Set([...historical,...releaseOwned]);
  assert.deepEqual(sorted(covered),sqlFiles,'each migration must be historical/one-time or assigned to at least one release path');
  for(const migration of historical) {
    assert.ok(ordered.includes(migration),`historical migration is not registered: ${migration}`);
  }
});

test('same numeric prefixes have an explicit deterministic order',()=>{
  const groups=new Map();
  for(const migration of sqlFiles) {
    const prefix=migration.slice(0,4);
    if(!groups.has(prefix))groups.set(prefix,[]);
    groups.get(prefix).push(migration);
  }
  const collisions=Object.fromEntries([...groups].filter(([,files])=>files.length>1));
  assert.deepEqual(
    sorted(Object.keys(manifest.same_prefix_order||{})),
    sorted(Object.keys(collisions)),
    'every duplicate numeric prefix must be explicitly declared in same_prefix_order',
  );
  for(const [prefix,files] of Object.entries(collisions)) {
    const declared=manifest.same_prefix_order[prefix];
    assert.deepEqual(sorted(declared),sorted(files),`same_prefix_order.${prefix} must name exactly the colliding files`);
    let previous=-1;
    for(const migration of declared) {
      const index=ordered.indexOf(migration);
      assert.ok(index>previous,`same-prefix migration order is not reflected in manifest.ordered: ${migration}`);
      previous=index;
    }
  }
});

test('release workflows match their registered migration plans and order',()=>{
  for(const [name,plan] of Object.entries(releasePaths)) {
    assert.ok(plan.workflow&&Array.isArray(plan.migrations)&&plan.migrations.length,`invalid release path: ${name}`);
    const workflow=fs.readFileSync(plan.workflow,'utf8');
    if(workflow.includes(`node scripts/ci-migration-plan.mjs ${name}`)) {
      assert.ok(workflow.includes('ON_ERROR_STOP=1 -f "$migration"'));
      const orderedPlan=ordered.filter(migration=>plan.migrations.includes(migration));
      assert.deepEqual(plan.migrations,orderedPlan,`${name} must follow authoritative dependency order`);
      continue;
    }
    const refs=[...workflow.matchAll(/migrations\/([A-Za-z0-9_.-]+\.sql)/g)].map(match=>match[1]);
    const unique=[...new Set(refs)];
    assert.deepEqual(
      sorted(unique),
      sorted(plan.migrations),
      `${name} workflow migration references drifted from migrations/manifest.json`,
    );
    let previous=-1;
    for(const migration of plan.migrations) {
      const index=workflow.lastIndexOf(`migrations/${migration}`);
      assert.ok(index>=0,`${name} is missing ${migration}`);
      assert.ok(index>previous,`${name} applies/references migrations out of registered order near ${migration}`);
      previous=index;
    }
  }
});

test('manifest release paths reference only registered migrations and real workflows',()=>{
  for(const [name,plan] of Object.entries(releasePaths)) {
    assert.ok(fs.existsSync(plan.workflow),`release path ${name} points at a missing workflow`);
    for(const migration of plan.migrations) {
      assert.ok(ordered.includes(migration),`release path ${name} references unregistered migration ${migration}`);
      assert.ok(fs.existsSync(path.join(migrationDir,migration)),`release path ${name} references missing migration ${migration}`);
    }
  }
});
