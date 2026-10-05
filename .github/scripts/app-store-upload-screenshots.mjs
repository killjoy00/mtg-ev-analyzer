import { createHash } from 'node:crypto';
import { createAscTokenProvider, waitForAsset as pollAsset } from './app-store-asset-upload-helpers.mjs';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const screenshotRoot = process.env.SCREENSHOT_ROOT?.trim() || process.argv[2] || 'asc-screenshots';
const appId = '6814318676';
const bundleId = 'pro.packone.app';
const versionString = process.env.PACKONE_VERSION_STRING?.trim() || '1.0';
const locale = 'en-US';
const productId = 'pro.packone.app.elite.monthly';

if (!issuerId || !keyId || !privateKeyText) {
  throw new Error('ASC_ISSUER_ID, ASC_KEY_ID, and ASC_PRIVATE_KEY are required.');
}

const editableVersionStates = new Set([
  'PREPARE_FOR_SUBMISSION',
  'INVALID_BINARY',
  'REJECTED',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
]);

const getToken = createAscTokenProvider({ issuerId, keyId, privateKeyText });

async function apiRaw(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, text, data };
}

async function api(path, options = {}) {
  const result = await apiRaw(path, options);
  if (!result.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} HTTP ${result.status}: ${result.text}`);
  }
  return result.data;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Not a JPEG file.');
  }
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (sof.has(marker)) {
      if (length < 7) break;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions could not be read.');
}

function validateJpeg(path, accepted) {
  const buffer = readFileSync(path);
  const { width, height } = jpegDimensions(buffer);
  const dimensions = `${width}x${height}`;
  if (!accepted.has(dimensions)) {
    throw new Error(`${path} has unexpected dimensions ${dimensions}.`);
  }
  return { path, buffer, width, height };
}

const productNames = [
  '01-daily-decision.jpg',
  '02-reveal-comparison.jpg',
  '03-daily-hub.jpg',
  '04-practice.jpg',
  '05-career.jpg',
];
const iphoneDimensions = new Set(['1320x2868', '1290x2796', '1260x2736']);
const ipadDimensions = new Set(['2064x2752', '2048x2732']);

const iphoneFiles = productNames.map((name) =>
  validateJpeg(join(screenshotRoot, 'iphone', name), iphoneDimensions),
);
const ipadFiles = productNames.map((name) =>
  validateJpeg(join(screenshotRoot, 'ipad', name), ipadDimensions),
);
const subscriptionReviewFile = validateJpeg(
  join(screenshotRoot, 'iphone', 'iap-review-membership.jpg'),
  iphoneDimensions,
);

async function uploadParts(buffer, operations, label) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error(`${label} did not receive App Store Connect upload operations.`);
  }
  for (const operation of operations) {
    const offset = Number(operation.offset);
    const length = Number(operation.length);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new Error(`${label} returned invalid upload byte ranges.`);
    }
    const headers = Object.fromEntries(
      (operation.requestHeaders || []).map((header) => [header.name, header.value]),
    );
    const response = await fetch(operation.url, {
      method: operation.method,
      headers,
      body: buffer.subarray(offset, offset + length),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${label} blob upload failed HTTP ${response.status}: ${text}`);
    }
  }
}

async function waitForAsset(resourceType, id) {
  return pollAsset({
    resourceType,
    id,
    readAsset: () => api(`/v1/${resourceType}/${encodeURIComponent(id)}?fields%5B${resourceType}%5D=fileName,sourceFileChecksum,assetDeliveryState`),
    onProgress: (progress) => console.log(JSON.stringify({ assetProcessing: progress })),
  });
}

