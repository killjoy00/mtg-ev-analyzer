import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {handlePlayerReports} from '../worker/admin-player-reports.mjs';
import {adminPath} from '../edge/gateway.mjs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';

const ADMIN='22222222-2222-4222-8222-222222222222';
const DECISION='11111111-1111-4111-8111-111111111111';
const api=(suffix,method='GET')=>new Request('https://api.packone.pro'+suffix,{method});
const requestBody=body=>async()=>body;
function querySpy() {
  const calls=[];
  const query=async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('UPDATE '))return {rows:[{id:DECISION,status:values[1]}]};
    if(sql.includes('r.id, r.created_at')||sql.includes('r.id, r.created_at, r.updated_at'))return {rows:[{
      id:DECISION,reason:'broken',comment:'A test comment',status:'open',created_at:'2026-10-16T00:00:00.000Z'
    }]};
    if(sql.includes('count(*)::int total FROM'))return {rows:[{total:1}]};
    if(sql.includes("broken_open FROM"))return {rows:[{total:8,open:4,broken_open:2}]};
    if(sql.includes("FROM public_identity_reports"))return {rows:[{total:3,open:1}]};
    throw Error('Unexpected SQL: '+sql);
  };
  return {query,calls};
}

test('all report inbox routes are explicitly allowlisted and unrelated paths rejected',()=>{
  assert.equal(adminPath('/v1/admin/player-reports','GET'),true);
  assert.equal(adminPath('/v1/admin/player-reports/summary','GET'),true);
  assert.equal(adminPath('/v1/admin/player-reports/decisions/'+DECISION,'POST'),true);
  assert.equal(adminPath('/v1/admin/player-reports/profiles/12','POST'),true);
  for(const [path,method] of [
    ['/v1/admin/player-reports','POST'],
    ['/v1/admin/player-reports/summary','POST'],
    ['/v1/admin/player-reports/profiles/12','GET'],
    ['/v1/admin/player-reports/decisions/'+DECISION,'GET'],
    ['/v1/admin/player-reports/profiles/0','POST'],
    ['/v1/admin/player-reports/arbitrary','GET']
  ])assert.equal(adminPath(path,method),false,path+' '+method);
});

test('backend keeps report routes within authenticated admin membership gate',()=>{
  const admin=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  const guard=admin.indexOf("if(!role)fail('This account does not have administrator access.',403)");
  const inbox=admin.indexOf("if(url.pathname.startsWith('/v1/admin/player-reports'))");
  assert.ok(guard>=0&&inbox>guard);
  const backend=fs.readFileSync('worker/admin-player-reports.mjs','utf8');
  assert.doesNotMatch(backend,/console\.(?:log|info)\([^)]*(?:comment|details|reason|player_id)/i);
  assert.doesNotMatch(backend,/INSERT INTO draft_run_decision_reports/);
});

test('summary returns open and urgent counts without player contact data',async()=>{
  const {query,calls}=querySpy();
  const data=await handlePlayerReports(api('/v1/admin/player-reports/summary'),query,requestBody({}),ADMIN);
  assert.equal(data.summary.decisions.open,4);
  assert.equal(data.summary.decisions.broken_open,2);
  assert.equal(data.summary.profiles.open,1);
  assert.equal(calls.length,2);
  await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports'),query,requestBody({}),'not-an-admin-uuid'),/Administrator access required/);
});

test('decision inbox is bounded, filterable, retains report details and sorts newest first',async()=>{
  const {query,calls}=querySpy();
  const data=await handlePlayerReports(api('/v1/admin/player-reports?kind=decisions&status=open&reason=broken&page=2'),query,requestBody({}),ADMIN);
  assert.equal(data.rows.length,1);
  assert.equal(data.total,1);
  assert.equal(data.filters.page,2);
  const list=calls.find(x=>x.sql.includes('SELECT r.id, r.created_at'));
  assert.deepEqual(list.values,['open','broken',25,25]);
  assert.match(list.sql,/ORDER BY r.created_at DESC,r.id DESC LIMIT/);
  assert.match(list.sql,/r.comment/);
  assert.match(list.sql,/reports_on_decision/);
  assert.doesNotMatch(list.sql,/email|auth_token|access_token|refresh_token/i);
});

