const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const Renderer=require('react-test-renderer');
const {compileModule}=require('./support/compile-module.cjs');
const {act}=Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const flush=async()=>{for(let n=0;n<35;n++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const session=name=>({playerToken:'player-'+name,accountToken:'account-'+name,accountUser:{id:name}});
function fixture(platform='ios') {
  const storage=new Map(),calls=[],order=[],listeners=new Set(),destinations=[];
  let current=session('A'),permission={granted:false},requestPermission=async()=>({granted:true}),token='ExpoPushToken[fixturetoken1234567890]',version=0;
  const controls={registration:null,registrationError:null,response:null,handler:null,pushListener:null,lastResponse:null};
  const notifications={
    AndroidImportance:{DEFAULT:3},IosAuthorizationStatus:{PROVISIONAL:3},
    getPermissionsAsync:async()=>{order.push('permissions');return permission;},
    requestPermissionsAsync:async()=>{order.push('prompt');permission=await requestPermission();return permission;},
    setNotificationChannelAsync:async()=>{order.push('channel');},
    getExpoPushTokenAsync:async()=>{order.push('token');return {data:token};},
    dismissAllNotificationsAsync:async()=>{order.push('dismiss');},
    setNotificationHandler:handler=>{controls.handler=handler;},
    addNotificationResponseReceivedListener:fn=>{controls.response=fn;return {remove(){controls.response=null;}};},
    addPushTokenListener:fn=>{controls.pushListener=fn;return {remove(){controls.pushListener=null;}};},
    getLastNotificationResponseAsync:async()=>controls.lastResponse,
    clearLastNotificationResponseAsync:async()=>{controls.lastResponse=null;},
  };
  const mocks={
    'expo-secure-store':{WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,getItemAsync:async key=>storage.get(key)||null,
      setItemAsync:async(key,value)=>{storage.set(key,value);},deleteItemAsync:async key=>storage.delete(key)},
    'expo-notifications':notifications,
    'expo-constants':{expoConfig:{extra:{notifications:{projectId:'11111111-1111-4111-8111-111111111111'}}}},
    'react-native':{Platform:{OS:platform},AppState:{addEventListener:()=>({remove(){}})}},
    'expo-router':{useRootNavigationState:()=>({key:'fixture'}),router:{navigate:destination=>destinations.push(destination)}},
    '@/src/config':{config:{screenshots:{fixtures:false}}},
    '@/src/storage/session':{readSession:async()=>current,subscribeSession:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}},
    '@/src/api/client':{requestJson:async(path,options={})=>{
      calls.push({path,options});
      if(options.method==='POST'){
        order.push('register');if(controls.registration)await controls.registration.promise;if(controls.registrationError)throw controls.registrationError;
        version++;return {ok:true,registrationVersion:version,...(version===1?{bindingSecret:'a'.repeat(43)}:{})};
      }
      if(options.method==='DELETE'){version++;return {ok:true,registrationVersion:version};}
      return {push:{enabled:true},email:{enabled:false}};
    }},
  };
  const api=compileModule('src/api/reminders.ts',mocks);
  mocks['@/src/api/reminders']=api;
  return {api,mocks,storage,calls,order,controls,destinations,notifications,
    current:()=>current,version:()=>version,
    token:value=>{token=value;},permission:value=>{permission=value;},permissionRequest:fn=>{requestPermission=fn;},
    switchAccount(value){current=value;for(const listener of listeners)listener(value);},
    notification(owner='A',v=version){return {notification:{request:{identifier:'fixture',content:{data:{screen:'daily',owner,registrationVersion:v}}}}};},
  };
}
test('native reminders never prompt or auto-enroll a new device merely because account push is on',async()=>{
  const f=fixture();f.permission({granted:true});await f.api.refreshGrantedPushRegistration(f.current());
  assert.deepEqual(f.order,[]);assert.equal(f.calls.length,0);assert.equal(await f.api.reminderDeviceEnabled(f.current()),false);
});
test('explicit Android enable creates its channel before requesting OS permission',async()=>{
  const f=fixture('android');await f.api.enablePushOnDevice(f.current());
  assert.ok(f.order.indexOf('channel')<f.order.indexOf('prompt'));assert.ok(f.order.indexOf('prompt')<f.order.indexOf('token'));
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  assert.equal(f.calls[0].options.body.explicitEnable,true);assert.ok(!f.calls.some(c=>c.options.body?.channel==='email'));
});
test('denied permission does not retrieve a token or register a device',async()=>{
  const f=fixture();f.permissionRequest(async()=>({granted:false}));
  await assert.rejects(f.api.enablePushOnDevice(f.current()),f.api.PushPermissionDenied);
  assert.ok(!f.order.includes('token'));assert.equal(f.calls.length,0);
});
test('registration stores a server-issued binding only in SecureStore and rotates with a version proof',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());
  const binding=JSON.parse(f.storage.get('packone.push.binding.v1'));
  assert.equal(binding.bindingSecret,'a'.repeat(43));assert.equal(binding.consented,true);
  f.token('ExpoPushToken[rotatedfixture1234567890]');await f.api.refreshGrantedPushRegistration(f.current());
  const calls=f.calls.filter(c=>c.options.method==='POST');assert.equal(calls.length,2);
  assert.equal(calls[1].options.body.bindingSecret,binding.bindingSecret);assert.equal(calls[1].options.body.registrationVersion,1);
  assert.equal(calls[1].options.body.explicitEnable,false);assert.equal(f.order.filter(x=>x==='prompt').length,1);
  assert.equal(JSON.parse(f.storage.get('packone.push.binding.v1')).registrationVersion,2);
});
test('logout/unregister clears device consent and a new account is not automatically registered',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());await f.api.unregisterReminderDevice(f.current());
  assert.equal(await f.api.reminderDeviceEnabled(f.current()),false);
  f.switchAccount(session('B'));await f.api.refreshGrantedPushRegistration(f.current());
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  assert.equal(await f.api.acceptsReminderNotification({screen:'daily',owner:'A',registrationVersion:1},f.current()),false);
});
test('permission revoked in device Settings is handled on resume without another prompt',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());f.permission({granted:false});await f.api.refreshGrantedPushRegistration(f.current());
  assert.equal(f.order.filter(x=>x==='prompt').length,1);assert.equal(f.calls.filter(c=>c.options.method==='DELETE').length,1);
  assert.equal(await f.api.reminderDeviceEnabled(f.current()),false);
});
test('account switch while the OS permission dialog is open aborts registration',async()=>{
  const f=fixture(),waiting=deferred();f.permissionRequest(()=>waiting.promise);
  const pending=f.api.enablePushOnDevice(f.current());await flush();f.switchAccount(session('B'));waiting.resolve({granted:true});
  await assert.rejects(pending,/Account changed/);assert.ok(!f.order.includes('register'));
});
test('late registration after a session change is immediately revoked instead of binding the new account',async()=>{
  const f=fixture(),waiting=deferred();f.controls.registration=waiting;
  const pending=f.api.enablePushOnDevice(f.current());await flush();f.switchAccount(session('B'));waiting.resolve();
  await assert.rejects(pending,/Account changed/);assert.equal(f.calls.filter(c=>c.options.method==='DELETE').length,1);
  assert.equal(await f.api.reminderDeviceEnabled(f.current()),false);
});
test('foreground display requires current account, explicit device consent and registration version',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());
  const valid={screen:'daily',owner:'A',registrationVersion:1};
  assert.equal(await f.api.acceptsReminderNotification(valid,f.current()),true);
  assert.equal(await f.api.acceptsReminderNotification({...valid,owner:'B'},f.current()),false);
  assert.equal(await f.api.acceptsReminderNotification({...valid,registrationVersion:0},f.current()),false);
  await f.api.clearLocalReminderConsent();assert.equal(await f.api.acceptsReminderNotification(valid,f.current()),false);
});
test('cold-start and running-app notification responses route only the current device to Daily home',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());f.controls.lastResponse=f.notification();
  const Bridge=compileModule('src/components/ReminderPushBridge.tsx',f.mocks).ReminderPushBridge;let root;
  try {
    await act(async()=>{root=Renderer.create(React.createElement(Bridge));await flush();});
    assert.deepEqual(f.destinations,['/']);
    await act(async()=>{f.controls.response(f.notification());await flush();});assert.deepEqual(f.destinations,['/','/']);
    const view=await f.controls.handler.handleNotification(f.notification().notification);assert.equal(view.shouldShowBanner,true);
    f.switchAccount(session('B'));await flush();
    await act(async()=>{f.controls.response(f.notification('A',1));await flush();});assert.equal(f.destinations.length,2);
    const old=await f.controls.handler.handleNotification(f.notification('A',1).notification);assert.equal(old.shouldShowBanner,false);
  } finally {if(root)await act(async()=>root.unmount());}
});
test('native settings mutation supplies the expected authenticated account and separate channel',async()=>{
  const f=fixture();await f.api.saveNativeReminders(f.current(),'email',true,{frequency:'daily',weekdays:[1],localTime:'09:00',timeZone:'Etc/UTC'});
  assert.equal(f.calls[0].options.body.expectedAccountId,'A');assert.equal(f.calls[0].options.body.channel,'email');
  f.switchAccount(session('B'));await assert.rejects(f.api.saveNativeReminders(session('A'),'push',true,{}),/Account changed/);
  assert.equal(f.calls.length,1);
});

