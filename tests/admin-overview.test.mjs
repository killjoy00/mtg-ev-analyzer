import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adminArea,overviewMarkup,overviewWindow,cohortRate,servingSummary} from '../admin/overview.mjs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';

test('admin home is the default and every tool has an explicit deep link',()=>{
  assert.equal(adminArea(''),'overview');
  assert.equal(adminArea('?area=unknown'),'overview');
  assert.equal(adminArea('?area=__proto__'),'overview');
  for(const area of ['insights','reports','corpus','users','campaign-links','creator-challenges','team']) {
    assert.equal(adminArea('?area='+area),area);
    assert.equal(sanitizeAdminDestination('/admin/?area='+area),'/admin/?area='+area);
  }
  const html=fs.readFileSync('admin/index.html','utf8');
  const nav=html.match(/<nav id="admin-area-nav"[\s\S]*?<\/nav>/)[0];
  assert.match(nav,/id="admin-overview-link" href="\.\/" hidden/);
  assert.doesNotMatch(nav,/\?area=|role="tab"/);
});
test('overview shows section cards, not an Overview tab, and settings are owner-only',()=>{
  const html=overviewMarkup({now:new Date('2026-10-19T02:00:00Z')});
  assert.match(html,/<h1>Overview<\/h1>/);
  assert.doesNotMatch(html,/role="tab|\?area=overview|\?area=team/);
  assert.match(overviewMarkup({role:'owner'}),/id="admin-team-link"/);
  for(const href of ['/?game=draft-run&daily=1','/?game=draft-run&set=powered-cube&daily=1','/?game=draft-run&set=latest&daily=1'])assert.ok(html.includes(href));
  for(const area of ['insights','reports','corpus','users','campaign-links','creator-challenges'])assert.ok(html.includes('?area='+area));
});
test('overview uses Pacific dates including daylight-saving boundaries',()=>{
  assert.deepEqual(overviewWindow(new Date('2026-10-19T02:00:00Z')),{day:'2026-10-18',from:'2026-09-19'});
  assert.equal(overviewWindow(new Date('2026-11-01T08:30:00Z')).day,'2026-11-01');
  assert.equal(overviewWindow(new Date('2026-11-01T09:30:00Z')).day,'2026-11-01');
});
test('return rates weight mature denominators, not cohort percentages',()=>{
  assert.deepEqual(cohortRate([{next_day_returned:1,next_day_mature:2},{next_day_returned:9,next_day_mature:18}],'next_day'),{rate:50,returned:10,mature:20});
  assert.equal(cohortRate([],'next_day').rate,null);
  assert.equal(cohortRate([{next_day_returned:1,next_day_mature:0}],'next_day').rate,null);
  assert.equal(cohortRate([{}],'next_day').rate,null);
});
test('only current verified serving is healthy',()=>{
  assert.equal(servingSummary({ready:true,current:true}).kind,'ready');
  assert.equal(servingSummary({ready:true,current:false}).kind,'unknown');
  assert.equal(servingSummary({state:'failed',current:true}).kind,'warning');
  assert.equal(servingSummary({state:'warming',current:true}).kind,'pending');
  assert.equal(servingSummary({}).kind,'unknown');
});
test('overview is read-only and does not fetch owner membership or cache private data',()=>{
  const js=fs.readFileSync('admin/overview.mjs','utf8');
  assert.doesNotMatch(js,/request\([^\n]*,\s*\{|localStorage|sessionStorage|\/v1\/admin\/team/);
  assert.match(js,/error\?\.status===401\|\|error\?\.status===403/);
});
