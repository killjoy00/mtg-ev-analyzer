import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const token = process.env.PLAY_ACCESS_TOKEN?.trim();
const screenshotRoot = process.env.SCREENSHOT_ROOT?.trim() || process.argv[2] || 'play-screenshots/android';
const packageName = 'pro.packone.app';
const language = 'en-US';
const imageType = 'phoneScreenshots';
const root = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;

if (!token) throw new Error('PLAY_ACCESS_TOKEN is required.');

const names = [
  '01-daily-decision.jpg',
  '02-reveal-comparison.jpg',
  '03-daily-hub.jpg',
  '04-practice.jpg',
  '05-career.jpg',
];

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('Not a JPEG file.');
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (sof.has(marker)) {
      if (length < 7) break;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions could not be read.');
}

const files = names.map((name) => {
  const path = join(screenshotRoot, name);
  const buffer = readFileSync(path);
  const { width, height } = jpegDimensions(buffer);
  if (width !== 1080 || height !== 1920) {
    throw new Error(`${path} has unexpected dimensions ${width}x${height}; expected 1080x1920.`);
  }
  return { name, path, buffer };
});

async function request(path, { method = 'GET', body, contentType = 'application/json' } = {}) {
  const response = await fetch(`${root}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': contentType } : {}),
    },
    body: body === undefined
      ? undefined
      : contentType === 'application/json'
        ? JSON.stringify(body)
        : body,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  }
  return data;
}

let editId = null;
let committed = false;
try {
  const edit = await request('/edits', { method: 'POST', body: {} });
  editId = edit?.id;
  if (!editId) throw new Error('Google Play did not return an edit id.');

  const listingPath = `/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}`;
  await request(listingPath);

  const imagesPath = `${listingPath}/${imageType}`;
  const before = await request(imagesPath);

  await request(imagesPath, { method: 'DELETE' });

  const uploaded = [];
  for (const file of files) {
    const path = `/upload/androidpublisher/v3/applications/${packageName}/edits/${encodeURIComponent(editId)}/listings/${encodeURIComponent(language)}/${imageType}?uploadType=media`;
    const response = await fetch(`https://androidpublisher.googleapis.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'image/jpeg',
      },
      body: file.buffer,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) throw new Error(`Upload ${file.name} HTTP ${response.status}: ${text}`);
    if (!data?.id) throw new Error(`Upload ${file.name} returned no image id.`);
    uploaded.push({ name: file.name, id: data.id });
  }

  const after = await request(imagesPath);
  const finalImages = after?.images || [];
  if (finalImages.length !== files.length) {
    throw new Error(`Expected ${files.length} Play phone screenshots after upload; found ${finalImages.length}.`);
  }
  const finalIds = finalImages.map((image) => image.id);
  const uploadedIds = uploaded.map((image) => image.id);
  if (uploadedIds.some((id) => !finalIds.includes(id))) {
    throw new Error('Google Play screenshot list is missing one or more uploaded images.');
  }

  await request(`/edits/${encodeURIComponent(editId)}:validate`, { method: 'POST' });
  await request(`/edits/${encodeURIComponent(editId)}:commit`, { method: 'POST' });
  committed = true;

  console.log(JSON.stringify({
    uploaded: true,
    packageName,
    language,
    imageType,
    previousCount: (before?.images || []).length,
    screenshotIds: uploadedIds,
    files: names,
    committed: true,
  }, null, 2));
} finally {
  if (editId && !committed) {
    try {
      await request(`/edits/${encodeURIComponent(editId)}`, { method: 'DELETE' });
    } catch (error) {
      console.warn(`Failed to discard Google Play edit ${editId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