const host=name=>function Host(props){return React.createElement(name,props,props.children);};
function content(node){if(node==null)return '';if(typeof node!=='object')return String(node);return Array.isArray(node)?node.map(content).join(' '):content(node.children||[]);}
async function settingsScreen(overrides={}){
  let current=session('A'),slow=null,root;
  const states={};
  for(const name of ['A','B'])states[name]={schedule:{frequency:'daily',weekdays:[1],localTime:name==='A'?'09:00':'16:00',timeZone:'Etc/UTC'},
    email:{enabled:false,eligible:true,suppressed:false,consentedAt:null,deliveredAt:null,...overrides.email},
    push:{enabled:false,consentedAt:null,providerAcceptedAt:null},nextAt:null,deliveryActive:false};
  const saves=[];
  const native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','TextInput','View'].map(name=>[name,host(name)]));
  const mocks={
    'react-native':{...native,StyleSheet:{create:x=>x},Linking:{openSettings:async()=>{}}},
    'react-native-safe-area-context':{SafeAreaView:host('SafeAreaView')},
    '@/src/theme':{colors:{},spacing:{}},
    '@/src/hooks/useAccountState':{useAccountState:()=>({session:current,account:{user:current.accountUser},busy:false,refresh:async()=>{}})},
    '@/src/api/reminders':{
      PushPermissionDenied:class extends Error {},enablePushOnDevice:async()=>{},unregisterReminderDevice:async()=>{},
      loadNativeReminders:async supplied=>structuredClone(states[supplied.accountUser.id]),
      reminderDeviceEnabled:async supplied=>{if(slow&&supplied.accountUser.id==='A')return slow.promise;return false;},
      assertReminderAccount:async supplied=>{if(supplied.accountUser.id!==current.accountUser.id)throw Error('Account changed.');},
      saveNativeReminders:async(supplied,channel,enabled,schedule)=>{
        saves.push({owner:supplied.accountUser.id,channel,enabled});
        const next=structuredClone(states[supplied.accountUser.id]);next.schedule=schedule;next[channel].enabled=enabled;return next;
      },
    },
  };
  const Screen=compileModule('app/account-reminders.tsx',mocks).default;
  await act(async()=>{root=Renderer.create(React.createElement(Screen));await flush();});
  const button=label=>root.root.findAllByType('Pressable').find(node=>content(node).trim()===label);
  return {saves,button,text:()=>content(root.toJSON()),slow:()=>{slow=deferred();return slow;},
    async switchAccount(){current=session('B');await act(async()=>{root.update(React.createElement(Screen));await flush();});},
    async close(){await act(async()=>root.unmount());},
  };
}
test('native immediate email opt-out is available after the address becomes unverified',async()=>{
  const f=await settingsScreen({email:{enabled:true,eligible:false}});
  try{
    const off=f.button('Turn email off now');assert.ok(off);assert.equal(off.props.disabled,false);
    await act(async()=>{await off.props.onPress();await flush();});
    assert.deepEqual(f.saves,[{owner:'A',channel:'email',enabled:false}]);assert.match(f.text(),/Email reminders turned off/);
  }finally{await f.close();}
});
test('native late post-save device read cannot display account A success in B settings',async()=>{
  const f=await settingsScreen(),waiting=f.slow();
  try{
    await act(async()=>{f.button('Enable email reminders').props.onPress();await flush();});
    await f.switchAccount();await act(async()=>{waiting.resolve(false);await flush();});
    assert.match(f.text(),/16:00/);assert.doesNotMatch(f.text(),/Email reminders saved/);
  }finally{await f.close();}
});

test('revoked sleeping-device registration stays off after account push is re-enabled elsewhere',async()=>{
  const f=fixture();await f.api.enablePushOnDevice(f.current());
  f.controls.registrationError=Object.assign(Error('Device changed.'),{status:409,body:{code:'DEVICE_VERSION_CHANGED'}});
  await assert.rejects(f.api.refreshGrantedPushRegistration(f.current()),/Device changed/);
  assert.equal(await f.api.reminderDeviceEnabled(f.current()),false);
  const before=f.calls.length;await f.api.refreshGrantedPushRegistration(f.current());assert.equal(f.calls.length,before);
});