test('profile reports show account target but only dismiss or reopen; hide remains audited',async()=>{
  const {query,calls}=querySpy();
  const list=await handlePlayerReports(api('/v1/admin/player-reports?kind=profiles&status=all'),query,requestBody({}),ADMIN);
  assert.equal(list.filters.kind,'profiles');
  assert.ok(calls.some(x=>x.sql.includes('account_links al')));
  const dismissal=await handlePlayerReports(api('/v1/admin/player-reports/profiles/27','POST'),query,requestBody({status:'dismissed',expected_status:'open'}),ADMIN);
  assert.equal(dismissal.ok,true);
  await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports/profiles/27','POST'),query,requestBody({status:'resolved',expected_status:'open'}),ADMIN),/Only dismissal or reopening/);
});

test('review transitions are conditional, durable, and never allow unauthorized statuses or oversized notes',async()=>{
  const {query,calls}=querySpy();
  const reviewed=await handlePlayerReports(api('/v1/admin/player-reports/decisions/'+DECISION,'POST'),query,requestBody({status:'reviewed',expected_status:'open',note:'Investigated'}),ADMIN);
  assert.equal(reviewed.report.status,'reviewed');
  const update=calls.find(x=>x.sql.startsWith('UPDATE draft_run_decision_reports'));
  assert.match(update.sql,/WHERE id=\$1::uuid AND review_status=\$5/);
  assert.deepEqual(update.values,[DECISION,'reviewed','Investigated',ADMIN,'open']);
  await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports/decisions/'+DECISION,'POST'),query,requestBody({status:'delete',expected_status:'open'}),ADMIN),/Choose a valid new report status/);
  await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports/decisions/'+DECISION,'POST'),query,requestBody({status:'reviewed',expected_status:'open',note:'x'.repeat(501)}),ADMIN),/too long/);
  await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports/decisions/'+DECISION,'POST'),query,requestBody({status:'open',expected_status:'reviewed',note:'not allowed'}),ADMIN),/Reopened reports/);
});

test('filters fail closed for unbounded offsets or unknown values',async()=>{
  const {query}=querySpy();
  for(const suffix of ['?page=0','?page=10000','?kind=random','?status=bogus','?reason=bogus','?kind=profiles&reason=score_recommendation']){
    await assert.rejects(()=>handlePlayerReports(api('/v1/admin/player-reports'+suffix),query,requestBody({}),ADMIN),/Invalid/);
  }
});

test('migration and release keep old reports and verify new triage columns',()=>{
  const migration=fs.readFileSync('migrations/0060_player_report_review.sql','utf8');
  const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const schema=fs.readFileSync('scripts/verify-neon-schema.mjs','utf8');
  assert.match(migration,/ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'open'/);
  assert.match(migration,/CREATE INDEX IF NOT EXISTS draft_run_decision_reports_review_queue_idx/);
  assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE|DELETE)\b/i);
  assert.ok(manifest.ordered.includes('0060_player_report_review.sql'));
  assert.equal(manifest.ordered.at(-1),'0061_daily_reminders.sql');
  assert.ok(manifest.release_paths['secure-auth-release'].migrations.includes('0060_player_report_review.sql'));
  assert.equal(release.split('psql "$connection" -v ON_ERROR_STOP=1 -f migrations/0060_player_report_review.sql').length-1,2);
  assert.match(schema,/decision_report_review_status/);
  assert.match(schema,/decision_report_review_index/);
});

test('admin frontend exposes a private player reports area and inserts untrusted report text safely',()=>{
  const overview=fs.readFileSync('admin/overview.mjs','utf8');
  const admin=fs.readFileSync('admin/admin.mjs','utf8');
  const inbox=fs.readFileSync('admin/player-reports.mjs','utf8');
  assert.match(overview,/href="\?area=reports" id="admin-reports-link">Review player reports/);
  assert.match(admin,/renderPlayerReports\(root,authorizedRequest\)/);
  assert.match(inbox,/All user-supplied text is inserted with textContent/);
  assert.match(inbox,/el.textContent=String\(text\)/);
  assert.doesNotMatch(inbox,/innerHTML\s*=/);
  assert.match(inbox,/Hide public identity/);
});

test('admin sign-in safely preserves the reports route and profile-search context',()=>{
  assert.equal(sanitizeAdminDestination('/admin/?area=reports'),'/admin/?area=reports');
  assert.equal(sanitizeAdminDestination('/admin/?area=users&search=Friendly+Player'),'/admin/?area=users&search=Friendly+Player');
  assert.equal(sanitizeAdminDestination('/admin/?area=reports&kind=profiles'),'/admin/?area=reports&kind=profiles');
  assert.equal(sanitizeAdminDestination('/admin/?area=reports&redirect=https://evil.example'),null);
});
