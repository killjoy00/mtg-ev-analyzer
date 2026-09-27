import { createPrivateKey, sign } from 'node:crypto';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = process.env.PACKONE_ASC_APP_ID?.trim() || '6814318676';

if (!issuerId || !keyId || !privateKeyText) {
  throw new Error('ASC_ISSUER_ID, ASC_KEY_ID, and ASC_PRIVATE_KEY are required.');
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString('base64url');
}

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = base64url(JSON.stringify({
  iss: issuerId,
  aud: 'appstoreconnect-v1',
  iat: now,
  exp: now + 10 * 60,
}));
const signingInput = `${header}.${payload}`;
const signature = sign('sha256', Buffer.from(signingInput), {
  key: createPrivateKey(privateKeyText),
  dsaEncoding: 'ieee-p1363',
});
const token = `${signingInput}.${base64url(signature)}`;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

const appFields = [
  'name',
  'bundleId',
  'subscriptionStatusUrl',
  'subscriptionStatusUrlVersion',
  'subscriptionStatusUrlForSandbox',
  'subscriptionStatusUrlVersionForSandbox',
].join(',');

const appResult = await request(
  `https://api.appstoreconnect.apple.com/v1/apps/${appId}?fields%5Bapps%5D=${encodeURIComponent(appFields)}`,
);
if (!appResult.response.ok) {
  throw new Error(`App read failed HTTP ${appResult.response.status}: ${JSON.stringify(appResult.data)}`);
}
if (appResult.data?.data?.attributes?.bundleId !== 'pro.packone.app') {
  throw new Error(`Unexpected App Store Connect bundle ID: ${appResult.data?.data?.attributes?.bundleId}`);
}

const groupsResult = await request(
  `https://api.appstoreconnect.apple.com/v1/apps/${appId}/subscriptionGroups?include=subscriptions&fields%5BsubscriptionGroups%5D=referenceName%2Csubscriptions&fields%5Bsubscriptions%5D=name%2CproductId%2CsubscriptionPeriod%2Cstate&limit=200&limit%5Bsubscriptions%5D=50`,
);
if (!groupsResult.response.ok) {
  throw new Error(`Subscription-group read failed HTTP ${groupsResult.response.status}: ${JSON.stringify(groupsResult.data)}`);
}

// Safe write-authorization probe: deliberately invalid referenceName. A key that
// reaches write validation returns 400/409/422; a key without permission returns
// 403. Treat 201 as an invariant violation and clean up immediately.
const writeProbe = await request(
  'https://api.appstoreconnect.apple.com/v1/subscriptionGroups',
  {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'subscriptionGroups',
        attributes: { referenceName: '' },
        relationships: {
          app: { data: { type: 'apps', id: appId } },
        },
      },
    }),
  },
);

let canManageSubscriptions = false;
let writeProbeStatus = writeProbe.response.status;
if ([400, 409, 422].includes(writeProbe.response.status)) {
  canManageSubscriptions = true;
} else if (writeProbe.response.status === 403) {
  canManageSubscriptions = false;
} else if (writeProbe.response.status === 201) {
  const createdId = writeProbe.data?.data?.id;
  if (createdId) {
    await request(`https://api.appstoreconnect.apple.com/v1/subscriptionGroups/${createdId}`, { method: 'DELETE' });
  }
  throw new Error('Unexpectedly created a subscription group during invalid write probe.');
} else {
  throw new Error(`Unexpected subscription write probe HTTP ${writeProbe.response.status}: ${JSON.stringify(writeProbe.data)}`);
}

const subscriptions = new Map();
for (const item of groupsResult.data?.included || []) {
  if (item?.type === 'subscriptions' && item?.attributes?.productId) {
    subscriptions.set(item.attributes.productId, {
      id: item.id,
      name: item.attributes.name,
      productId: item.attributes.productId,
      subscriptionPeriod: item.attributes.subscriptionPeriod,
      state: item.attributes.state,
    });
  }
}

const groups = (groupsResult.data?.data || []).map((group) => ({
  id: group.id,
  referenceName: group.attributes?.referenceName,
  subscriptionIds: (group.relationships?.subscriptions?.data || []).map((item) => item.id),
}));

process.stdout.write(JSON.stringify({
  verified: true,
  app: {
    id: appResult.data.data.id,
    ...appResult.data.data.attributes,
  },
  groups,
  subscriptions: [...subscriptions.values()],
  targetProductExists: subscriptions.has('pro.packone.app.elite.monthly'),
  canManageSubscriptions,
  writeProbeStatus,
}, null, 2));
