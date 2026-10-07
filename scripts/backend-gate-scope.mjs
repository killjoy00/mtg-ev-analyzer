#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALWAYS_STEPS = Object.freeze([
  'create-isolated-branch',
  'apply-pending-migrations',
  'verify-neon-schema',
  'clear-readiness-keys',
  'season-production-bootstrap',
  'conditional-corpus-load',
]);

function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        out += '.*';
      } else {
        out += '[^/]*';
      }
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(out + '$');
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path.replaceAll('\\', '/'));
}

function normalizeChangedPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map((path) => String(path ?? '').trim().replaceAll('\\', '/')).filter(Boolean))];
}

export function filterBackendChangedPaths(paths, map = loadBackendMap()) {
  const registered = new Set(allSuites(map));
  return normalizeChangedPaths(paths).filter((path) => {
    if (path.startsWith('mobile/') || path.startsWith('docs/') || /^[^/]+\.md$/.test(path)) return false;
    if (path.startsWith('.github/')) {
      return path === '.github/workflows/backend-gate.yml' || path === '.github/workflows/prepare-rebuild.yml' || path === '.github/scripts/maintain-serving-indexes.sql';
    }
    if (path.startsWith('tests/')) {
      return registered.has(path) || /^tests\/[^/]*backend-smoke\.mjs$/.test(path) || path === 'tests/backend-gate-scope.test.mjs';
    }
    return true;
  });
}

export function loadBackendMap(repoRoot = process.cwd()) {
  return JSON.parse(readFileSync(join(repoRoot, 'scripts/backend-gate-map.json'), 'utf8'));
}

function resolveLocalImport(repoRoot, importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(repoRoot, dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.json`, join(base, 'index.mjs'), join(base, 'index.js')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return relative(repoRoot, candidate).replaceAll('\\', '/');
  }
  return null;
}

function importsFor(repoRoot, path) {
  const absolute = join(repoRoot, path);
  if (!existsSync(absolute) || !/\.(?:mjs|js|cjs)$/.test(path)) return [];
  const source = readFileSync(absolute, 'utf8');
  const specs = [];
  const re = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  for (let match; (match = re.exec(source)); ) specs.push(match[1]);
  return specs.map((specifier) => resolveLocalImport(repoRoot, path, specifier)).filter(Boolean);
}

function directDomainRoots(repoRoot, map) {
  const roots = new Map();
  const add = (path, domain) => {
    const set = roots.get(path) ?? new Set();
    set.add(domain);
    roots.set(path, set);
  };

  for (const [domain, config] of Object.entries(map.domains)) {
    for (const suite of config.suites) add(suite, domain);
  }

  const candidates = new Set();
  for (const config of Object.values(map.domains)) {
    for (const suite of config.suites) candidates.add(suite);
  }

  const scan = (path) => {
    if (candidates.has(path)) return;
    const full = join(repoRoot, path);
    if (!existsSync(full)) return;
  };

  // Domain path globs are matched lazily against changed paths and imports.
  return { roots, add, scan };
}

function isFullPath(path, map) {
  return map.full_paths.some((glob) => matchesGlob(path, glob));
}

function directDomainsFor(path, map) {
  const domains = [];
  for (const [domain, config] of Object.entries(map.domains)) {
    if (config.suites.includes(path) || config.paths.some((glob) => matchesGlob(path, glob))) domains.push(domain);
  }
  return domains;
}

function derivedDomainsFor(path, repoRoot, map) {
  const owners = new Set(directDomainsFor(path, map));
  for (const [domain, config] of Object.entries(map.domains)) {
    const roots = [...config.suites];
    // A changed source file that matches this domain's explicit path globs is itself a root.
    if (config.paths.some((glob) => matchesGlob(path, glob))) roots.push(path);

    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
      const current = stack.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      if (current === path) owners.add(domain);
      for (const imported of importsFor(repoRoot, current)) stack.push(imported);
    }
  }
  return [...owners].sort();
}

export function allSuites(map) {
  const seen = new Set();
  const suites = [];
  for (const config of Object.values(map.domains)) {
    for (const suite of config.suites) {
      if (!seen.has(suite)) {
        seen.add(suite);
        suites.push(suite);
      }
    }
  }
  return suites;
}

export function classifyBackendChanges(paths, { repoRoot = process.cwd(), map = loadBackendMap(repoRoot) } = {}) {
  const input = normalizeChangedPaths(paths);
  if (input.length === 0) {
    return {
      needsNeon: true,
      fullSuite: true,
      domains: [],
      suites: allSuites(map),
      seasonDestructive: true,
      alwaysSteps: [...ALWAYS_STEPS],
      reasons: ['empty changed-file list'],
    };
  }

  const changed = filterBackendChangedPaths(input, map);
  if (changed.length === 0) {
    return {
      needsNeon: true,
      fullSuite: true,
      domains: [],
      suites: allSuites(map),
      seasonDestructive: true,
      alwaysSteps: [...ALWAYS_STEPS],
      reasons: ['no backend-relevant changed files after neutral filtering'],
    };
  }

  const domains = new Set();
  const reasons = [];
  let fullSuite = false;

  for (const path of changed) {
    if (isFullPath(path, map)) {
      fullSuite = true;
      reasons.push(`full-path: ${path}`);
      continue;
    }

    const owners = derivedDomainsFor(path, repoRoot, map);
    if (owners.length === 0) {
      fullSuite = true;
      reasons.push(`unmapped: ${path}`);
    } else if (owners.length > 1) {
      fullSuite = true;
      reasons.push(`shared across domains ${owners.join(',')}: ${path}`);
    } else {
      domains.add(owners[0]);
      reasons.push(`${owners[0]}: ${path}`);
    }
  }

  const selectedDomains = fullSuite ? Object.keys(map.domains) : [...domains].sort();
  const selected = new Set(selectedDomains);
  const suites = [];
  const seen = new Set();
  for (const [domain, config] of Object.entries(map.domains)) {
    if (!selected.has(domain)) continue;
    for (const suite of config.suites) {
      if (!seen.has(suite)) {
        seen.add(suite);
        suites.push(suite);
      }
    }
  }

  return {
    needsNeon: true,
    fullSuite,
    domains: selectedDomains,
    suites,
    seasonDestructive: fullSuite || selected.has('seasons'),
    alwaysSteps: [...ALWAYS_STEPS],
    reasons,
  };
}

function writeOutputs(result) {
  appendFileSync(process.env.GITHUB_OUTPUT, `needs_neon=${result.needsNeon}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `full_suite=${result.fullSuite}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `domains=${result.domains.join(',')}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `domains_json=${JSON.stringify(result.domains)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `suites_json=${JSON.stringify(result.suites)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `season_destructive=${result.seasonDestructive}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const map = loadBackendMap();
  if (args.length === 1 && args[0] === '--all-suites') {
    for (const suite of allSuites(map)) console.log(suite);
    return;
  }
  const result = classifyBackendChanges(args, { map });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) writeOutputs(result);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
