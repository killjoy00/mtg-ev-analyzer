import {DELETION_EMAIL_SENDER,deletionEmailConfigured} from './account-deletion-verification.mjs';

// Admin-initiated account changes are reported to the account's verified email
// address. Delivery is best effort: a missing key, an unverified address, or a
// provider failure never blocks or rolls back the admin action itself.
export const ADMIN_NOTICE_REPLY_TO='admin@packone.pro';
const PLACEHOLDER='Pack Player';

const clean=value=>String(value??'').replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim();

export function adminNotificationRequested(body) {
  return body?.notifyUser!==false;
}

export function adminRenameEmail({previousName,newName,usernameOwned=true,reason=null}={}) {
  const before=clean(previousName)||PLACEHOLDER,after=clean(newName)||PLACEHOLDER,note=clean(reason);
  const lines=[
    'Pack One username change',
    '',
    'A Pack One administrator changed the public username on your account.',
    '',
    'Previous username: '+before,
    'New username: '+after,
  ];
  if(note)lines.push('','Reason: '+note);
  lines.push(
    '',
    'This changes only your public Pack One username. Your sign-in, email address, and game history are unchanged.',
  );
  if(!usernameOwned)lines.push('You can choose a new username from your Pack One profile.');
  lines.push('','Questions? Contact '+ADMIN_NOTICE_REPLY_TO+'.');
  return {subject:'Your Pack One username was changed',text:lines.join('\n')};
}

export function adminDeletionEmail({reason=null}={}) {
  const note=clean(reason);
  const lines=[
    'Pack One account deletion',
    '',
    'A Pack One administrator deleted your Pack One account.',
  ];
  if(note)lines.push('','Reason: '+note);
  lines.push(
    '',
    'Your account, public profile, leaderboard entries, and gameplay history are being permanently removed. This cannot be undone.',
    '',
    'Deleting your Pack One account does not cancel an Apple App Store subscription or a Patreon membership. Manage those directly with Apple or Patreon.',
    '',
    'Questions? Contact '+ADMIN_NOTICE_REPLY_TO+'.',
  );
  return {subject:'Your Pack One account was deleted',text:lines.join('\n')};
}

export async function sendAdminActionEmail({
  kind,email=null,resolveEmail=null,message,requested=true,idempotencyKey=null,env=process.env,fetcher=fetch,
}={}) {
  if(!requested)return {status:'skipped',reason:'not_requested'};
  if(!deletionEmailConfigured(env))return {status:'skipped',reason:'not_configured'};
  try {
    const destination=clean(email??(resolveEmail?await resolveEmail():null));
    if(!destination)return {status:'skipped',reason:'no_verified_email'};
    const response=await fetcher('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        authorization:'Bearer '+env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY,
        'content-type':'application/json',
        ...(idempotencyKey?{'idempotency-key':String(idempotencyKey).slice(0,256)}:{}),
      },
      body:JSON.stringify({
        from:DELETION_EMAIL_SENDER,
        to:[destination],
        reply_to:ADMIN_NOTICE_REPLY_TO,
        subject:message.subject,
        text:message.text,
      }),
      signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw Object.assign(Error('Admin notice email failed.'),{code:'PROVIDER_'+response.status});
    return {status:'sent'};
  } catch(error) {
    console.error(JSON.stringify({
      event:'admin_user_notification_failed',
      kind:String(kind||'unknown'),
      error_code:/^[A-Z0-9_]{1,80}$/.test(String(error?.code||''))?error.code:'SEND_FAILED',
      error_name:String(error?.name||'Error').slice(0,80),
    }));
    return {status:'failed',reason:'send_failed'};
  }
}
