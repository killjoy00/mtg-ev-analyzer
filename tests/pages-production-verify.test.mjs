import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedSourceVerdict} from '../scripts/verify-pages-production.mjs';

const html='<html lang="en"><head><title>503 Service Unavailable</title></head><body>Backend error</body></html>';

test('public-site exclusion accepts confirmed 404 or small CDN error page, not served files',()=>{
  assert.equal(blockedSourceVerdict(404,'text/html'), 'not-found');
  assert.equal(blockedSourceVerdict(503,'text/html; charset=utf-8',html), 'upstream-error');
  assert.equal(blockedSourceVerdict(200,'application/javascript','source'), 'unverified');
  assert.equal(blockedSourceVerdict(301,'text/html',html), 'unverified');
  assert.equal(blockedSourceVerdict(302,'text/html',html), 'unverified');
  assert.equal(blockedSourceVerdict(403,'text/html',html), 'unverified');
  assert.equal(blockedSourceVerdict(500,'text/html',html), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/javascript','source'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/plain','503 Service Unavailable'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/html','<html>private source code</html>'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/html','<!doctype html><html>Not found</html>'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/html',html.repeat(900)), 'unverified');
  // Actual Pages 503 bodies may be blank or lack any error keywords.
  // These must not be mistaken for published JS/SQL source.
  assert.equal(blockedSourceVerdict(503,'text/html; charset=utf-8','Service temporarily offline','/worker/growth-function.js'), 'upstream-error');
  assert.equal(blockedSourceVerdict(503,'text/html; charset=utf-8','','/migrations/0016_retire_third_source.sql'), 'upstream-error');
  assert.equal(blockedSourceVerdict(503,'text/html; charset=utf-8','export const confidential = 1;','/worker/growth-function.js'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'application/javascript',html,'/worker/growth-function.js'), 'unverified');
  assert.equal(blockedSourceVerdict(503,'text/html','Some generic HTML','/research/CONTEXTUAL-VALUE-V1-RUN.html'), 'unverified');
  assert.equal(blockedSourceVerdict(200,'text/html',html,'/worker/growth-function.js'), 'unverified');

});
