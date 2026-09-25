import {randomBytes} from 'node:crypto';

const AUTH_BASE='https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth';
const ORIGIN='https://packone.pro';
const EMAIL='delivered@resend.dev';

async function post(path,body){
  const started=Date.now();
  const response=await fetch(AUTH_BASE+path,{
    method:'POST',
    headers:{origin:ORIGIN,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(30000),
  });
  return {status:response.status,ms:Date.now()-started};
}

const password='P1-'+randomBytes(24).toString('base64url')+'!';
const signup=await post('/sign-up/email',{email:EMAIL,password,name:'Pack One Production Recovery Smoke'});
if(signup.status<200||signup.status>=300)throw Error('Production recovery smoke signup failed with HTTP '+signup.status+'.');

const reset=await post('/request-password-reset',{email:EMAIL,redirectTo:'https://packone.pro/reset-password/'});
if(reset.status<200||reset.status>=300)throw Error('Production recovery smoke reset request failed with HTTP '+reset.status+'.');

console.log('PRODUCTION_RECOVERY_REQUEST_SMOKE '+JSON.stringify({
  signup_status:signup.status,
  reset_request_status:reset.status,
  signup_ms:signup.ms,
  reset_request_ms:reset.ms,
}));
