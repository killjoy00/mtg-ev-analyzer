import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const enabled = process.env.GITHUB_HEAD_REF === 'ops/179b2-email-otp-probe';
const base = 'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin = 'http://localhost:4173';

function cookies(response) {
  const rows = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return rows.flatMap(row => String(row).split(/,(?=\\s*[^;,]+=)/))
    .map(row => row.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function call(path, { body, cookie } = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      origin,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body || {}),
    redirect: 'manual',
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: cookies(response) };
}

function safe(result) {
  return {
    status: result.response.status,
    ok: result.response.ok,
    code: result.data?.code || null,
    message: typeof result.data?.message === 'string' ? result.data.message.slice(0, 180) : null,
    error: typeof result.data?.error === 'string' ? result.data.error.slice(0, 180) : null,
  };
}

test('179B2 capability probe: OTP email-change routes on isolated QA', { skip: !enabled, timeout: 30000 }, async () => {
  const stamp = Date.now();
  const sourceEmail = `qa-179b2-source-${stamp}@example.com`;
  const targetEmail = `qa-179b2-target-${stamp}@example.com`;
  const duplicateEmail = `qa-179b2-duplicate-${stamp}@example.com`;
  const password = 'Qa1!' + randomBytes(24).toString('base64url');
  const otherPassword = 'Qa1!' + randomBytes(24).toString('base64url');

  const schemaResponse = await fetch(base + '/open-api/generate-schema', {
    headers: { origin, accept: 'application/json' },
  });
  const schema = await schemaResponse.json();
  const mounted = [
    '/email-otp/request-email-change',
    '/email-otp/change-email',
    '/email-otp/send-verification-otp',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
  ].filter(path => Boolean(schema?.paths?.[path]));

  const signup = await call('/sign-up/email', { body: { name: 'QA 179B2 Source', email: sourceEmail, password } });
  assert.equal(signup.response.status, 200);
  const userId = String(signup.data?.user?.id || '');
  assert.match(userId, /^[0-9a-f-]{36}$/i);

  const request = await call('/email-otp/request-email-change', {
    cookie: signup.cookie,
    body: { newEmail: targetEmail },
  });

  const bogus = await call('/email-otp/change-email', {
    cookie: signup.cookie,
    body: { newEmail: targetEmail, otp: '000000' },
  });

  const duplicateSignup = await call('/sign-up/email', {
    body: { name: 'QA 179B2 Duplicate', email: duplicateEmail, password: otherPassword },
  });
  assert.equal(duplicateSignup.response.status, 200);
  const duplicateUserId = String(duplicateSignup.data?.user?.id || '');
  assert.match(duplicateUserId, /^[0-9a-f-]{36}$/i);

  const duplicateRequest = await call('/email-otp/request-email-change', {
    cookie: signup.cookie,
    body: { newEmail: duplicateEmail },
  });

  const session = await call('/get-session', { cookie: signup.cookie });

  console.log(JSON.stringify({
    label: 'qa-179b2-email-otp-capability',
    userId,
    duplicateUserId,
    sourceEmail,
    targetEmail,
    duplicateEmail,
    mounted,
    request: safe(request),
    bogusCompletion: safe(bogus),
    duplicateRequest: safe(duplicateRequest),
    sessionAfterProbe: {
      status: session.response.status,
      email: session.data?.user?.email || null,
    },
  }));
});
