import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [worker,mobileScreen,mobileApi]=await Promise.all([
  readFile(new URL('../worker/growth-function.js',import.meta.url),'utf8'),
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

test('native first claim prompts for leaderboard name before continuing',()=>{
  assert.match(mobileApi,/newlyClaimed\?: boolean/);
  assert.match(mobileApi,/\/growth\/v1\/mobile\/account\/link/);
  assert.match(worker,/url\.pathname === '\/v1\/mobile\/account\/link'/);
  assert.match(mobileScreen,/result\.linked\.newlyClaimed === true/);
  assert.match(mobileScreen,/Choose the name shown on leaderboards\./);
  assert.match(mobileScreen,/accessibilityLabel="Skip leaderboard name for now"/);
  assert.match(mobileScreen,/linkMobileAccount\(session, validateDailyRunId\)/);
  assert.match(mobileScreen,/continueAfterLeaderboardNamePrompt/);
});
