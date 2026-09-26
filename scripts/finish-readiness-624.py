from pathlib import Path

# Keep production-importable smoke logic separate from the command-line entry.
p=Path('scripts/activated-snapshot-smoke.mjs'); s=p.read_text(); split=s.index('\nasync function main()')
core=s[:split].replace("import {fileURLToPath} from 'node:url';\n",'').replace("import {resolve} from 'node:path';\n",'').replace("from '../worker/draft-run-selection.mjs'","from './draft-run-selection.mjs'")
Path('worker/activated-snapshot-smoke.mjs').write_text(core+'\n')
cli="import {fileURLToPath} from 'node:url';\nimport {resolve} from 'node:path';\nimport {gameDateKey} from '../game-date.mjs';\nimport {runActivatedSnapshotSmoke,runRecentActivationSmokes} from '../worker/activated-snapshot-smoke.mjs';\nexport * from '../worker/activated-snapshot-smoke.mjs';\nconst fail=message=>{throw Error('Activated snapshot smoke: '+message);};\n"+s[split:]
p.write_text(cli)
p=Path('worker/corpus-readiness.mjs'); s=p.read_text().replace("from '../scripts/activated-snapshot-smoke.mjs'", "from './activated-snapshot-smoke.mjs'")
s=s.replace("SELECT pack1_claim_readiness($1::bigint,$2) job',[before.key_id,release]", "SELECT pack1_claim_readiness($1::bigint,$2,$3::bigint) job',[before.key_id,release,before.operation_id]")
s=s.replace('This operation is current, running, already ready, or superseded.', 'This operation is not retryable: it is running, already ready, or superseded.')
p.write_text(s)
p=Path('migrations/0043_corpus_activation_readiness.sql'); s=p.read_text()
s=s.replace('pack1_claim_readiness(p_key bigint,p_release text)', 'pack1_claim_readiness(p_key bigint,p_release text,p_expected_id bigint DEFAULT NULL)')
old=' IF NOT FOUND THEN RETURN NULL; END IF;\n IF j.state='
assert old in s
s=s.replace(old," IF NOT FOUND OR (p_expected_id IS NOT NULL AND j.id<>p_expected_id) THEN RETURN NULL; END IF;\n IF j.state=",1)
p.write_text(s)

p=Path('tests/activated-snapshot-smoke.test.mjs'); s=p.read_text()
s=s.replace("new URL('../scripts/activated-snapshot-smoke.mjs',import.meta.url)","new URL('../worker/activated-snapshot-smoke.mjs',import.meta.url)")
s=s.replace("e\\.component_version IS NULL AND e\\.new_status='Live'", "e\\.new_status='Live'")
s=s.replace("  if(sql.includes('pack1_serving_snapshot'))", "  if(sql.includes('SELECT revision::text FROM draft_run_serving_revision'))return {rows:[{revision:'1'}]};\n  if(sql.includes('pack1_serving_snapshot'))")
p.write_text(s)

p=Path('tests/corpus-readiness-backend-smoke.mjs'); s=p.read_text()
a=s.index(" child=spawn(process.execPath,['--input-type=module','-e',`import {corpusDatabase}")
b=s.index(" child=spawn(process.execPath,['--input-type=module','-e',`setInterval",a)
s=s[:a]+s[b:]
p.write_text(s)

p=Path('.github/workflows/backend-gate.yml'); s=p.read_text()
s=s.replace("      - name: Run SQL-backed integration suites\n        shell: bash\n        env:\n", "      - name: Run SQL-backed integration suites\n        shell: bash\n        env:\n          PACK1_CI_BRANCH_ID: ${{ steps.neon.outputs.branch_id }}\n")
s=s.replace('      - name: Delete isolated Neon branch', '''      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: corpus-readiness-isolated-${{ github.run_id }}
          path: artifacts/corpus-readiness
          if-no-files-found: ignore
          retention-days: 30

      - name: Delete isolated Neon branch''')
p.write_text(s)
p=Path('.github/workflows/e2e.yml'); s=p.read_text()
s=s.replace('      - name: Upload UI screenshots', '''      - name: Run corpus readiness browser contract
        if: steps.scope.outputs.run_full == 'true'
        run: node tests/corpus-readiness-e2e.mjs
      - name: Upload UI screenshots''')
