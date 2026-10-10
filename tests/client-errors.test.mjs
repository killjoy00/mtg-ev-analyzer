import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installClientErrorReporting, sameOriginLocation, sanitizeErrorMessage } from '../client-errors.mjs';

const ORIGIN = 'https://packone.pro';

function harness() {
  const target = new EventTarget();
  const sent = [];
  installClientErrorReporting((name, props) => { sent.push({ name, props }); }, { target, origin: ORIGIN, page: () => '/practice/' });
  const error = (fields) => target.dispatchEvent(Object.assign(new Event('error'), fields));
  const rejection = (reason) => target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
  return { sent, error, rejection };
}

test('same-origin script errors report message and file location only', () => {
  const { sent, error } = harness();
  error({ filename: `${ORIGIN}/draft-run-product.mjs?v=12#x`, lineno: 41, colno: 7, error: new TypeError("Cannot read properties of null (reading 'id')") });
  assert.deepEqual(sent, [{
    name: 'client_error',
    props: { kind: 'error', context: "Cannot read properties of null (reading 'id')", type: 'draft-run-product.mjs:41:7', surface: '/practice/' },
  }]);
});

test('extension, third-party and opaque cross-origin errors are ignored', () => {
  const { sent, error } = harness();
  error({ filename: 'chrome-extension://abc/content.js', lineno: 1, colno: 1, message: 'boom' });
  error({ filename: 'https://cdn.example.com/x.js', lineno: 1, colno: 1, message: 'boom' });
  error({ filename: '', lineno: 0, colno: 0, message: 'Script error.' });
  assert.equal(sent.length, 0);
});

test('messages never carry URLs, query strings or email addresses', () => {
  assert.equal(
    sanitizeErrorMessage('Failed https://packone.pro/reset-password/?token=secret for player@example.com\n  now'),
    'Failed [url] for [email] now',
  );
  assert.equal(sanitizeErrorMessage('x'.repeat(300)).length, 100);
  assert.equal(sameOriginLocation('https://packone.pro/?game=draft-run', 3, 9, ORIGIN), '(inline):3:9');
  assert.equal(sameOriginLocation('not a url', 1, 1, ORIGIN), null);
});

test('unhandled rejections report code defects but skip connectivity failures', () => {
  const { sent, rejection } = harness();
  rejection(new TypeError('Failed to fetch'));
  rejection(new TypeError('Load failed'));
  rejection(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
  rejection(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }));
  rejection(new RangeError('Invalid time value'));
  rejection('plain string');
  rejection({ some: 'object' });
  assert.deepEqual(sent.map(({ props }) => [props.kind, props.context, props.type]), [
    ['rejection', 'RangeError: Invalid time value', '(unknown)'],
    ['rejection', 'plain string', '(unknown)'],
    ['rejection', 'Non-error rejection', '(unknown)'],
  ]);
});

test('reports are deduplicated and capped per page', () => {
  const { sent, error } = harness();
  for (let i = 0; i < 3; i++) error({ filename: `${ORIGIN}/app.js`, lineno: 1, colno: 1, message: 'same' });
  for (let i = 0; i < 10; i++) error({ filename: `${ORIGIN}/app.js`, lineno: i + 2, colno: 1, message: `different ${i}` });
  assert.equal(sent.filter(({ props }) => props.context === 'same').length, 1);
  assert.equal(sent.length, 5);
});

test('a failing transport never throws back into the page', () => {
  const target = new EventTarget();
  installClientErrorReporting(() => { throw new Error('transport down'); }, { target, origin: ORIGIN });
  installClientErrorReporting(() => Promise.reject(new Error('transport down')), { target, origin: ORIGIN });
  assert.doesNotThrow(() => target.dispatchEvent(Object.assign(new Event('error'), { filename: `${ORIGIN}/app.js`, lineno: 1, colno: 1, message: 'x' })));
});

test('the main site entry installs reporting before any other bootstrap work', () => {
  const bootstrap = readFileSync(new URL('../bootstrap.mjs', import.meta.url), 'utf8');
  const install = bootstrap.indexOf('installClientErrorReporting(');
  assert.ok(install > 0 && install < bootstrap.indexOf('const params = new URLSearchParams'));
  assert.match(bootstrap, /trackEvent\(name,props\)/);
});
