import fs from 'node:fs';
import assert from 'node:assert/strict';
import {consumePlayerLimit} from '../worker/request-limits.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query}=await import('../worker/growth-function.js');
const req=(path,body,token)=>new Request('https://packone.pro'+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
const guest=await (await growth.fetch(req('/v1/session',{displayName:'QA request integrity'}))).json();
assert.ok(guest.playerId);
try {
  assert.equal((await growth.fetch(req('/v1/events',{events:[{name:'page_view'}]}))).status,401);
  const r=await growth.fetch(req('/v1/events',{events:[{name:'account_claimed'},{name:'public_profile_enabled'},{name:'game_completed'},{name:'elite_activated'},{name:'page_view'}]},guest.token));
  assert.equal(r.status,200);assert.equal((await r.json()).accepted,1);
  const events=(await query('SELECT event_name FROM analytics_events WHERE player_id=$1::uuid',[guest.playerId])).rows;
  assert.deepEqual(events.map(e=>e.event_name),['page_view']);
  const attempts=await Promise.allSettled(Array.from({length:12},()=>consumePlayerLimit(query,guest.playerId,'qa-concurrency',{limit:4,seconds:60})));
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,4);
  assert.ok(attempts.filter(a=>a.status==='rejected').every(a=>a.reason.status===429));
  await query("UPDATE player_request_limits SET resets_at=now()-interval '1 second' WHERE player_id=$1::uuid AND scope='qa-concurrency'",[guest.playerId]);
  await consumePlayerLimit(query,guest.playerId,'qa-concurrency',{limit:4,seconds:60});
  await query("UPDATE player_request_limits SET used=300 WHERE player_id=$1::uuid AND scope='events'",[guest.playerId]);
  const limited=await growth.fetch(req('/v1/events',{events:[{name:'page_view'}]},guest.token));
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  console.log('Request integrity passed: authenticated events, reserved server milestones, atomic limits, expiry and retry headers.');
} finally {
  await query('DELETE FROM analytics_events WHERE player_id=$1::uuid',[guest.playerId]);
  await query('DELETE FROM players WHERE id=$1::uuid',[guest.playerId]);
}
