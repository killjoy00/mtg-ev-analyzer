// Browser contract against the local Pages source, synthetic API fixtures only.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {ADMIN_API_VERSION} from '../admin-api-contract.mjs';

const browser=await chromium.launch(process.env.CI?{headless:true,channel:'chrome'}:{headless:true});
const token='a'.repeat(43),ownerId='11111111-1111-4111-8111-111111111111';
const memberId='22222222-2222-4222-8222-222222222222',inviteId='33333333-3333-4333-8333-333333333333';
const expiry='2026-12-01T00:00:00Z';
async function pageFor({signedIn=true,role='owner',acceptStatus=200,accountEmail='owner@example.invalid'}={}){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const requests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  if(signedIn)await page.addInitScript(()=>{localStorage.setItem('pack1-auth-session-v1','fake-session');});
  await page.route('**/v1/account/session',route=>route.fulfill({json:{user:signedIn?{id:ownerId,email:accountEmail}:null}}));
  await page.route('**/v1/account/signout',route=>route.fulfill({json:{ok:true}}));
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

  const invitee=await pageFor({role:'admin',accountEmail:'recipient@example.invalid'});
  await invitee.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await invitee.page.getByRole('heading',{name:'Administrator invitation'}).waitFor();
  assert.equal(await invitee.page.locator('#admin-invite-account').textContent(),'recipient@example.invalid');
  assert.equal(invitee.requests.some(r=>r.path==='/v1/admin/invitations/accept'),false,
    'Opening the invitation must not trigger POST acceptance');
  assert.equal(invitee.page.url().includes(token),false,'Invitation token removed from address after intake');
  await invitee.page.reload();
  await invitee.page.getByRole('heading',{name:'Administrator invitation'}).waitFor();
  assert.equal(invitee.requests.some(r=>r.path==='/v1/admin/invitations/accept'),false,
    'Reloading the invitation must not trigger POST acceptance');
  await invitee.page.getByRole('button',{name:'Accept admin invitation'}).click();
  await invitee.page.getByRole('heading',{name:'How the decisions play'}).waitFor();
  const claims=invitee.requests.filter(r=>r.path==='/v1/admin/invitations/accept');
  assert.equal(claims.length,1,'Exactly one POST after affirmative button click');
  assert.equal(claims[0].method,'POST');assert.deepEqual(claims[0].body,{token});
  assert.equal(await invitee.page.evaluate(()=>sessionStorage.getItem('pack1-pending-admin-invite-v2')),null);
  assert.deepEqual(invitee.errors,[]);
  await invitee.page.close();

  const denied=await pageFor({role:'admin',acceptStatus:403,accountEmail:'wrong@example.invalid'});
  await denied.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await denied.page.getByRole('heading',{name:'Administrator invitation'}).waitFor();
  assert.equal(denied.requests.some(r=>r.path==='/v1/admin/invitations/accept'),false);
  await denied.page.getByRole('button',{name:'Accept admin invitation'}).click();
  await denied.page.getByText('Sign in with the invited account.').waitFor();
  assert.equal(await denied.page.locator('#admin-invite-account').textContent(),'wrong@example.invalid');
  assert.equal(await denied.page.getByRole('button',{name:'Switch account'}).isVisible(),true);
  assert.equal(await denied.page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-pending-admin-invite-v2'))),true,
    'Wrong account must retain token for deliberate account switch');
  assert.equal(await denied.page.locator('#admin-area-nav').isVisible(),false);
  await denied.page.getByRole('button',{name:'Switch account'}).click();
  await denied.page.getByRole('heading',{name:'Pack One administration'}).waitFor();
  assert.equal(await denied.page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-pending-admin-invite-v2'))),true,
    'Switching account retains pending invitation but must not accept it');
  assert.equal(denied.requests.filter(r=>r.path==='/v1/admin/invitations/accept').length,1);
  assert.deepEqual(denied.errors,[]);
  await denied.page.close();

  const cancelled=await pageFor({role:'admin'});
  await cancelled.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await cancelled.page.getByRole('heading',{name:'Administrator invitation'}).waitFor();
  await cancelled.page.getByRole('button',{name:'Cancel'}).click();
  await cancelled.page.waitForURL('http://127.0.0.1:4173/');
  assert.equal(await cancelled.page.evaluate(()=>sessionStorage.getItem('pack1-pending-admin-invite-v2')),null);
  assert.equal(cancelled.requests.some(r=>r.path==='/v1/admin/invitations/accept'),false,
    'Cancel must never submit invitation');
  assert.deepEqual(cancelled.errors,[]);
  await cancelled.page.close();

  const guest=await pageFor({signedIn:false});
  await guest.page.goto('http://127.0.0.1:4173/admin/#invite='+token);
  await guest.page.getByRole('heading',{name:'Pack One administration'}).waitFor();
  await guest.page.getByText('Sign in to review your administrator invitation.').waitFor();
  assert.equal(guest.requests.some(r=>r.path==='/v1/admin/invitations/accept'),false);
  assert.equal(await guest.page.evaluate(()=>Boolean(sessionStorage.getItem('pack1-pending-admin-invite-v2'))),true);
  await guest.page.close();

  console.log('PASS: Owner team UI, invitation create/revoke, explicit opt-in, cancel/switch, token retention, and access gates.');
} finally {await browser.close();}