async function reserveUploadAndCommit({
  resourceType,
  collectionPath,
  relationshipKey,
  relationshipType,
  relationshipId,
  file,
}) {
  const reserved = await api(collectionPath, {
    method: 'POST',
    body: {
      data: {
        type: resourceType,
        attributes: {
          fileSize: file.buffer.length,
          fileName: basename(file.path),
        },
        relationships: {
          [relationshipKey]: {
            data: { type: relationshipType, id: relationshipId },
          },
        },
      },
    },
  });
  const asset = reserved?.data;
  if (!asset?.id) throw new Error(`Failed to reserve ${resourceType} for ${file.path}.`);

  try {
    await uploadParts(file.buffer, asset.attributes?.uploadOperations, file.path);
    const checksum = createHash('md5').update(file.buffer).digest('hex');
    await api(`/v1/${resourceType}/${encodeURIComponent(asset.id)}`, {
      method: 'PATCH',
      body: {
        data: {
          type: resourceType,
          id: asset.id,
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          },
        },
      },
    });
    await waitForAsset(resourceType, asset.id);
    return asset.id;
  } catch (error) {
    const cleanup = await apiRaw(`/v1/${resourceType}/${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
    if (!cleanup.ok && cleanup.status !== 404) {
      console.warn(`Cleanup of failed ${resourceType} ${asset.id} returned HTTP ${cleanup.status}.`);
    }
    throw error;
  }
}

async function deleteAppScreenshot(id) {
  const result = await apiRaw(`/v1/appScreenshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!result.ok && result.status !== 404) {
    throw new Error(`DELETE app screenshot ${id} HTTP ${result.status}: ${result.text}`);
  }
}

async function listScreenshots(setId) {
  const result = await api(
    `/v1/appScreenshotSets/${encodeURIComponent(setId)}/appScreenshots?fields%5BappScreenshots%5D=fileName,fileSize,sourceFileChecksum,assetDeliveryState&limit=200`,
  );
  return result?.data || [];
}

async function ensureScreenshotSet(localizationId, screenshotDisplayType) {
  const listed = await api(
    `/v1/appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets?fields%5BappScreenshotSets%5D=screenshotDisplayType&limit=200`,
  );
  const matches = (listed?.data || []).filter(
    (item) => item.attributes?.screenshotDisplayType === screenshotDisplayType,
  );
  if (matches.length > 1) {
    throw new Error(`Multiple App Store screenshot sets exist for ${screenshotDisplayType}.`);
  }
  if (matches.length === 1) return matches[0];

  const created = await api('/v1/appScreenshotSets', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: 'appStoreVersionLocalizations', id: localizationId },
          },
        },
      },
    },
  });
  return created.data;
}

async function replaceScreenshotSet(setId, files) {
  let existing = await listScreenshots(setId);
  const overflow = Math.max(0, existing.length + files.length - 10);
  for (const screenshot of existing.slice(0, overflow)) {
    await deleteAppScreenshot(screenshot.id);
  }
  existing = existing.slice(overflow);

  const uploadedIds = [];
  try {
    for (const file of files) {
      uploadedIds.push(await reserveUploadAndCommit({
        resourceType: 'appScreenshots',
        collectionPath: '/v1/appScreenshots',
        relationshipKey: 'appScreenshotSet',
        relationshipType: 'appScreenshotSets',
        relationshipId: setId,
        file,
      }));
    }
  } catch (error) {
    for (const id of uploadedIds) {
      await deleteAppScreenshot(id).catch(() => undefined);
    }
    throw error;
  }

  // App Store Connect rejects add/remove relationship operations while the
  // screenshot set is in its reorder state. Upload the new screenshots in the
  // desired sequence, then delete the prior screenshots. Once only the newly
  // created resources remain, their creation order is the display order.
  for (const screenshot of existing) {
    await deleteAppScreenshot(screenshot.id);
  }

  const final = await listScreenshots(setId);
  const finalIds = final.map((item) => item.id);
  if (finalIds.join(',') !== uploadedIds.join(',')) {
    throw new Error(`App Store screenshot order did not settle correctly for set ${setId}.`);
  }
  return uploadedIds;
}

