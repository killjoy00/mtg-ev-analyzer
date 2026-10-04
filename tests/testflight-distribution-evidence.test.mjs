import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Isolated API contract: generated test key, stubbed fetch, no provider traffic.
for (const available of [true, false]) {
  test(`candidate attachment reports TestFlight availability ${available ? 'separately' : 'as unknown after a read failure'}`, () => {
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
          if (new URL(url).searchParams.get('filter[builds]') !== 'build') throw Error('Must read groups for the exact uploaded build');
          data = { data: [{ id: 'existing', attributes: { isInternalGroup: true, hasAccessToAllBuilds: true } }] };
        } else throw Error('Unexpected provider read: ' + path);
        return new Response(JSON.stringify(data), { status: 200 });
      };
      await import('./.github/scripts/app-store-finalize-release-candidate.mjs');
      console.log('TEST_WRITES ' + JSON.stringify(writes));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const output = run.stdout.slice(run.stdout.indexOf('{\n'), run.stdout.indexOf('TEST_WRITES ')).trim();
    const result = JSON.parse(output);
    assert.equal(result.attached, true);
    assert.equal(result.reviewSubmissionCreated, false);
    assert.equal(result.testFlight.verified, available);
    assert.equal(result.testFlight.testersOrGroupsChanged, false);
    if (available) {
      assert.equal(result.testFlight.internalBuildState, 'IN_BETA_TESTING');
      assert.deepEqual(result.testFlight.groups, [{ id: 'existing', isInternalGroup: true, hasAccessToAllBuilds: true }]);
    } else {
      assert.match(result.testFlight.reason, /503/);
      assert.equal(result.testFlight.internalBuildState, undefined);
    }
    assert.deepEqual(JSON.parse(run.stdout.split('TEST_WRITES ')[1]), [{ path: '/v1/appStoreVersions/version/relationships/build', method: 'PATCH' }]);
  });
}
