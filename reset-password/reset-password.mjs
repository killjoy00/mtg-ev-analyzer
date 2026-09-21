import {resetPassword} from '../growth-api.mjs';

const root=document.querySelector('#recovery-state');
const url=new URL(location.href);
const fragmentParams=new URLSearchParams(url.hash.startsWith('#')?url.hash.slice(1):url.hash);
const params=url.searchParams;
let token=fragmentParams.get('token')||params.get('token')||'';
const providerError=params.get('error')||'';

// Recovery credentials must not remain visible in the address bar or browser
// history. Prefer Pack One's fragment token, preserve the managed-email query
// fallback, and keep the token only in this page's memory for this attempt.
history.replaceState({},'',location.pathname);

function state(title,body,action='') {
  root.innerHTML=`<h2>${title}</h2><p>${body}</p>${action}`;
}
function invalidCopy(code) {
  if(code==='EXPIRED_RESET'||code==='TOKEN_EXPIRED')return ['Reset link expired','This password reset link has expired. Request a new one to continue.'];
  if(code==='REUSED_RESET'||code==='TOKEN_REUSED')return ['Reset link already used','This password reset link has already been used. Request a new one if you still need to change your password.'];
  return ['Reset link unavailable','This password reset link is invalid or may already have been used. Request a new one to continue.'];
}
function showInvalid(code=providerError) {
  const [title,body]=invalidCopy(code);
  state(title,body,'<a class="button primary" href="/?account=1">Back to sign in</a>');
}

if(providerError||!token) {
  showInvalid(providerError);
  token='';
} else {
  root.innerHTML=`<form class="account-form" id="reset-password-form">
    <label>New password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="new-password"></label>
    <label>Confirm new password<input required type="password" name="confirm" minlength="8" maxlength="128" autocomplete="new-password"></label>
    <button class="button primary" type="submit">Reset password</button>
    <p class="form-error" aria-live="polite"></p>
  </form>`;
  document.querySelector('#reset-password-form')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,button=form.querySelector('button'),error=form.querySelector('.form-error');
    error.textContent='';
    const data=Object.fromEntries(new FormData(form));
    if(data.password!==data.confirm){error.textContent='Passwords do not match.';return;}
    if(String(data.password||'').length<8){error.textContent='Password must be at least 8 characters.';return;}
    button.disabled=true;
    try {
      await resetPassword({token,newPassword:data.password});
      token='';
      state('Password reset','Your password has been changed. You are signed out of Pack One on other browsers and can sign in with your new password.','<a class="button primary" href="/?account=1">Sign in</a>');
    } catch(err) {
      if(err?.code==='INVALID_RESET'||err?.code==='EXPIRED_RESET') {
        token='';
        showInvalid(err.code);
        return;
      }
      error.textContent=err?.message||'Password recovery is temporarily unavailable.';
      button.disabled=false;
    }
  });
}
