const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { VersionGateBoundary } = require('../src/components/VersionGateBoundary.js');

const { act } = TestRenderer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAppState(initial = 'active') {
  let current = initial;
  const listeners = new Set();
  return {
    get current() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(next) {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function gateElement({ appState, checkVersion, child, onRequired }) {
  return React.createElement(
    VersionGateBoundary,
    {
      checkVersion,
      initialAppState: appState.current,
      subscribe: appState.subscribe,
      checkingFallback: React.createElement('screen', { kind: 'checking' }),
      renderRequired: (decision) => {
        onRequired?.(decision);
        return React.createElement('screen', { kind: 'required', storeUrl: decision.storeUrl });
      },
    },
    child,
  );
}

test('cold startup blocks children until the initial version decision is available', async () => {
  const initial = deferred();
  const appState = createAppState();
  let mounts = 0;
  let root;

  function Child() {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return React.createElement('stateful-child', { value: 'ready' });
  }

  await act(async () => {
    root = TestRenderer.create(
      gateElement({
        appState,
        checkVersion: () => initial.promise,
        child: React.createElement(Child),
      }),
    );
  });

  assert.equal(root.root.findAllByType('stateful-child').length, 0);
  assert.equal(root.root.findByType('screen').props.kind, 'checking');
  assert.equal(mounts, 0);

  await act(async () => {
    initial.resolve({ status: 'allowed' });
    await initial.promise;
  });

  assert.equal(root.root.findAllByType('stateful-child').length, 1);
  assert.equal(mounts, 1);

  await act(async () => root.unmount());
});

test('foreground allowed, delayed, and failed checks preserve mounted child state', async () => {
  const cold = deferred();
  const delayed = deferred();
  const failed = deferred();
  const checks = [cold, delayed, failed];
  const appState = createAppState();
  let mounts = 0;
  let unmounts = 0;
  let setRunState;
  let root;

  function StatefulChild() {
    const [runState, setState] = React.useState('feedback:pick-4');
    setRunState = setState;
    React.useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return React.createElement('stateful-child', { runState });
  }

  const checkVersion = () => {
    const next = checks.shift();
    if (!next) throw new Error('unexpected version check');
    return next.promise;
  };

  await act(async () => {
    root = TestRenderer.create(
      gateElement({
        appState,
        checkVersion,
        child: React.createElement(StatefulChild),
      }),
    );
  });

  await act(async () => {
    cold.resolve({ status: 'allowed' });
    await cold.promise;
  });
  await act(async () => setRunState('feedback:pick-4:note-draft'));

  assert.equal(root.root.findByType('stateful-child').props.runState, 'feedback:pick-4:note-draft');
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => {
    appState.emit('background');
    appState.emit('active');
    await Promise.resolve();
  });

  assert.equal(root.root.findByType('stateful-child').props.runState, 'feedback:pick-4:note-draft');
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => {
    delayed.resolve({ status: 'allowed' });
    await delayed.promise;
  });

  assert.equal(root.root.findByType('stateful-child').props.runState, 'feedback:pick-4:note-draft');
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => {
    appState.emit('inactive');
    appState.emit('active');
    await Promise.resolve();
  });
  await act(async () => {
    failed.reject(new Error('version service offline'));
    await failed.promise.catch(() => undefined);
    await Promise.resolve();
  });

  assert.equal(root.root.findByType('stateful-child').props.runState, 'feedback:pick-4:note-draft');
  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => root.unmount());
  assert.equal(unmounts, 1);
});

test('a newer foreground decision wins over an older overlapping check', async () => {
  const cold = deferred();
  const olderRequired = deferred();
  const newerAllowed = deferred();
  const checks = [cold, olderRequired, newerAllowed];
  const appState = createAppState();
  let root;

  const checkVersion = () => checks.shift().promise;

  await act(async () => {
    root = TestRenderer.create(
      gateElement({
        appState,
        checkVersion,
        child: React.createElement('stateful-child', { runState: 'preserved' }),
      }),
    );
  });

  await act(async () => {
    cold.resolve({ status: 'allowed' });
    await cold.promise;
  });

  await act(async () => {
    appState.emit('background');
    appState.emit('active');
    appState.emit('background');
    appState.emit('active');
    await Promise.resolve();
  });

  await act(async () => {
    newerAllowed.resolve({ status: 'allowed' });
    await newerAllowed.promise;
  });

  await act(async () => {
    olderRequired.resolve({
      status: 'required',
      storeUrl: 'https://apps.apple.com/app/id6814318676',
      minimum: { marketingVersion: '1.1', build: 101 },
    });
    await olderRequired.promise;
  });

  assert.equal(root.root.findAllByType('stateful-child').length, 1);
  assert.equal(root.root.findAllByProps({ kind: 'required' }).length, 0);

  await act(async () => root.unmount());
});

test('a validated update-required foreground decision blocks with the supplied store destination', async () => {
  const cold = deferred();
  const required = deferred();
  const checks = [cold, required];
  const appState = createAppState();
  let observedRequired = null;
  let unmounts = 0;
  let root;

  function Child() {
    React.useEffect(
      () => () => {
        unmounts += 1;
      },
      [],
    );
    return React.createElement('stateful-child', { runState: 'feedback' });
  }

  await act(async () => {
    root = TestRenderer.create(
      gateElement({
        appState,
        checkVersion: () => checks.shift().promise,
        child: React.createElement(Child),
        onRequired: (decision) => {
          observedRequired = decision;
        },
      }),
    );
  });

  await act(async () => {
    cold.resolve({ status: 'allowed' });
    await cold.promise;
  });

  await act(async () => {
    appState.emit('background');
    appState.emit('active');
    await Promise.resolve();
  });

  const requiredDecision = {
    status: 'required',
    storeUrl: 'https://play.google.com/store/apps/details?id=pro.packone.app',
    minimum: { marketingVersion: '1.1', build: 101 },
  };
  await act(async () => {
    required.resolve(requiredDecision);
    await required.promise;
  });

  assert.equal(root.root.findAllByType('stateful-child').length, 0);
  assert.equal(root.root.findByType('screen').props.kind, 'required');
  assert.equal(root.root.findByType('screen').props.storeUrl, requiredDecision.storeUrl);
  assert.deepEqual(observedRequired, requiredDecision);
  assert.equal(unmounts, 1);

  await act(async () => root.unmount());
});
