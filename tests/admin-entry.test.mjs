import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';
import {adminPath} from '../edge/gateway.mjs';
test('admin redirect accepts only safe same-origin paths and expected filters',()=>{
  assert.equal(sanitizeAdminDestination('/admin/?area=users&from=2026-10-01'),'/admin/?area=users&from=2026-10-01');
  assert.equal(sanitizeAdminDestination('/admin/index.html?area=corpus'),'/admin/?area=corpus');
  for(const bad of ['https://evil.test/admin/','//evil.test/admin/','/elsewhere','/admin/#invite=secret','/admin/?invite=secret','/admin/?area=invalid','/admin/?area=users&area=corpus','/admin/\\evil'])assert.equal(sanitizeAdminDestination(bad),null,bad);
});
test('setup-code claims are neither permitted by gateway nor handled by admin backend',()=>{
  assert.equal(adminPath('/v1/admin/claim','POST'),false);
  assert.equal(adminPath('/v1/admin/access','GET'),true);
  assert.doesNotMatch(fs.readFileSync('worker/measurement-admin.mjs','utf8'),/pack1_admin_invites|v1\/admin\/claim/);
});
// A read-only Admin request missing from the gateway allowlist fails its CORS
// preflight in the browser ("Load failed") even though the backend serves it.
test('every read-only Admin request the page makes is allowed by the gateway',()=>{
  const missing=[];
  for(const file of fs.readdirSync('admin').filter(f=>f.endsWith('.mjs')))
    for(const [,path] of fs.readFileSync('admin/'+file,'utf8').matchAll(/\brequest\('(\/v1\/admin\/[a-z0-9\/-]*[a-z0-9])'(?:\)|\+)/g))
      if(!adminPath(path,'GET'))missing.push(file+': '+path);
  assert.deepEqual(missing,[]);
  assert.equal(adminPath('/v1/admin/youtube','GET'),true);
  assert.equal(adminPath('/v1/admin/youtube','POST'),false);
});
test('admin login delegates to standard account UI and hides privileged navigation until authorized',()=>{
  const html=fs.readFileSync('admin/index.html','utf8'),js=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(html,/id="admin-area-nav"[^>]*hidden/);
  assert.doesNotMatch(js,/signUpAccount|name="invite"|pack1-admin-invite|Setup code|Create account/);
  assert.match(js,/getAuthSession\(\)/);assert.match(js,/v1\/admin\/access/);
});
