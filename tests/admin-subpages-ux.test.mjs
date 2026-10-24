import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('admin subpage styles are scoped and do not alter the Overview renderer',()=>{
  const html=read('admin/index.html');
  const css=read('admin/subpages.css');
  assert.match(html,/subpages\.css\?v=/);
  for(const cls of ['admin-insights','admin-corpus','campaign-link-builder','player-reports','admin-team'])
    assert.ok(css.includes('.'+cls),cls);
  assert.doesNotMatch(css,/\.admin-overview\s*\{/);
  assert.match(read('admin/overview.mjs'),/Today at a glance/);
});

test('Insights explains scopes and keeps progressive disclosure without changing filters',()=>{
  const js=read('admin/admin.mjs');
  assert.match(js,/Decision overview/);
  assert.match(js,/Only dates and environment/);
  assert.match(js,/return-behavior cohorts have their own scope/);
  assert.match(js,/insights-breakdown/);
  assert.match(js,/\['difficulty','pick'\]\.includes\(dimension\)/);
  for(const id of ['filters','csv','habit-cohorts','habit-health','reviews','status'])
    assert.ok(js.includes('id="'+id+'"'),id);
  assert.match(js,/First-encounter answers/);
  assert.match(js,/Current corpus/);
});

test('Corpus distinguishes health from serving and avoids presenting unavailable cache as zero',()=>{
  const js=read('admin/corpus.mjs');
  assert.match(js,/serving_cache_current===false/);
  assert.match(js,/servingTotal=servingUnavailable\?'Unavailable'/);
  assert.match(js,/Live sets needing quality attention/);
  assert.match(js,/Serving decisions · all sets/);
  assert.match(js,/Serving snapshot passed, but check is no longer current/);
  for(const id of ['corpus-readiness','corpus-rows','corpus-detail','corpus-status'])
    assert.ok(js.includes('id="'+id+'"'),id);
});

test('Publishing pages distinguish ready tracking links from unpublished vanity previews',()=>{
  const js=read('admin/campaign-links.mjs');
  assert.match(js,/usable immediately with no publishing/);
  assert.match(js,/only ready to distribute after the Publish step/);
  assert.match(js,/Open live vanity URL/);
  assert.match(js,/encodeURIComponent\(entry\.slug\)/);
  assert.match(js,/No forced tracking/);
  for(const id of ['campaign-link-form','tracked-url','vanity-url','publish-campaign','creator-source-form','publish-creator'])
    assert.ok(js.includes('id="'+id+'"'),id);
});

test('Creator listings show performance separately from publication health',()=>{
  const js=read('admin/campaign-links.mjs');
  assert.match(js,/creator-challenge-metrics/);
  assert.match(js,/creatorSummary\.replaceChildren/);
  assert.match(js,/Needs publication attention/);
  assert.match(js,/challenge\.completions\?\?challenge\.attempts\?\?0/);
  assert.match(js,/most recent 100 challenges/);
  assert.match(js,/Detailed results and publication dates/);
  for(const action of ['data-resume-publish','data-resume-retire','data-copy-public','data-copy-tracked','data-show-kit','data-retire'])
    assert.ok(js.includes(action),action);
});

test('Moderation foregrounds report evidence and keeps technical details available',()=>{
  const js=read('admin/player-reports.mjs');
  assert.match(js,/player-report-primary/);
  assert.match(js,/player-report-technical/);
  assert.match(js,/Reports on this decision/);
  assert.match(js,/Technical details and scoring evidence/);
  assert.match(js,/Review queue/);
  assert.match(js,/Hide public identity/);
  assert.match(js,/expected_status:prior/);
});

test('Owner Settings summarizes genuine access records and preserves invitation safeguards',()=>{
  const js=read('admin/team.mjs');
  assert.match(js,/invitations\.filter\(inv=>state\(inv\)==='Pending'\)/);
  assert.match(js,/Administrators \(including Owner\)/);
  assert.match(js,/No email is sent/);
  assert.match(js,/Only the Owner can manage these permissions/);
  assert.match(js,/Email verified/);
  assert.match(js,/Access history/);
  for(const selector of ['admin-invite-form','admin-invite-result','team-status','data-revoke-invite','data-revoke-member'])
    assert.ok(js.includes(selector),selector);
});

test('admin startup does not wait on guest migrations and exposes its loading stage',()=>{
  const js=read('admin/admin.mjs');
  assert.match(js,/async function adminAccountSession\(\)/);
  assert.match(js,/growthBase\+'\/v1\/account\/session'/);
  assert.match(js,/AbortSignal\.timeout\(12000\)/);
  assert.match(js,/session=await adminAccountSession\(\)/);
  assert.match(js,/showLoading\(area==='insights'\?'Loading Insights…'/);
  assert.match(js,/code:'admin_session_timeout'/);
});

test('Insights bounds the initial history window without overriding explicit dates',()=>{
  const source=read('admin/admin.mjs');
  assert.match(source,/function defaultInsightsRange\(\)/);
  assert.match(source,/params\.has\('from'\)\|\|params\.has\('to'\)/);
  assert.match(source,/timeZone:'America\/Los_Angeles'/);
  assert.match(source,/date\.setUTCDate\(date\.getUTCDate\(\)-6\)/);
  assert.match(source,/Set From and Through for a longer history/);
});

test('Insights replaces impossible disagreement boolean with a full trophy-support distribution',()=>{
  const js=read('admin/admin.mjs');
  assert.match(js,/How strongly the model supports the trophy pick/);
  assert.match(js,/TROPHY_SUPPORT_BRACKETS=\['20–39','40–59','60–79','80–100'\]/);
  assert.match(js,/supportBracketRows\(report\.groups\.filter/);
  assert.match(js,/trophy card’s model-implied credit/);
  assert.doesNotMatch(js,/When the model questions the trophy pick/);
});
