import test from 'node:test';
import assert from 'node:assert/strict';
import {userAdminFilters} from '../worker/user-admin.mjs';

test('user admin filters stay account-scoped',()=>{
  const parsed=userAdminFilters(new URL('https://packone.pro/v1/admin/users?search=%20member%40example.com%20&status=patreon'));
  assert.deepEqual(parsed,{search:'member@example.com',status:'patreon'});
  assert.throws(()=>userAdminFilters(new URL('https://packone.pro/v1/admin/users?status=players')),error=>error.status===400);
  assert.throws(()=>userAdminFilters(new URL('https://packone.pro/v1/admin/users?search='+encodeURIComponent('x'.repeat(101)))),error=>error.status===400);
});
