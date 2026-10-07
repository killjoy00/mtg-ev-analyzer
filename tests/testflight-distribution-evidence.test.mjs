import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const scenario of ['available', 'wrong-build', 'read-failed']) {
  test(`read-only exact-build status: ${scenario}`, () => {
    const script = `
      import assert from 'node:assert/strict';
      import { generateKeyPairSync } from 'node:crypto';
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      Object.assign(process.env, { ASC_ISSUER_ID: 'test', ASC_KEY_ID: 'test',
        ASC_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), PACKONE_ASC_APP_ID: 'app' });
      delete process.env.GITHUB_STEP_SUMMARY;
      delete process.env.PACKONE_STATUS_OUTPUT;
      process.argv[2] = '100500';
      globalThis.fetch = async (url, options) => {
        assert.equal(options.method ?? 'GET', 'GET', 'status must never mutate a provider');
        const parsed = new URL(url);
        let data;
        if (parsed.pathname === '/v1/builds') {
          assert.equal(parsed.searchParams.get('filter[app]'), 'app');
          assert.equal(parsed.searchParams.get('filter[version]'), '100500');
          data = { data: [{ id: 'exact', attributes: { version: '${scenario === 'wrong-build' ? '100415' : '100500'}', processingState: 'VALID' } }] };
        } else if (parsed.pathname === '/v1/builds/exact/buildBetaDetail') {
          if ('${scenario}' === 'read-failed') return new Response('Unavailable', { status: 503 });
          data = { data: { attributes: { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'READY_FOR_BETA_SUBMISSION' } } };
        } else if (parsed.pathname === '/v1/betaGroups') {
          assert.equal(parsed.searchParams.get('filter[builds]'), 'exact');
          assert.equal(parsed.searchParams.has('filter[app]'), false, 'only one relationship filter');
          data = { data: [{ id: 'existing', attributes: { isInternalGroup: true, hasAccessToAllBuilds: true } }] };
        } else if (parsed.pathname === '/v1/apps/app/betaFeedbackCrashSubmissions') {
          assert.equal(parsed.searchParams.get('filter[build]'), 'exact');
          assert.equal(parsed.searchParams.get('sort'), '-createdDate');
          data = { data: [] };
        } else throw Error('Unexpected API request');
        return new Response(JSON.stringify(data), { status: 200 });
      };
      await import('./.github/scripts/app-store-build-status.mjs');
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    if (scenario === 'available') {
      assert.equal(run.status, 0, run.stderr);
      const result = JSON.parse(run.stdout);
      assert.equal(result.latest.version, '100500');
      assert.equal(result.testFlight.internalBuildState, 'IN_BETA_TESTING');
      assert.equal(result.testFlight.testersOrGroupsChanged, false);
      assert.equal(result.testFlight.groupListComplete, true);
    } else {
      assert.notEqual(run.status, 0);
      if (scenario === 'wrong-build') assert.match(run.stderr, /does not contain requested build/);
      else {
        const result = JSON.parse(run.stdout);
        assert.equal(result.testFlight.verified, false);
        assert.match(result.testFlight.reason, /503/);
        assert.match(run.stderr, /availability could not be read/);
      }
    }
  });
}

// Isolated API contract: generated test key, stubbed fetch, no provider traffic.
for (const available of [true, false]) {
  test(`candidate attachment ${available ? 'verifies TestFlight availability separately' : 'fails when TestFlight availability cannot be verified'}`, () => {
    const script = `
      import { generateKeyPairSync } from 'node:crypto';
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      Object.assign(process.env, { ASC_ISSUER_ID: 'test', ASC_KEY_ID: 'test',
        ASC_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), PACKONE_ASC_APP_ID: 'app', PACKONE_ASC_VERSION: '1.0' });
      delete process.env.GITHUB_STEP_SUMMARY;
      process.argv[2] = '999999';
      const build = { id: 'build', attributes: { version: '999999', processingState: 'VALID', buildAudienceType: 'APP_STORE_ELIGIBLE' } };
      const writes = [];
      globalThis.fetch = async (url, options) => {
        const path = new URL(url).pathname;
        const method = options.method;
        let data;
        if (method !== 'GET') {
          writes.push({ path, method });
          if (method !== 'PATCH' || path !== '/v1/appStoreVersions/version/relationships/build') throw Error('Unexpected provider mutation');
          data = {};
        } else if (path === '/v1/builds') data = { data: [build] };
        else if (path === '/v1/apps/app/appStoreVersions') data = { data: [{ id: 'version', attributes: { platform: 'IOS', versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' } }] };
        else if (path === '/v1/appStoreVersions/version/build') data = { data: build };
        else if (path === '/v1/builds/build/buildBetaDetail') {
          if (!${available}) return new Response('Unavailable', { status: 503 });
          data = { data: { attributes: { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'READY_FOR_BETA_SUBMISSION' } } };
        } else if (path === '/v1/betaGroups') {
          if (new URL(url).searchParams.has('filter[app]')) throw Error('Apple permits only one relationship filter');
          if (new URL(url).searchParams.get('filter[builds]') !== 'build') throw Error('Must read groups for the exact uploaded build');
          data = { data: [{ id: 'existing', attributes: { isInternalGroup: true, hasAccessToAllBuilds: true } }] };
        } else throw Error('Unexpected provider read: ' + path);
        return new Response(JSON.stringify(data), { status: 200 });
      };
      await import('./.github/scripts/app-store-finalize-release-candidate.mjs');
      console.log('TEST_WRITES ' + JSON.stringify(writes));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    if (!available) {
      assert.notEqual(run.status, 0, 'an unverifiable TestFlight availability read must fail finalization');
      assert.match(run.stderr, /Unable to verify TestFlight availability for build 999999:.*503/s);
      assert.doesNotMatch(run.stdout, /TEST_WRITES /);
      return;
    }
    assert.equal(run.status, 0, run.stderr);
    const output = run.stdout.slice(run.stdout.indexOf('{\n'), run.stdout.indexOf('TEST_WRITES ')).trim();
    const result = JSON.parse(output);
    assert.equal(result.attached, true);
    assert.equal(result.reviewSubmissionCreated, false);
    assert.equal(result.testFlight.verified, true);
    assert.equal(result.testFlight.testersOrGroupsChanged, false);
    assert.equal(result.testFlight.internalBuildState, 'IN_BETA_TESTING');
    assert.deepEqual(result.testFlight.groups, [{ id: 'existing', isInternalGroup: true, hasAccessToAllBuilds: true }]);
    assert.deepEqual(JSON.parse(run.stdout.split('TEST_WRITES ')[1]), [{ path: '/v1/appStoreVersions/version/relationships/build', method: 'PATCH' }]);
  });
}
