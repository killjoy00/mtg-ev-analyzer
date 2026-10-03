import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_NOTICE_REPLY_TO,
  adminDeletionEmail,
  adminNotificationRequested,
  adminRenameEmail,
  sendAdminActionEmail,
} from '../worker/admin-user-notifications.mjs';

const ENV={PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_fixture'};
const MESSAGE={subject:'Subject',text:'Body'};
const noFetch=async()=>{throw Error('must not send');};

test('admin notices are on unless the admin explicitly turns them off',()=>{
  assert.equal(adminNotificationRequested({}),true);
  assert.equal(adminNotificationRequested({notifyUser:true}),true);
  assert.equal(adminNotificationRequested({notifyUser:'no'}),true);
  assert.equal(adminNotificationRequested({notifyUser:false}),false);
});

test('rename notice names both usernames and includes the admin reason',()=>{
  const {subject,text}=adminRenameEmail({previousName:'Old Name',newName:'New Name',reason:'Name\u0000 impersonated staff'});
  assert.equal(subject,'Your Pack One username was changed');
  assert.match(text,/Previous username: Old Name/);
  assert.match(text,/New username: New Name/);
  assert.match(text,/Reason: Name impersonated staff/);
  assert.doesNotMatch(text,/[\u0000-\u0009\u000b-\u001f]/);
  assert.doesNotMatch(text,/choose a new username/);
  assert.match(text,new RegExp(ADMIN_NOTICE_REPLY_TO.replace('.','\\.')));
});

test('rename notice omits an empty reason and explains a released placeholder',()=>{
  const {text}=adminRenameEmail({previousName:'Owned Name',newName:'Pack Player',usernameOwned:false,reason:'  '});
  assert.doesNotMatch(text,/Reason:/);
  assert.match(text,/New username: Pack Player/);
  assert.match(text,/choose a new username/);
});

test('deletion notice includes the reason and the subscription caveat',()=>{
  const {subject,text}=adminDeletionEmail({reason:'spam account'});
  assert.equal(subject,'Your Pack One account was deleted');
  assert.match(text,/Reason: spam account/);
  assert.match(text,/does not cancel an Apple App Store subscription or a Patreon membership/);
  assert.doesNotMatch(adminDeletionEmail({}).text,/Reason:/);
});

test('notice is skipped without sending when off, unconfigured, or without a verified address',async()=>{
  assert.deepEqual(
    await sendAdminActionEmail({requested:false,email:'a@example.test',message:MESSAGE,env:ENV,fetcher:noFetch}),
    {status:'skipped',reason:'not_requested'},
  );
  for(const env of [{},{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_'},{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'sk_fixture'}]) {
    assert.deepEqual(
      await sendAdminActionEmail({email:'a@example.test',resolveEmail:noFetch,message:MESSAGE,env,fetcher:noFetch}),
      {status:'skipped',reason:'not_configured'},
    );
  }
  assert.deepEqual(
    await sendAdminActionEmail({resolveEmail:async()=>null,message:MESSAGE,env:ENV,fetcher:noFetch}),
    {status:'skipped',reason:'no_verified_email'},
  );
});

test('notice is sent once through Resend with reply-to and the idempotency key',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{calls.push({url,init});return new Response('{"id":"msg"}',{status:200});};
  const result=await sendAdminActionEmail({
    kind:'admin_deletion',email:'target@example.test',idempotencyKey:'pack1-admin-deletion/op',
    message:MESSAGE,env:ENV,fetcher,
  });
  assert.deepEqual(result,{status:'sent'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.authorization,'Bearer re_fixture');
  assert.equal(calls[0].init.headers['idempotency-key'],'pack1-admin-deletion/op');
  const body=JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to,['target@example.test']);
  assert.equal(body.from,'Pack One <accounts@packone.pro>');
  assert.equal(body.reply_to,ADMIN_NOTICE_REPLY_TO);
  assert.equal(body.subject,'Subject');
  assert.equal(body.text,'Body');
});

test('provider and lookup failures are reported, logged without the address, and never thrown',async()=>{
  const logged=[];const originalError=console.error;console.error=(...args)=>logged.push(args.join(' '));
  try {
    assert.deepEqual(
      await sendAdminActionEmail({
        kind:'admin_rename',email:'private@example.test',message:MESSAGE,env:ENV,
        fetcher:async()=>new Response('{}',{status:503}),
      }),
      {status:'failed',reason:'send_failed'},
    );
    assert.deepEqual(
      await sendAdminActionEmail({
        kind:'admin_rename',resolveEmail:async()=>{throw Error('db down');},message:MESSAGE,env:ENV,fetcher:noFetch,
      }),
      {status:'failed',reason:'send_failed'},
    );
  } finally {
    console.error=originalError;
  }
  const output=logged.join('\n');
  assert.match(output,/admin_user_notification_failed/);
  assert.match(output,/PROVIDER_503/);
  assert.doesNotMatch(output,/private@example\.test/);
});
