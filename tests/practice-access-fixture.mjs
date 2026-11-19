// Existing protocol/merge suites need an authorized practice start, then test
// guest/history behavior after that grant is gone. This helper is never used by
// the capability gate itself or by production smoke tests.
import {player} from '../worker/growth-function.js';
export async function withPracticeAccess(request,query,dispatch) {
  if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/runs')return dispatch(request);
  const body=await request.clone().json();
  if(body.daily)return dispatch(request);
  if(!process.argv.includes('--dev-fixtures'))throw Error('Practice fixtures require an isolated branch.');
  const owner=await player(request);
  const identity=(await query('SELECT display_name FROM players WHERE id=$1::uuid',[owner])).rows[0];
  if(!/^(QA\b|Measurement fixture )/.test(identity?.display_name||''))throw Error('Only an explicit QA fixture can receive temporary access.');
  const existing=(await query('SELECT auth_user_id FROM account_links WHERE player_id=$1::uuid',[owner])).rows[0];
  const id=existing?.auth_user_id||crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),ref=crypto.randomUUID();
  if(!existing){
    await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[id,'QA practice fixture',`qa-practice-${id}@example.invalid`]);
    await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[id,owner]);
  }
  await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'1 hour\',now())',[token,id]);
  await query("INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference) VALUES($1::uuid,'unlimited_cube_practice','test',$2),($1::uuid,'custom_corpus','test',$2)",[id,ref]);
  const headers=new Headers(request.headers);headers.set('x-pack1-auth-session',token);
  try{return await dispatch(new Request(request,{headers}));}
  finally{
    await query('DELETE FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider_reference=$2',[id,ref]);
    await query('DELETE FROM neon_auth.session WHERE token=$1',[token]);
    if(!existing)await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[id]);
  }
}
