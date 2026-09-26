import fs from 'node:fs';
import path from 'node:path';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node verify-android-release-manifest.mjs /path/to/AndroidManifest.xml');

const xml = fs.readFileSync(manifestPath, 'utf8');
const permissions = [...xml.matchAll(/<uses-permission(?:-sdk-\d+)?\b[^>]*android:name=["']([^"']+)["'][^>]*>/g)]
  .map((match) => match[1]);
const actual = [...new Set(permissions)].sort();
const expected = ['android.permission.INTERNET', 'android.permission.VIBRATE'].sort();

const unexpected = actual.filter((permission) => !expected.includes(permission));
const missing = expected.filter((permission) => !actual.includes(permission));
if (unexpected.length || missing.length) {
  throw new Error(
    `Unexpected Android release permissions in ${path.basename(manifestPath)}. ` +
    `Expected only ${expected.join(', ')}; actual ${actual.join(', ') || '(none)'}; ` +
    `unexpected ${unexpected.join(', ') || '(none)'}; missing ${missing.join(', ') || '(none)'}.`,
  );
}

for (const forbidden of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]) {
  if (xml.includes(`android:name="${forbidden}"`) || xml.includes(`android:name='${forbidden}'`)) {
    throw new Error(`Blocked Android permission survived release manifest merge: ${forbidden}`);
  }
}

console.log(`Verified Android release manifest permissions: ${actual.join(', ')}`);
