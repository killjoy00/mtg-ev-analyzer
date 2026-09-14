import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync('bootstrap.mjs', 'utf8');
const today = fs.readFileSync('home-today.mjs', 'utf8');
const profile = fs.readFileSync('profile-polish.mjs', 'utf8');

test('runtime uses the dedicated Cube home entry instead of retired Cube presentation code', () => {
  assert.match(bootstrap, /cube-home\.mjs/);
  assert.doesNotMatch(bootstrap, /cube-product\.mjs/);
  assert.match(bootstrap, /installCubeHome/);
});

test('home exposes one compact two-Daily status surface', () => {
  assert.match(bootstrap, /home-today\.mjs/);
  assert.match(today, /Your Daily board/);
  assert.match(today, /Draft Run/);
  assert.match(today, /Powered Cube/);
  assert.match(today, /loadMyProfile/);
});

test('profile polish adds career substance without another backend contract', () => {
  assert.match(bootstrap, /profile-polish\.mjs/);
  assert.match(profile, /Draft Run/);
  assert.match(profile, /Powered Cube/);
  assert.match(profile, /Best Daily/);
  assert.match(profile, /Challenges/);
  assert.doesNotMatch(profile, /fetch\(/);
});
