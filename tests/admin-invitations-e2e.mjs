// Browser contract against the local Pages source, synthetic API fixtures only.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';

const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const token='a'.repeat(43),ownerId='11111111-1111-4111-8111-111111111111';
const memberId='22222222-2222-4222-8222-222222222222',inviteId='33333333-3333-4333-8333-333333333333';
const expiry='2026-12-01T00:00:00Z';
async function pageFor({signedIn=true,role='owner',acceptStatus=200}={}){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  if(signedIn)await page.addInitScript(()=>{localStorage.setItem('pack1-auth-session-v1','fake-session');});
  await page.route('**/v1/account/session',route=>route.fulfill({json:{user:signedIn?{id:ownerId,email:'owner@example.invalid'}:null}}));
  await page.route(/\/health\?quick=1$/,route=>route.fulfill({headers:{'x-pack1-admin-api-version':String(ADMIN_API_VERSION)},json:{ok:true,admin_api_version:ADMIN_API_VERSION}}));
  let revokedMember=false,revokedInvite=false;
  await page.route('**/v1/admin/**',route=>{
    const req=route.request(),u=new URL(req.url()),path=u.pathname;
    requests.push({path,method:req.method(),body:req.postDataJSON?.()||null});
    if(path==='/v1/admin/invitations/accept')return route.fulfill({status:acceptStatus,json:acceptStatus===200?{ok:true,role:'admin'}:{error:'Sign in with the invited account.',code:'ADMIN_WRONG_ACCOUNT'}});
    if(path==='/v1/admin/access')return route.fulfill({json:{ok:true,role}});
    if(path==='/v1/admin/measurements')return route.fulfill({json:{
      generated_at:'2026-10-08T00:00:00Z',corpus_version:'synthetic-browser',
      filters:{start:'2026-10-01',end:'2026-10-08',environment:'all',type:'all',set:'all',version:'all',band:'all',pick:'all'},
      summary:{exposures:0,players:0,answers:0,completed_runs:0,runs:0,rerolls:0},
      coverage:{qa_excluded:0,repeats_excluded:0,unobserved_excluded:0},
      share_funnel:{},groups:[],sets:[],reviews:[],
    }});

    if(path==='/v1/admin/team')return route.fulfill({json:{ok:true,members:[
      {id:ownerId,email:'owner@example.invalid',role:'owner',name:'Owner'},
      ...(!revokedMember?[{id:memberId,email:'member@example.invalid',role:'admin',name:'Member'}]:[])],
      invitations:[{id:inviteId,recipient_email:'invited@example.invalid',issued_at:'2026-10-08T00:00:00Z',expires_at:expiry,accepted_at:null,revoked_at:revokedInvite?'2026-10-08T01:00:00Z':null}],
      audit:[{id:1,event_type:'invite_issued',actor_auth_user_id:ownerId,recipient_email:'invited@example.invalid',created_at:'2026-10-08T00:00:00Z'}]}});
    if(path==='/v1/admin/team/invitations'&&req.method()==='POST')return route.fulfill({json:{ok:true,invitation:{id:inviteId,email:'invited@example.invalid',expires_at:expiry},token}});
    if(path===`/v1/admin/team/invitations/${inviteId}/revoke`){revokedInvite=true;return route.fulfill({json:{ok:true,status:'revoked'}});}
    if(path===`/v1/admin/team/members/${memberId}/revoke`){revokedMember=true;return route.fulfill({json:{ok:true,status:'revoked'}});}
    return route.fulfill({status:403,json:{error:'Fixture blocked unrequested admin request.'}});
  });
  return {page,requests,errors};
}
try {
  const owner=await pageFor();
  await owner.page.goto('http://127.0.0.1:4173/admin/?area=team');
  await owner.page.getByRole('heading',{name:'Administrator access'}).waitFor();
  assert.equal(await owner.page.locator('#admin-team-link').isVisible(),true);
  assert.equal(await owner.page.getByText('Owner-only:',{exact:false}).count(),1);
  await owner.page.getByRole('textbox',{name:'Verified account email'}).fill('invited@example.invalid');
  await owner.page.getByRole('button',{name:'Create invitation'}).click();
  await owner.page.getByText('Invitation created for invited@example.invalid').waitFor();
  assert.equal(await owner.page.locator('#admin-invite-link').inputValue(),'https://packone.pro/admin/#invite='+token);
  assert.ok(owner.requests.some(r=>r.path==='/v1/admin/team/invitations'&&r.method==='POST'&&r.body.email==='invited@example.invalid'));
  await owner.page.getByRole('button',{name:'Revoke',exact:true}).click();
  await owner.page.getByText('Revoked',{exact:true}).waitFor();
  await owner.page.getByRole('button',{name:'Revoke access'}).click();
  await owner.page.getByRole('button',{name:'Revoke access'}).waitFor({state:'detached'});
  assert.deepEqual(owner.errors,[]);
  await owner.page.close();

  const ordinary=await pageFor({role:'admin'});
  await ordinary.page.goto('http://127.0.0.1:4173/admin/?area=team');
  await ordinary.page.getByRole('heading',{name:'Administrator access required'}).waitFor();
  assert.equal(await ordinary.page.locator('#admin-team-link').isVisible(),false);
  assert.equal(ordinary.requests.some(r=>r.path==='/v1/admin/team'),false,'Non-Owner must never request team data');
  assert.deepEqual(ordinary.errors,[]);
  await ordinary.page.close();

  const invitee=await pageFor({role:'admin'});
  await invitee.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await invitee.page.getByRole('heading',{name:'How the decisions play'}).waitFor();
  const claim=invitee.requests.find(r=>r.path==='/v1/admin/invitations/accept');
  assert.equal(claim.method,'POST');assert.deepEqual(claim.body,{token});
  assert.equal(invitee.page.url().includes(token),false,'Invitation token must be removed from browser address after intake');
  assert.deepEqual(invitee.errors,[]);
  await invitee.page.close();

  const denied=await pageFor({role:'admin',acceptStatus:403});
  await denied.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await denied.page.getByRole('heading',{name:'Administrator access required'}).waitFor();
  assert.equal(await denied.page.getByText('Sign in with the invited account.').count(),1);
  assert.equal(await denied.page.locator('#admin-area-nav').isVisible(),false);
  assert.deepEqual(denied.errors,[]);
  await denied.page.close();

  console.log('PASS: Owner team UI, invitation create/revoke, access gating, token intake, and wrong-account denial.');
} finally {await browser.close();}
