import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gradlePath = resolve(process.cwd(), process.argv[2] || 'android/app/build.gradle');

for (const name of [
  'PACKONE_ANDROID_UPLOAD_KEYSTORE',
  'PACKONE_ANDROID_UPLOAD_PASSWORD',
  'PACKONE_ANDROID_UPLOAD_KEY_ALIAS',
]) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function matchingBrace(source, open) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unbalanced Gradle braces.');
}

function findBlock(source, label, start = 0, end = source.length) {
  const expression = new RegExp(`\\b${label}\\s*\\{`, 'g');
  expression.lastIndex = start;
  let match;
  while ((match = expression.exec(source))) {
    if (match.index >= end) break;
    const open = source.indexOf('{', match.index);
    const close = matchingBrace(source, open);
    if (close <= end) return { start: match.index, open, close };
  }
  throw new Error(`Could not find Gradle block: ${label}`);
}

let source = readFileSync(gradlePath, 'utf8');

if (!source.includes('packoneUpload {')) {
  const signingConfigs = findBlock(source, 'signingConfigs');
  const snippet = `
        packoneUpload {
            storeFile file(System.getenv("PACKONE_ANDROID_UPLOAD_KEYSTORE"))
            storePassword System.getenv("PACKONE_ANDROID_UPLOAD_PASSWORD")
            keyAlias System.getenv("PACKONE_ANDROID_UPLOAD_KEY_ALIAS")
            keyPassword System.getenv("PACKONE_ANDROID_UPLOAD_PASSWORD")
        }
`;
  source = source.slice(0, signingConfigs.close) + snippet + source.slice(signingConfigs.close);
}

const buildTypes = findBlock(source, 'buildTypes');
const release = findBlock(source, 'release', buildTypes.open + 1, buildTypes.close);
const releaseBody = source.slice(release.open + 1, release.close);
const signingPattern = /signingConfig\s+signingConfigs\.[A-Za-z0-9_]+/;

let patchedReleaseBody;
if (signingPattern.test(releaseBody)) {
  patchedReleaseBody = releaseBody.replace(signingPattern, 'signingConfig signingConfigs.packoneUpload');
} else {
  patchedReleaseBody = `
            signingConfig signingConfigs.packoneUpload` + releaseBody;
}

source =
  source.slice(0, release.open + 1) +
  patchedReleaseBody +
  source.slice(release.close);

if (!source.includes('signingConfig signingConfigs.packoneUpload')) {
  throw new Error('Failed to configure the Android release build with the Pack One upload key.');
}

writeFileSync(gradlePath, source);
console.log(`Configured Pack One Android upload signing in ${gradlePath}`);
