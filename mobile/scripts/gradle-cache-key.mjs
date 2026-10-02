#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const androidRoot = join(root, 'android');

function collectFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectFiles(path, predicate, out);
    } else if (stat.isFile() && predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

function required(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${relative(root, path)}. Run Expo prebuild first.`);
  }
  return path;
}

const files = [
  required(join(root, 'package-lock.json'), 'mobile lockfile'),
  required(join(androidRoot, 'gradlew'), 'generated Gradle wrapper'),
  ...collectFiles(join(androidRoot, 'gradle', 'wrapper'), () => true),
  ...collectFiles(androidRoot, (path) => {
    const name = path.split(/[\\/]/).at(-1) ?? '';
    return name.includes('.gradle') || name === 'gradle.properties';
  }),
];

const unique = [...new Set(files)].sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
if (unique.length < 4) {
  throw new Error('Generated Android project did not expose enough Gradle inputs for a safe cache key.');
}

const runnerOs = process.env.RUNNER_OS?.trim();
const javaVersion = process.env.PACKONE_GRADLE_CACHE_JAVA?.trim();
if (!runnerOs || !javaVersion) {
  throw new Error('RUNNER_OS and PACKONE_GRADLE_CACHE_JAVA are required for the Gradle cache key.');
}

const hash = createHash('sha256');
hash.update(`runner-os\0${runnerOs}\0java\0${javaVersion}\0`);
for (const path of unique) {
  const name = relative(root, path).replaceAll('\\', '/');
  hash.update(name);
  hash.update('\0');
  hash.update(readFileSync(path));
  hash.update('\0');
}

const digest = hash.digest('hex');
const key = `pack-one-gradle-${runnerOs}-java${javaVersion}-${digest}`;

console.log(`Gradle cache key inputs (${unique.length}):`);
for (const path of unique) console.log(` - ${relative(root, path).replaceAll('\\', '/')}`);
console.log(`Gradle cache key: ${key}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`);
} else {
  console.log(key);
}
