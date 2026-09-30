import test from 'node:test';
import assert from 'node:assert/strict';
import {providerSignupBody,rethrowEmailNotVerified} from '../worker/growth-function.js';

test('email signup ignores legacy display-name input and uses a fixed neutral Auth name',()=>{
  assert.deepEqual(providerSignupBody({
    name:'Old Mobile Name',
    email:'  qa@example.invalid  ',
    password:'fixture-password-123',
  }),{
    name:'Pack One Player',
    email:'qa@example.invalid',
    password:'fixture-password-123',
    callbackURL:'https://packone.pro/?auth=verify',
  });
});

test('email-not-verified provider errors become the Pack One recovery contract',()=>{
  assert.throws(
    ()=>rethrowEmailNotVerified(Object.assign(Error('Email not verified'),{status:403,providerCode:'EMAIL_NOT_VERIFIED'})),
    error=>{
      assert.equal(error.status,403);
      assert.equal(error.code,'EMAIL_NOT_VERIFIED');
      assert.equal(error.message,'Verify your email to finish creating your account. Check your inbox or send a new link.');
      return true;
    },
  );

  const other=Object.assign(Error('Other provider error'),{status:401,providerCode:'INVALID_PASSWORD'});
  assert.throws(()=>rethrowEmailNotVerified(other),error=>error===other);
});