async function findSubscription() {
  const groups = await api(
    `/v1/apps/${appId}/subscriptionGroups?include=subscriptions&fields%5Bsubscriptions%5D=name,productId,state&limit=200&limit%5Bsubscriptions%5D=50`,
  );
  const matches = (groups?.included || []).filter(
    (item) => item.type === 'subscriptions' && item.attributes?.productId === productId,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one subscription for ${productId}; found ${matches.length}.`);
  }
  return matches[0];
}

async function replaceSubscriptionReviewScreenshot(subscriptionId, file) {
  const existing = await apiRaw(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/appStoreReviewScreenshot?fields%5BsubscriptionAppStoreReviewScreenshots%5D=fileName,assetDeliveryState`,
  );
  if (!existing.ok && existing.status !== 404) {
    throw new Error(`Read subscription review screenshot HTTP ${existing.status}: ${existing.text}`);
  }
  const existingId = existing.ok ? existing.data?.data?.id : null;
  if (existingId) {
    const removed = await apiRaw(
      `/v1/subscriptionAppStoreReviewScreenshots/${encodeURIComponent(existingId)}`,
      { method: 'DELETE' },
    );
    if (!removed.ok && removed.status !== 404) {
      throw new Error(`Delete existing subscription review screenshot HTTP ${removed.status}: ${removed.text}`);
    }
  }

  const id = await reserveUploadAndCommit({
    resourceType: 'subscriptionAppStoreReviewScreenshots',
    collectionPath: '/v1/subscriptionAppStoreReviewScreenshots',
    relationshipKey: 'subscription',
    relationshipType: 'subscriptions',
    relationshipId: subscriptionId,
    file,
  });

  const final = await api(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/appStoreReviewScreenshot?fields%5BsubscriptionAppStoreReviewScreenshots%5D=fileName,assetDeliveryState`,
  );
  if (final?.data?.id !== id) {
    throw new Error('Subscription review screenshot relationship did not settle to the uploaded asset.');
  }
  return id;
}

const app = await api(`/v1/apps/${appId}?fields%5Bapps%5D=name,bundleId`);
if (app?.data?.attributes?.bundleId !== bundleId) {
  throw new Error(`Unexpected App Store Connect bundle ID: ${app?.data?.attributes?.bundleId}`);
}

const versions = await api(
  `/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,appStoreState&limit=200`,
);
const versionMatches = (versions?.data || []).filter(
  (item) => item.attributes?.platform === 'IOS' && item.attributes?.versionString === versionString,
);
if (versionMatches.length !== 1) {
  throw new Error(`Expected one iOS App Store version ${versionString}; found ${versionMatches.length}.`);
}
const version = versionMatches[0];
const versionState = version.attributes?.appVersionState || version.attributes?.appStoreState;
if (!editableVersionStates.has(versionState)) {
  throw new Error(`App Store version ${versionString} is not editable for screenshot upload: ${versionState}`);
}

const localizations = await api(
  `/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?fields%5BappStoreVersionLocalizations%5D=locale&limit=200`,
);
const localizationMatches = (localizations?.data || []).filter(
  (item) => item.attributes?.locale === locale,
);
if (localizationMatches.length !== 1) {
  throw new Error(`Expected one ${locale} App Store version localization; found ${localizationMatches.length}.`);
}
const localization = localizationMatches[0];

const iphoneSet = await ensureScreenshotSet(localization.id, 'APP_IPHONE_67');
const ipadSet = await ensureScreenshotSet(localization.id, 'APP_IPAD_PRO_3GEN_129');

console.log(JSON.stringify({
  preflight: true,
  appId,
  bundleId,
  versionId: version.id,
  versionString,
  versionState,
  locale,
  iphoneSetId: iphoneSet.id,
  ipadSetId: ipadSet.id,
}, null, 2));

const iphoneScreenshotIds = await replaceScreenshotSet(iphoneSet.id, iphoneFiles);
const ipadScreenshotIds = await replaceScreenshotSet(ipadSet.id, ipadFiles);
const subscription = await findSubscription();
const subscriptionReviewScreenshotId = await replaceSubscriptionReviewScreenshot(
  subscription.id,
  subscriptionReviewFile,
);

console.log(JSON.stringify({
  uploaded: true,
  appId,
  bundleId,
  versionId: version.id,
  versionString,
  versionState,
  locale,
  iphone: {
    screenshotDisplayType: 'APP_IPHONE_67',
    setId: iphoneSet.id,
    screenshotIds: iphoneScreenshotIds,
  },
  ipad: {
    screenshotDisplayType: 'APP_IPAD_PRO_3GEN_129',
    setId: ipadSet.id,
    screenshotIds: ipadScreenshotIds,
  },
  subscription: {
    productId,
    subscriptionId: subscription.id,
    reviewScreenshotId: subscriptionReviewScreenshotId,
  },
}, null, 2));
