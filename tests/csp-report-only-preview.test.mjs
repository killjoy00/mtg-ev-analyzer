import test from 'node:test';
import assert from 'node:assert/strict';
import {CSP_REPORT_ONLY,sanitizeCspReport} from '../scripts/csp-report-only-preview-server.mjs';

test('candidate is genuinely report-only, with an HTTP report endpoint',()=>{
  assert.match(CSP_REPORT_ONLY,/script-src 'self'/);
  assert.match(CSP_REPORT_ONLY,/report-uri \/__csp-report/);
  assert.match(CSP_REPORT_ONLY,/object-src 'none'/);
  assert.ok(!CSP_REPORT_ONLY.includes('unsafe-inline'));
});
test('sanitize strips sensitive report URLs and reports only directive and origin',()=>{
  const a=sanitizeCspReport({'csp-report':{
    'effective-directive':'connect-src',
    'blocked-uri':'https://api.example.com/profile/secret?token=abcdef',
    'document-uri':'https://packone.pro/open/profile/secret?token=xyz',
    'original-policy':'sensitive'
  }});
  assert.deepEqual(a,{directive:'connect-src',blocked:'https://api.example.com',route:'site'});
  const s=JSON.stringify(a);
  assert.ok(!s.includes('abcdef')&&!s.includes('xyz')&&!s.includes('/profile/'));
});
test('inline violations have no user-specific payload',()=>{
  assert.deepEqual(sanitizeCspReport({'csp-report':{'effective-directive':'script-src-elem','blocked-uri':'inline'}}),
    {directive:'script-src-elem',blocked:'inline',route:'site'});
  assert.equal(sanitizeCspReport(null),null);
});
test('local paths and opaque URL schemes are not preserved in reports',()=>{
  const local=sanitizeCspReport({'effectiveDirective':'img-src','blockedURL':'http://127.0.0.1:4175/secret/path?token=1'});
  assert.equal(local.blocked,'self');
  const other=sanitizeCspReport({'effectiveDirective':'img-src','blockedURL':'data:image/png;base64,c2VjcmV0'});
  assert.equal(other.blocked,'data');
});
