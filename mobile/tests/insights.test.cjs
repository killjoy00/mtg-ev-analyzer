const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const React=require('react');
const Renderer=require('react-test-renderer');
const {act}=Renderer;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const host=name=>function Host(props){return React.createElement(name,props,props.children);};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const labels=node=>node==null?'':typeof node==='string'||typeof node==='number'?String(node):
  Array.isArray(node)?node.map(labels).join(' '):labels(node.children||[]);
const session=(account='a')=>({playerToken:'synthetic-'+account,accountToken:'synthetic-token-'+account,
  accountUser:{id:'account-'+account},subjectId:'subject-'+account});
const fixture=environment=>({
  environment,period:'all',environment_label:environment==='powered-cube'?'Powered Cube':'Mixed',
  eligible_decisions:80,total_eligible_decisions:80,unlocked:true,unlock_at:8,unknown_difficulty:0,
  pick_depth:[{label:environment==='powered-cube'?'P1P2':'P1P1',pick_number:2,count:40,average_score:74,trophy_match_pct:50}],
  difficulty:[{band:'medium',count:80,average_score:78,trophy_match_pct:40}],
  formats:[{environment:'mixed',label:'Mixed',count:80,average_score:78,trophy_match_pct:40},
    {environment:'latest',label:'Latest Set',count:0,average_score:null,trophy_match_pct:null},
    {environment:'powered-cube',label:'Powered Cube',count:0,average_score:null,trophy_match_pct:null}],
  months:[{month:'2026-09',count:80,average_score:77,trophy_match_pct:50}],
  progress:{previous:{count:40,average_score:70,from:'2026-09-01',to:'2026-09-10'},
    recent:{count:40,average_score:83,from:'2026-09-11',to:'2026-09-20'},delta:13},
  observations:[{id:'progress',text:'Recent picks averaged 13.0 points higher than earlier picks.'}],
  versions:{scoring:[],selection:[],corpus:[]},range:{from:'2026-09-01',to:'2026-09-20'},
  session_limit:1000,methodology:'Verified original scores only.',
});
function compile(relative,mocks) {
  const filename=path.join(process.cwd(),relative),mod=new Module(filename,module);
  mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod.require=name=>{
    if(name==='@/src/components/Text')return {Text:host('Text')};
    if(name==='@/src/components/ScreenArea')return {ScreenArea:host('SafeAreaView')};
    if(Object.prototype.hasOwnProperty.call(mocks,name))return mocks[name];
    if(name.startsWith('@/'))throw Error('Unmocked Insights module: '+name);
    return require(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
    fileName:filename,
  }).outputText,filename);
  return mod.exports;
}
async function mount(t,{initial=session(),respond=async (_s,env)=>fixture(env)}={}) {
  let stored=initial,listener=()=>{},root;
  const calls=[],routes=[];
  const mocks={
    'expo-router':{router:{push:v=>routes.push(['push',v]),dismissTo:v=>routes.push(['dismiss',v])},
      Stack:{Screen:host('StackScreen')},useFocusEffect:callback=>React.useEffect(callback,[callback])},
    'react-native':{ActivityIndicator:host('ActivityIndicator'),Pressable:host('Pressable'),
      ScrollView:host('ScrollView'),StyleSheet:{create:v=>v},View:host('View')},
    '@/src/components/AboutLink':{AboutLink:host('AboutLink')},
    '@/src/api/insights':{loadMobileInsights:async(s,env,period)=>{
      calls.push([s.accountToken,env,period]);return respond(s,env,period);
    }},
    '@/src/api/client':{ApiError:class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}},
    '@/src/api/guest':{ensureGuestSession:async()=>stored||{playerToken:'synthetic-guest',accountToken:null}},
    '@/src/hooks/useAppResume':{useAppResume:()=>{}},
    '@/src/storage/session':{readSession:async()=>stored,subscribeSession:fn=>{listener=fn;return()=>{listener=()=>{};};}},
    '@/src/theme':{colors:new Proxy({},{get:()=>'#000'}),spacing:{xs:4,sm:8,md:16,lg:24,xl:32,xxl:48}},
  };
  const Screen=compile('src/screens/insights.tsx',mocks).default;
  await act(async()=>{root=Renderer.create(React.createElement(Screen));await flush();});
  await act(async()=>{await flush();});
  t.after(async()=>{await act(async()=>root.unmount());});
  return {
    root,calls,routes,text:()=>labels(root.toJSON()),
    async choose(label){
      const button=root.root.findAll(n=>n.type==='Pressable'&&(n.props.accessibilityLabel===label||labels(n)===label))[0];
      assert.ok(button,'Missing Insights button: '+label);
      await act(async()=>{button.props.onPress?.();await flush();});
      await act(async()=>{await flush();});
    },
    async switchAccount(next) {
      stored=next;
      await act(async()=>{listener(stored);await flush();});
    },
  };
}

test('native Insights screen renders all analyses, current tab and live sample figures',async t=>{
  const ui=await mount(t);
  const content=ui.text();
  for(const piece of ['Stats','Insights','Account settings','Your Drafting Insights','Pick-by-pick strengths',
    'Difficulty context','Progress over time','Format patterns','P1P1','77.0','80 eligible decisions']){
    assert.ok(content.includes(piece),'Expected Insights content: '+piece);
  }
  assert.equal(ui.calls[0][1],'mixed');
  await ui.choose('Environment: Powered Cube');
  assert.ok(ui.text().includes('P1P2'));
  assert.equal(ui.calls.at(-1)[1],'powered-cube');
  await ui.choose('Time period: Last 90 days');
  assert.equal(ui.calls.at(-1)[2],'90d');
  await ui.choose('Stats');
  assert.deepEqual(ui.routes.at(-1),['dismiss','/career']);
  await ui.choose('Account settings');
  assert.deepEqual(ui.routes.at(-1),['push','/account']);
});

test('native Insights clears private data after logout and blocks old-owner responses',async t=>{
  const ui=await mount(t);
  assert.ok(ui.text().includes('P1P1'));
  await ui.switchAccount(null);
  assert.ok(ui.text().includes('Sign in to see your Insights'));
  assert.ok(!ui.text().includes('P1P1'));
  await ui.choose('Sign in');
  assert.deepEqual(ui.routes.at(-1),['push','/account']);
});

test('new owner cannot see old owner Insight response after account switch',async t=>{
  let releaseFirst;
  const slow=new Promise(resolve=>{releaseFirst=resolve;});
  const ui=await mount(t,{respond:async(s,env)=>s.accountToken==='synthetic-token-a'?slow:fixture('powered-cube')});
  await ui.switchAccount(session('b'));
  await act(async()=>{releaseFirst(fixture('mixed'));await flush();});
  assert.ok(ui.text().includes('P1P2'));
  assert.ok(!ui.text().includes('P1P1'));
  assert.equal(ui.calls.at(-1)[0],'synthetic-token-b');
});

test('native Insights files stay local to My Pack One; no new bottom tab',()=>{
  const career=fs.readFileSync('src/screens/career.tsx','utf8');
  const layout=fs.readFileSync('app/_layout.tsx','utf8');
  const tabBar=fs.readFileSync('app/(tabs)/_layout.tsx','utf8');
  assert.match(career,/router\.push\('\/insights'\)/);
  assert.match(layout,/Stack\.Screen name="insights"/);
  assert.doesNotMatch(tabBar,/Tabs\.Screen name="insights"/);
  assert.match(fs.readFileSync('src/api/insights.ts','utf8'),/mobileAccountToken: session\.accountToken/);
});
