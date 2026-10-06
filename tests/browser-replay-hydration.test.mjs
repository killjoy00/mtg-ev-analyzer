import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/hydrate-browser-replays.sh', import.meta.url).pathname;
function run(failures, message) {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-replay-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'bin'));
    writeFileSync(path.join(root, 'scripts/r2_replay_shards.sh'), `#!/bin/bash
test "$1" = hydrate || exit 90
count=$(cat count 2>/dev/null || echo 0)
count=$((count + 1)); echo "$count" > count
if [ "$count" -le ${failures} ]; then echo '${message}'; exit 7; fi
echo 'hydrated'
`);
    for (const command of ['aws', 'sleep']) writeFileSync(path.join(root, 'bin', command), `#!/bin/sh\necho '${command}' "$@" >> calls\n`, { mode: 0o755 });
    const result = spawnSync('bash', [script], { cwd: root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, encoding: 'utf8' });
    return { ...result, count: Number(readFileSync(path.join(root, 'count'), 'utf8')), calls: readFileSync(path.join(root, 'calls'), 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const throttle = 'An error occurred (ServiceUnavailable): Reduce your rate of simultaneous reads on the same object.';
test('browser hydration limits classic S3 downloads and resumes throttled sync', () => {
  const result = run(2, throttle);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.count, 3);
  assert.match(result.calls, /aws configure set default.s3.preferred_transfer_client classic/);
  assert.match(result.calls, /aws configure set default.s3.max_concurrent_requests 1/);
  assert.match(result.calls, /sleep 15\nsleep 30/);
});
test('persistent throttling fails after three attempts', () => {
  const result = run(99, throttle);
  assert.equal(result.status, 7);
  assert.equal(result.count, 3);
});
test('other storage errors fail immediately', () => {
  const result = run(99, 'AccessDenied: missing credentials');
  assert.equal(result.status, 7);
  assert.equal(result.count, 1);
  assert.doesNotMatch(result.calls, /sleep/);
});
