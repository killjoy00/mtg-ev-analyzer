#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeGradleConfig(path, content) {
  if (!/\.(?:gradle|gradle\.kts)$/.test(path) && basename(path) !== 'gradle.properties') {
    return content;
  }
  return String(content)
    .replace(/(\bversionCode\s*(?:=\s*)?)\d+/g, '$1<RUN_VERSION_CODE>')
    .replace(/(\bversionName\s*(?:=\s*)?)["'][^"']*["']/g, '$1"<RUN_VERSION_NAME>"');
}

export function computeGradleCacheKey({ runnerOs, javaVersion, files }) {
  if (!runnerOs || !javaVersion) throw new Error('runnerOs and javaVersion are required');
  if (!Array.isArray(files) || files.length === 0) throw new Error('cache-key files are required');

  const hash = createHash('sha256');
  hash.update(`runner-os\0${runnerOs}\0java\0${javaVersion}\0`);
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(normalizeGradleConfig(file.path, file.content));
    hash.update('\0');
  }
  return `pack-one-gradle-${runnerOs}-java${javaVersion}-${hash.digest('hex')}`;
}

function collectGradleInputs(root) {
  const androidRoot = join(root, 'android');
  const files = [];
  const add = (path, label) => {
    if (!existsSync(path)) throw new Error(`Missing ${label}: ${relative(root, path)}. Run Expo prebuild first.`);
    files.push(path);
  };

  add(join(root, 'package-lock.json'), 'mobile lockfile');
  add(join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'Gradle wrapper properties');

  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'build' || name === '.gradle') continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile()) continue;
      if (name.endsWith('.gradle') || name.endsWith('.gradle.kts') || name === 'gradle.properties' || name === 'libs.versions.toml') {
        files.push(path);
      }
    }
  };
  walk(androidRoot);

  const unique = [...new Set(files)].sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
  return unique.map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    content: readFileSync(path, 'utf8'),
  }));
}

function main() {
  const root = process.cwd();
  const runnerOs = process.env.RUNNER_OS?.trim();
  const javaVersion = process.env.PACKONE_GRADLE_CACHE_JAVA?.trim();
  if (!runnerOs || !javaVersion) throw new Error('RUNNER_OS and PACKONE_GRADLE_CACHE_JAVA are required for the Gradle cache key.');

  const files = collectGradleInputs(root);
  const key = computeGradleCacheKey({ runnerOs, javaVersion, files });
  const restoreKey = `pack-one-gradle-${runnerOs}-java${javaVersion}-`;

  console.log(`Gradle cache key inputs (${files.length}):`);
  for (const file of files) console.log(` - ${file.path}`);
  console.log(`Gradle cache key: ${key}`);
  console.log(`Gradle cache restore prefix: ${restoreKey}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\nrestore_key=${restoreKey}\n`);
  } else {
    console.log(key);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
