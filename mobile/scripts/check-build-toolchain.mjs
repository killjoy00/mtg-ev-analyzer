import { execFileSync } from 'node:child_process';

const expected = Object.freeze({ node: '24.21.0', npm: '11.19.0' });
const actual = {
  node: process.versions.node,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
};

for (const key of Object.keys(expected)) {
  if (actual[key] !== expected[key]) {
    console.error(`Pack One mobile build requires ${key} ${expected[key]}; found ${actual[key]}.`);
    process.exit(1);
  }
}

console.log(`Verified Pack One mobile toolchain: Node ${actual.node}, npm ${actual.npm}.`);
