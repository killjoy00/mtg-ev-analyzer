import assert from 'node:assert/strict';
import test from 'node:test';

import React, { useEffect, useState } from 'react';
import { act, create } from 'react-test-renderer';

import { VersionGateController } from '../src/components/VersionGateController.tsx';
import { parseVersionCheckResponse, resolveVersionCheck } from '../src/versionPolicy.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function checkQueue() {
  const pending = [];
  return {
    pending,
    check() {
      const next = deferred();
      pending.push(next);
      return next.promise;
    },
  };
}

function requiredIos(build = 2) {
  const decision = parseVersionCheckResponse('ios', {
    ok: true,
    updateRequired: true,
    platform: 'ios',
    minimum: { marketingVersion: '1.0', build },
    storeUrl: 'https://apps.apple.com/app/id6814318676',
  });
  assert.ok(decision);
  assert.equal(decision.status, 'required');
  return decision;
}

test('foreground checks preserve mounted navigation state across delayed and failed validation', async () => {
  const queue = checkQueue();
  let foreground = null;
  let mounts = 0;
  let unmounts = 0;
  let setProbeState = null;

  function NavigationProbe() {
    const [probeState, setState] = useState({
      pickFeedback: 'pick-4-feedback-open',
      accountEntry: 'typed@example.com',
      shareSheet: 'returned-from-share-sheet',
      authReturn: 'google-or-apple-return',
    });
    setProbeState = setState;
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return React.createElement('navigation-state', probeState);
  }

  const subscribeToForeground = (callback) => {
    foreground = callback;
    return () => {
      foreground = null;
    };
  };

  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(
        VersionGateController,
        {
          check: queue.check,
          subscribeToForeground,
          checking: React.createElement('checking'),
          renderRequired: (decision) => React.createElement('update-required', { storeUrl: decision.storeUrl }),
        },
        React.createElement(NavigationProbe),
      ),
    );
    await Promise.resolve();
  });

  assert.equal(renderer.root.findAllByType('navigation-state').length, 0, 'cold start must remain blocking');

  await act(async () => {
    queue.pending[0].resolve({ status: 'allowed' });
    await queue.pending[0].promise;
  });
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => {
    setProbeState((value) => ({ ...value, accountEntry: 'still-typed@example.com' }));
  });

  await act(async () => {
    foreground();
    await Promise.resolve();
  });
  assert.equal(queue.pending.length, 2);
  assert.equal(mounts, 1, 'a delayed foreground check must not remount navigation');
  assert.equal(unmounts, 0);
  assert.equal(renderer.root.findByType('navigation-state').props.accountEntry, 'still-typed@example.com');

  await act(async () => {
    queue.pending[1].resolve({ status: 'allowed' });
    await queue.pending[1].promise;
  });
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => {
    foreground();
    await Promise.resolve();
  });
  assert.equal(queue.pending.length, 3);
  await act(async () => {
    queue.pending[2].reject(new Error('version service unavailable'));
    await queue.pending[2].promise.catch(() => undefined);
    await Promise.resolve();
  });

  const probe = renderer.root.findByType('navigation-state').props;
  assert.equal(mounts, 1, 'a failed foreground check must keep the same mounted navigation subtree');
  assert.equal(unmounts, 0);
  assert.equal(probe.pickFeedback, 'pick-4-feedback-open');
  assert.equal(probe.accountEntry, 'still-typed@example.com');
  assert.equal(probe.shareSheet, 'returned-from-share-sheet');
  assert.equal(probe.authReturn, 'google-or-apple-return');

  await act(async () => renderer.unmount());
  assert.equal(unmounts, 1);
});

test('newer foreground decisions win and a validated update still blocks unsupported use', async () => {
  const queue = checkQueue();
  let foreground = null;
  let unmounts = 0;

  function NavigationProbe() {
    useEffect(() => () => {
      unmounts += 1;
    }, []);
    return React.createElement('navigation-state');
  }

  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(
        VersionGateController,
        {
          check: queue.check,
          subscribeToForeground: (callback) => {
            foreground = callback;
            return () => {
              foreground = null;
            };
          },
          checking: React.createElement('checking'),
          renderRequired: (decision) => React.createElement('update-required', {
            storeUrl: decision.storeUrl,
            minimumBuild: decision.minimum.build,
          }),
        },
        React.createElement(NavigationProbe),
      ),
    );
    await Promise.resolve();
  });

  await act(async () => {
    queue.pending[0].resolve({ status: 'allowed' });
    await queue.pending[0].promise;
  });

  await act(async () => {
    foreground();
    foreground();
    await Promise.resolve();
  });
  assert.equal(queue.pending.length, 3);

  await act(async () => {
    queue.pending[2].resolve({ status: 'allowed' });
    await queue.pending[2].promise;
    queue.pending[1].resolve(requiredIos(77));
    await queue.pending[1].promise;
  });
  assert.equal(renderer.root.findAllByType('navigation-state').length, 1, 'stale required response must not overwrite newer allowed decision');
  assert.equal(unmounts, 0);

  await act(async () => {
    foreground();
    foreground();
    await Promise.resolve();
  });
  assert.equal(queue.pending.length, 5);

  const required = requiredIos(88);
  await act(async () => {
    queue.pending[4].resolve(required);
    await queue.pending[4].promise;
    queue.pending[3].resolve({ status: 'allowed' });
    await queue.pending[3].promise;
  });

  assert.equal(renderer.root.findAllByType('navigation-state').length, 0);
  assert.equal(unmounts, 1, 'a current validated required decision must block the mounted app');
  const gate = renderer.root.findByType('update-required');
  assert.equal(gate.props.storeUrl, 'https://apps.apple.com/app/id6814318676');
  assert.equal(gate.props.minimumBuild, 88);

  await act(async () => renderer.unmount());
});

test('version policy keeps fail-open outages and only accepts the official stores', async () => {
  assert.deepEqual(
    await resolveVersionCheck('android', async () => {
      throw new Error('offline');
    }),
    { status: 'allowed' },
  );

  const android = parseVersionCheckResponse('android', {
    ok: true,
    updateRequired: true,
    platform: 'android',
    minimum: { marketingVersion: '1.0', build: 2 },
    storeUrl: 'https://play.google.com/store/apps/details?id=pro.packone.app',
  });
  assert.equal(android?.status, 'required');
  assert.equal(android?.storeUrl, 'https://play.google.com/store/apps/details?id=pro.packone.app');

  const rejected = parseVersionCheckResponse('ios', {
    ok: true,
    updateRequired: true,
    platform: 'ios',
    minimum: { marketingVersion: '1.0', build: 2 },
    storeUrl: 'https://example.com/fake-store',
  });
  assert.equal(rejected, null);
});
