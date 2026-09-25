import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SHARD_REQUIREMENTS = new Map([
  ['consensus-audit.test.mjs', ['msh']],
  ['path-model-distribution.test.mjs', ['msh', 'sos', 'tmt', 'ecl']],
  ['scoring-distribution.test.mjs', ['msh', 'sos', 'tmt', 'ecl']],
]);

async function hasReplayShards(setId) {
  try {
    const files = await readdir(join('data', setId, 'shards'));
    return files.some((name) => name.endsWith('.json'));
  } catch {
    return false;
  }
}

const available = new Map();
for (const setIds of SHARD_REQUIREMENTS.values()) {
  for (const setId of setIds) {
    if (!available.has(setId)) available.set(setId, await hasReplayShards(setId));
  }
}

const tests = (await readdir('tests'))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

const missingByTest = new Map();
for (const [testName, setIds] of SHARD_REQUIREMENTS) {
  const missing = setIds.filter((setId) => !available.get(setId));
  if (missing.length) missingByTest.set(testName, missing);
}

if (missingByTest.size && process.env.REQUIRE_REPLAY_SHARDS === '1') {
  const detail = [...missingByTest]
    .map(([testName, setIds]) => `${testName}: ${setIds.join(', ')}`)
    .join('; ');
  console.error(`Replay shards are required for this CI run but are not hydrated (${detail}).`);
  process.exit(1);
}

const selected = tests.filter((name) => !missingByTest.has(name));
for (const [testName, setIds] of missingByTest) {
  console.warn(`SKIP ${testName} — replay shards not hydrated for ${setIds.join(', ')}. Run scripts/r2_replay_shards.sh hydrate when R2 credentials are available.`);
}

const result = spawnSync(process.execPath, ['--test', ...selected.map((name) => join('tests', name))], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