p.write_text(s)

p=Path('docs/PRACTICE-SERVING-CACHE.md'); s=p.read_text()
a=s.index('Apply the reviewed pending migrations through 0042'); b=s.index('\nRollback Functions',a)
s=s[:a]+'''Apply the reviewed pending migrations through 0043 before deploying Functions.
Replaying 0039/0041/0042 must be followed by 0043 to preserve the readiness gate.
The original coherent builder is retained as `pack1_build_serving_snapshot`;
`pack1_serving_snapshot` serves only the current verified generation for a
registered release cache key. It never delegates a pending build to a player.
The guarded release registers the complete corpus/difficulty/policy/schema key
and runs `node scripts/warm-practice-cache.mjs` on development, then production.
A successful process exit means the current revision is built and serving-verified,
not merely that an activation or job insertion committed. `--inspect` is read-only
and fails if current readiness is not established.

## Durable activation and recovery (#624)

The existing authenticated admin lifecycle and guarded component-publication
paths retain their admission gates. Each actual serving-revision change queues
readiness in the same transaction using a deferred outbox trigger. The trigger
captures the final source/component intent and associates its revision with the
audit event. Non-serving Candidate staging retains 0042's no-churn behavior.
Activation commits before the initiating handler runs one readiness attempt;
no activation transaction or publication lock spans the expensive cache build.
The response distinguishes `activation_committed` from `ok` and `readiness.ready`.
A lost response does not prove rollback: inspect the audit/status rather than
blindly replaying the activation. Snapshot switches also accept the UI's expected
active snapshot to reject a stale administration form.

Readiness states are queued, warming, verifying, retry_wait, ready, failed and
superseded. The lightweight admin readiness read includes operation/current
revision, attempts, lease, cache generation, exact worker release, proof and
sanitized errors. The dashboard shows admission quality separately from serving
readiness, retains #614's active/staged/retained counts and offers authorized
readiness retry without changing publication. Polling never claims or builds work.

An executor claims a five-minute fenced lease, builds with the existing advisory
single-builder lock, audits compact inventory against the runtime predicate in
both directions, and exercises the affected source through cached practice,
rerolls and Daily/Latest planning where applicable. Cube uses its real P2-P9
windows. A representative multi-set sample is also verified. No schedule,
session, score or finished practice run is created by these proofs.
The short completion transaction locks and checks the current revision, complete
cache key, lease token, captured intent and Pacific verification date. A writer
cannot commit between that check and marking ready. Any newer serving revision
supersedes previous readiness immediately; obsolete workers cannot make it ready.

Transient failures have at most four attempts per retry cycle with backoff.
Expired leases and due retries are recovered by the existing authenticated
`pack1-account-deletion-maintenance` invocation (every ten minutes), after its
existing identity verification. This adds no recurring compute wakeup schedule
and leaves scale-to-zero settings unchanged. The daily corpus smoke is a second
backstop; explicit guarded warmup and authorized admin retry use the same
executor. Terminal verification failures require inspection and an explicit retry;
there is no automatic rollback, obsolete-generation fallback or quality bypass.
If persistence fails too, the durable lease expires and remains recoverable.
At most 128 completed/superseded operations per key are retained, separately from
the unchanged two-generation cache storage bound.

A bounded refresh window is intentional: new cache-dependent practice requests
receive a retryable 503 while readiness is pending or failed. They do not build
or silently use stale counts. Existing fixed Dailies and stored historical runs
keep their established paths. Do not automatically replay non-idempotent starts;
retain the existing start idempotency key or ask the player to retry.

This is not a zero-downtime staged-publication design. Automatic recovery can
wait for the next ten-minute maintenance invocation after interruption; the admin
can explicitly retry when safe. A successful prior job does not guarantee future
readiness after another publication, and a healthy unchanged Live corpus does not
need recurring full-payload health scans merely to keep serving.
''' +s[b:]
p.write_text(s)
print('Readiness integration, isolated evidence and recovery docs prepared.')
