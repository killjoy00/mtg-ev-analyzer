const AASA_URL = 'https://packone.pro/.well-known/apple-app-site-association';
const APPLE_CDN_URL = 'https://app-site-association.cdn-apple.com/a/v1/packone.pro';
const ASSETLINKS_URL = 'https://packone.pro/.well-known/assetlinks.json';

const APPLE_APP_ID = '3564X3VTDB.pro.packone.app';
const ANDROID_PACKAGE = 'pro.packone.app';
const ANDROID_APP_SIGNING_SHA256 =
  '7C:4F:B9:F7:0F:C6:A3:3C:94:F4:F9:29:93:22:65:77:34:CB:C0:4E:0B:F9:25:A7:A0:B8:42:51:30:72:3E:8B';
const EXPECTED_PATHS = ['/open/profile/*', '/open/shared/*', '/open/daily/*'];

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'PackOneReleaseVerification/1.0' },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${url} redirected with HTTP ${response.status}; association files must be directly reachable.`);
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/application\/json|application\/pkcs7-mime/i.test(contentType)) {
    throw new Error(`${url} returned unexpected Content-Type ${contentType || '(missing)'}.`);
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return valid JSON.`);
  }
  return {
    json,
    status: response.status,
    contentType,
    cache: response.headers.get('x-cache') || response.headers.get('cf-cache-status') || null,
    age: response.headers.get('age') || null,
    etag: response.headers.get('etag') || null,
  };
}

function verifyAasa(payload, label) {
  const details = payload?.applinks?.details;
  if (!Array.isArray(details)) throw new Error(`${label} AASA is missing applinks.details.`);
  const matching = details.find((detail) => {
    const ids = Array.isArray(detail.appIDs) ? detail.appIDs : detail.appID ? [detail.appID] : [];
    return ids.includes(APPLE_APP_ID);
  });
  if (!matching) throw new Error(`${label} AASA does not authorize ${APPLE_APP_ID}.`);
  const paths = (matching.components || []).map((item) => item?.['/']).filter(Boolean);
  for (const expected of EXPECTED_PATHS) {
    if (!paths.includes(expected)) throw new Error(`${label} AASA is missing route ${expected}.`);
  }
  return paths;
}

function verifyAssetLinks(payload) {
  if (!Array.isArray(payload)) throw new Error('assetlinks.json must be an array.');
  const statement = payload.find((item) =>
    item?.target?.namespace === 'android_app'
    && item?.target?.package_name === ANDROID_PACKAGE
    && Array.isArray(item?.relation)
    && item.relation.includes('delegate_permission/common.handle_all_urls'));
  if (!statement) throw new Error(`assetlinks.json does not authorize ${ANDROID_PACKAGE}.`);
  const fingerprints = statement.target.sha256_cert_fingerprints || [];
  if (!fingerprints.includes(ANDROID_APP_SIGNING_SHA256)) {
    throw new Error('assetlinks.json does not contain the expected Google Play app-signing SHA-256 fingerprint.');
  }
  return fingerprints;
}

const directAasa = await fetchJson(AASA_URL);
const assetlinks = await fetchJson(ASSETLINKS_URL);
const appleCdn = await fetchJson(APPLE_CDN_URL);

const directPaths = verifyAasa(directAasa.json, 'Direct');
const cdnPaths = verifyAasa(appleCdn.json, 'Apple CDN');
const fingerprints = verifyAssetLinks(assetlinks.json);

process.stdout.write(JSON.stringify({
  verified: true,
  apple: {
    appId: APPLE_APP_ID,
    direct: { status: directAasa.status, contentType: directAasa.contentType, paths: directPaths },
    cdn: {
      status: appleCdn.status,
      contentType: appleCdn.contentType,
      paths: cdnPaths,
      cache: appleCdn.cache,
      age: appleCdn.age,
    },
  },
  android: {
    packageName: ANDROID_PACKAGE,
    status: assetlinks.status,
    contentType: assetlinks.contentType,
    fingerprints,
  },
}, null, 2));
