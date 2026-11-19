import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [worker,growth,mobileScreen,mobileApi]=await Promise.all([
  readFile(new URL('../worker/growth-function.js',import.meta.url),'utf8'),
  readFile(new URL('../growth.mjs',import.meta.url),'utf8'),
  readFile(new URL('../mobile/app/account.tsx',import.meta.url),'utf8'),
  readFile(new URL('../mobile/src/api/account.ts',import.meta.url),'utf8'),
]);

test('email/password signup ignores client display names and preserves old-client compatibility',()=>{
  assert.match(worker,/const PASSWORD_ACCOUNT_NAME='Pack One Player'/);
  assert.equal((worker.match(/name:PASSWORD_ACCOUNT_NAME/g)||[]).length,2);
  assert.doesNotMatch(worker,/name:String\(payload\.name/);
  assert.match(worker,/newlyClaimed=claimed\.rows\.length>0/);
  assert.match(worker,/newlyClaimed,/);
});

test('email-not-verified provider errors are normalized for both web and mobile sign-in',()=>{
  assert.match(worker,/providerCode==='EMAIL_NOT_VERIFIED'/);
  assert.match(worker,/status:403,code:'EMAIL_NOT_VERIFIED'/);
  assert.match(worker,/Verify your email to finish creating your account\. Check your inbox or send a new link\./);
  assert.equal((worker.match(/const data=await passwordSignin\(payload\)/g)||[]).length,2);
});

test('native signup has no name field or name payload and uses username autofill',()=>{
  assert.doesNotMatch(mobileScreen,/accessibilityLabel="Name"/);
  assert.doesNotMatch(mobileScreen,/const \[name, setName\]/);
  assert.match(mobileScreen,/autoComplete="username"/);
  assert.match(mobileScreen,/textContentType=\{Platform\.OS === 'ios' \? 'username' : undefined\}/);
  const signup=mobileApi.slice(mobileApi.indexOf('export async function signUpWithEmail'),mobileApi.indexOf('export function linkMobileAccount'));
  assert.doesNotMatch(signup,/\bname\b/);
  assert.match(signup,/body: \{ email, password, validateDailyRunId \}/);
});

test('native first claim shows the account-ready display-name step before continuing',()=>{
  assert.match(mobileApi,/newlyClaimed\?: boolean/);
  assert.match(mobileApi,/\/growth\/v1\/mobile\/account\/link/);
  assert.match(worker,/url\.pathname === '\/v1\/mobile\/account\/link'/);
  assert.match(mobileScreen,/result\.linked\.newlyClaimed === true/);
  assert.match(mobileScreen,/const initialDisplayName = displayNameReason === 'username_required' \? ''/);
  assert.match(mobileScreen,/setReadyError\(displayNameReasonMessage\(displayNameReason\)\)/);
  assert.doesNotMatch(mobileScreen,/reason === 'username_required'\) return 'Choose a display name/);
  assert.match(mobileScreen,/Optional\. Choose a display name if you want to join Daily leaderboards\./);
  assert.match(mobileScreen,/Your account is ready\./);
  assert.match(mobileScreen,/accessibilityLabel="Skip display name for now"/);
  assert.match(mobileScreen,/linkMobileAccount\(session, validateDailyRunId\)/);
  assert.match(mobileScreen,/continueAfterDisplayNamePrompt/);
});


test('web signed-in auth callbacks route newly claimed accounts through account-ready',()=>{
  const signedInBranch=growth.slice(growth.indexOf('if(currentAccount?.user&&!reauthenticate)'),growth.indexOf('const validatingDaily='));
  assert.match(signedInBranch,/if\(linked\?\.newlyClaimed\)/);
  assert.match(signedInBranch,/openSignupNamePrompt\(\{linked,validationRunId,intent,source\}\)/);
  assert.match(growth,/profile\?\.player\?\.display_name_reason\|\|profile\?\.ranking_identity\?\.reason\|\|linked\?\.rankingIdentity\?\.reason/);
  assert.match(growth,/const initial=initialReason==='username_required'\?'':storedInitial/);
  assert.match(growth,/Optional\. Choose a display name if you want to join Daily leaderboards\./);
  assert.match(growth,/input\?\.addEventListener\('input',\(\)=>\{if\(status\)status\.textContent=''\;\}\)/);
});


test('create-account provider labels and consent are mode-specific across web and native',()=>{
  assert.match(growth,/const providerVerb=authMode==='signup'\?'Create':'Sign in'/);
  assert.match(growth,/\$\{providerVerb\} with Apple/);
  assert.match(growth,/\$\{providerVerb\} with Google/);
  assert.match(growth,/By creating an account, you agree to the <a href="https:\/\/packone\.pro\/terms\/">Pack One Terms<\/a>\./);
  assert.doesNotMatch(growth,/By continuing, you agree to the <a href="\/terms\/">Pack One Terms/);

  assert.match(mobileScreen,/AppleAuthenticationButtonType\.SIGN_UP/);
  assert.match(mobileScreen,/AppleAuthenticationButtonType\.SIGN_IN/);
  assert.match(mobileScreen,/mode === 'signup' \? 'Create with Google' : 'Sign in with Google'/);
  assert.match(mobileScreen,/mode === 'signup' \? 'Create with Apple' : 'Sign in with Apple'/);
  assert.match(mobileScreen,/By creating an account, you agree to the Pack One Terms\./);
  assert.match(mobileScreen,/router\.push\('\/terms'\)/);
  assert.doesNotMatch(mobileScreen,/By continuing, you agree to the Pack One Terms/);
});

test('mobile verification returns through the app handoff while web uses authenticated onboarding',()=>{
  assert.match(worker,/callbackURL:ACCOUNT_RETURN\+'\?auth=verify&native=1'/);
  assert.match(worker,/callbackURL:ACCOUNT_RETURN\+'\?auth=verify'\+\(mobile\?'&native=1':''\)/);
  assert.match(growth,/completeEmailVerification/);
  assert.match(growth,/Your email is verified\./);
  assert.match(growth,/packone:\/\/account\?emailVerified=1/);
  assert.match(mobileScreen,/verificationReturnHandled/);
  assert.match(mobileScreen,/Email verified\. Finishing your account/);
});
