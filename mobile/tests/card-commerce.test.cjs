const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const Renderer=require('react-test-renderer');
const {compileModule}=require('./support/compile-module.cjs');
const {act}=Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const drain=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(t,{session={accountToken:'signed'},status={ads_allowed:true,ad_free:false,account_capabilities:[]},load}={}) {
  const h={session,status,seen:[],listeners:new Set()};
  const {useCardCommerce}=compileModule('src/hooks/useCardCommerce.ts',{
    'expo-router':{useFocusEffect:callback=>React.useEffect(callback,[callback])},
    '@/src/storage/session':{readSession:async()=>h.session,subscribeSession:f=>{h.listeners.add(f);return()=>h.listeners.delete(f);}},
    '@/src/api/patreon':{loadNativePatreonStatus:async()=>load?load():h.status},
    '@/src/hooks/useAppResume':{useAppResume:f=>{h.resume=f;}},
  });
  function Probe(){h.allowed=useCardCommerce();h.seen.push(h.allowed);return null;}
  await act(async()=>{h.root=Renderer.create(React.createElement(Probe));await drain();});
  t.after(async()=>{await act(async()=>h.root.unmount());});
  h.change=async session=>{await act(async()=>{h.session=session;h.listeners.forEach(f=>f());await drain();});};
  return h;
}
test('native links start hidden and respect free, Supporter, Apple and manual Elite access',async t=>{
  for(const [session,status,expected] of [
    [null,null,true],[{},null,true],
    [{accountToken:'signed'},{ads_allowed:true,ad_free:false,account_capabilities:[]},true],
    [{accountToken:'signed'},{ads_allowed:true,ad_free:true,account_capabilities:[]},false],
    [{accountToken:'signed'},{ads_allowed:true,ad_free:false,account_capabilities:['custom_corpus','unlimited_cube_practice']},false],
  ]) {
    const h=await harness(t,{session,status});assert.equal(h.seen[0],false);assert.equal(h.allowed,expected);
  }
});
test('native account changes immediately hide links and discard a delayed old-account result',async t=>{
  let resolve,calls=0;
  const pending=new Promise(r=>{resolve=r;});
  const h=await harness(t,{load:()=>++calls===1?pending:{ads_allowed:false,ad_free:true,account_capabilities:[]}});
  await h.change({accountToken:'other'});
  await act(async()=>{resolve({ads_allowed:true,ad_free:false,account_capabilities:[]});await drain();});
  assert.equal(h.allowed,false);assert.ok(h.seen.every(x=>x===false));
});
test('native status failure and foreground rechecks do not expose subscriber promotions',async t=>{
  let fail=false;
  const h=await harness(t,{load:()=>{if(fail)throw Error('offline');return {ads_allowed:true,account_capabilities:[]};}});
  assert.equal(h.allowed,true);fail=true;
  await act(async()=>{await h.resume();await drain();});assert.equal(h.allowed,false);
});
test('native telemetry uses the player-only route and does not send account credentials or purchases as activations',async()=>{
  const requests=[];
  const {trackMembershipEvent}=compileModule('src/api/membership-events.ts',{
    'react-native':{Platform:{OS:'ios'}},
    '@/src/storage/session':{readSession:async()=>({playerToken:'fixture-player',accountToken:'private-account'})},
    '@/src/api/client':{requestJson:async(path,options)=>requests.push({path,options})},
  });
  await trackMembershipEvent('membership_checkout_started','apple');
  await trackMembershipEvent('elite_activated','apple');
  assert.equal(requests.length,1);assert.equal(requests[0].path,'/growth/v1/events');
  assert.equal(requests[0].options.credentials,'omit');
  assert.equal(requests[0].options.mobileSessionToken,'fixture-player');
  assert.equal(requests[0].options.mobileAccountToken,undefined);
  assert.ok(requests[0].options.body.events[0].props.session_id);
  assert.ok(!JSON.stringify(requests).includes('private-account'));
});
