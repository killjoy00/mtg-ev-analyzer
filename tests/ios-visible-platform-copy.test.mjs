import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = [
  'mobile/src/nativeEditorial.ts',
];
for (const directory of ['mobile/app', 'mobile/src/screens', 'mobile/src/components']) {
  function collect(dir) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && /\.tsx$/.test(entry.name)) paths.push(file);
    }
  }
  collect(directory);
}

test('native customer-facing screens and legal copy do not name competing mobile platforms', () => {
  for (const path of paths) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(content, /\bAndroid\b/, `${relative(root, join(root, path))} must not name Android in customer-facing iOS copy`);
  }
});

test('account, privacy, and terms copy still cover website and mobile apps', () => {
  const account = readFileSync(join(root, 'mobile/app/account.tsx'), 'utf8');
  const privacy = readFileSync(join(root, 'mobile/app/privacy.tsx'), 'utf8');
  const editorial = readFileSync(join(root, 'mobile/src/nativeEditorial.ts'), 'utf8');
  assert.match(account, /website and in the mobile apps/);
  assert.match(privacy, /website and in its mobile apps/);
  assert.match(editorial, /In the mobile apps, sign-in sessions/);
  assert.match(editorial, /These terms apply to the Pack One website and mobile apps/);
});
