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
  const imagePolicy=await import('../../card-image-policy.mjs');
  const mocks={
    '../../../card-image-policy.mjs':imagePolicy,
    'expo-router':{router:{push:v=>routes.push(['push',v]),dismissTo:v=>routes.push(['dismiss',v])},
      Stack:{Screen:host('StackScreen')},useFocusEffect:callback=>React.useEffect(callback,[callback])},
    'react-native':{ActivityIndicator:host('ActivityIndicator'),Image:host('Image'),Pressable:host('Pressable'),
      ScrollView:host('ScrollView'),StyleSheet:{create:v=>v},View:host('View')},
    '@/src/components/AboutLink':{AboutLink:host('AboutLink')},
    '@/src/api/insights':{loadMobileInsights:async(s,env,period,page=1)=>{
      calls.push([s.accountToken,env,period,page]);return respond(s,env,period,page);
    },loadMobileInsightDecision:async(s,item)=>{
      calls.push([s.accountToken,'decision',item.puzzle_id]);
      return {set_id:'neo',pick_number:item.pick_number,score:item.score,trophy_match:false,
        selected:{id:'mine',name:'Verdant Rebirth',image_url:'https://cards.scryfall.io/large/front/1.jpg'},
        trophy:{id:'trophy',name:'Swiftwater Cliffs',image_url:null},
        candidates:[{id:'mine',name:'Verdant Rebirth',image_url:'https://cards.scryfall.io/large/front/1.jpg'},
          {id:'trophy',name:'Swiftwater Cliffs',image_url:null}],
        prior_picks:[{id:'prior',name:'Mystic Monastery',image_url:null}],
        trophy_drafter:{record:'7–0',win_rate:64},scoring_version:'v1',corpus_version:'v1',
        answered_at:'2026-09-12T00:00:00Z'};
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
    root,calls,routes,text:()=>labels(root.toJSON()).replace(/\s+/g,' ').trim(),
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

test('237 eligible decisions with no standout 10-point gap show honest numeric patterns',async t=>{
  const sample=fixture('mixed');
  const data={
    ...sample,eligible_decisions:237,total_eligible_decisions:237,
    observations:[],
    formats:sample.formats.map(x=>x.environment==='mixed'
      ? {...x,count:237,average_score:76.8,trophy_match_pct:42.2}:x),
    pick_depth:[{label:'P1P4',pick_number:4,count:31,average_score:74.5,trophy_match_pct:43}],
    progress:{previous:{count:40,average_score:75.2,from:'2026-09-01',to:'2026-09-10'},
      recent:{count:40,average_score:77.1,from:'2026-09-11',to:'2026-09-20'},delta:1.9},
  };
  const ui=await mount(t,{respond:async()=>data});
  const view=ui.text();
  assert.ok(view.includes('237 eligible decisions'),'total remains visible');
  assert.ok(view.includes('No standout comparison met both thresholds'),'reason is accurate');
  assert.ok(view.includes('Across 237 eligible Mixed decisions'),'cohort appears in patterns');
  assert.ok(view.includes('76.8/100'),'existing score aggregate is reused');
  assert.ok(view.includes('42.2%'),'trophy-match is backed by the cohort');
  assert.ok(view.includes('Your most recent 40 picks averaged 77.1/100'),'small descriptive trend still shown');
  assert.ok(view.includes('preceding 40 averaged 75.2/100'),'both comparison windows visible');
  assert.ok(view.includes('P1P4: 31 decisions averaging 74.5/100'),'largest source pick position is descriptive');
  assert.ok(!view.includes('Not enough comparable decisions yet'),'high-sample accounts are not told they lack decisions');
});

test('under-sampled descriptive groups are not represented as measured patterns',async t=>{
  const sample=fixture('mixed');
  const data={...sample,eligible_decisions:8,total_eligible_decisions:8,
    observations:[],progress:null,
    formats:sample.formats.map(x=>x.environment==='mixed'
      ? {...x,count:8,average_score:70,trophy_match_pct:50}:x),
    pick_depth:[{label:'P1P1',pick_number:1,count:3,average_score:null,trophy_match_pct:null}],
  };
  const ui=await mount(t,{respond:async()=>data});
  const view=ui.text();
  assert.ok(view.includes('Across 8 eligible Mixed decisions'));
  assert.ok(!view.includes('Your most-recorded source pick position'),'3-pick group must not produce average copy');
  assert.ok(!view.includes('Your most recent 40 picks averaged'),'missing windows must not produce trend');
});

test('native scouting report renders evidence-backed DNA, original cards and Journey with owner-only review',async t=>{
  const initial=fixture('mixed');
  const advanced={...initial,
    drafting_dna:{schema_version:'drafting-dna-v1',status:'ready',scope:'all-eligible-history',
      eligible_decisions:237,primary:{status:'qualified',id:'independent-thinker',
        title:'The Independent Thinker',evidence_family:'alternatives',
        summary:'You made strong alternatives.',supporting_decisions:237,
        evidence:[{label:'Strong alternatives',value:48}]},
      secondary:[{status:'qualified',id:'closer',title:'The Closer',summary:'Later picks scored higher.',
        evidence_family:'pick-depth',supporting_decisions:90,evidence:[{label:'Late picks',value:44}]},
        {status:'emerging',label:'Trait still developing'}],
      note:'Original scores only.'},
    journey:{version:'drafting-journey-v1',eligible_decisions:80,window_size:40,
      windows:[{id:'window-0',from:'2026-09-01',to:'2026-09-09',count:40,
        average_score:69,complete:true,cohort:'c1'},
        {id:'window-1',from:'2026-09-10',to:'2026-09-20',count:40,
          average_score:81,complete:true,cohort:'c1'}],
      total_windows:2,versions_comparable:true,milestones:[{id:'first-40',date:'2026-09-09',
        text:'First 40 decisions',count:40}],note:'True recorded scores.',limited:false},
    highlights:{schema_version:'decision-highlights-v1',note:'Original selections',
      best:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:1,puzzle_id:'fixture-1',
        set_id:'neo',environment:'mixed',pick_number:3,date:'2026-09-12',score:91,
        trophy_match:false,preview:{selected:{id:'mine',name:'Verdant Rebirth',image_url:'https://cards.scryfall.io/large/front/1.jpg'},
          trophy:{id:'trophy',name:'Swiftwater Cliffs',image_url:null}}}],
      misses:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:2,puzzle_id:'fixture-2',
        set_id:'neo',environment:'mixed',pick_number:4,date:'2026-09-13',score:24,
        trophy_match:false,preview:{selected:{id:'mine',name:'Verdant Rebirth',image_url:null},
          trophy:{id:'trophy',name:'Swiftwater Cliffs',image_url:null}}}]},
  };
  const ui=await mount(t,{respond:async()=>advanced});
  for(const piece of ['Your Drafting DNA','The Independent Thinker','The Closer','Trait still developing',
    'Your Best Calls & Biggest Misses','Your Drafting Journey','69.0','81.0','Verdant Rebirth']) {
    assert.ok(ui.text().includes(piece),'Missing scouting UI: '+piece);
  }
  await ui.choose('Review original pack');
  for(const piece of ['Original saved pack','Swiftwater Cliffs','Mystic Monastery','7–0']){
    assert.ok(ui.text().includes(piece),'Original detail missing '+piece);
  }
  assert.ok(ui.calls.some(x=>x[1]==='decision'&&x[2]==='fixture-1'));
  await ui.switchAccount(null);
  assert.ok(ui.text().includes('Sign in to see your Insights'));
  assert.ok(!ui.text().includes('Verdant Rebirth'));
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

test('native v2 renders pick distance, bounded page 2, local timestamp ranges and safe card fallbacks',async t=>{
 const first={...fixture('mixed'),
   drafting_dna:{schema_version:'drafting-dna-v2',status:'emerging',scope:'all-eligible-history',
     eligible_decisions:24,picks_needed:56,primary:null,
     secondary:[{status:'emerging',label:'Trait still developing',picks_needed:56},
       {status:'emerging',label:'Trait still developing',picks_needed:56}],note:'Provisional gates.'},
   journey:{version:'drafting-journey-v2',eligible_decisions:80,window_size:40,
     windows:[{id:'window-0',from:'2026-10-31',to:'2026-11-01',
       from_at:'2026-10-31T23:55:00.000Z',to_at:'2026-11-01T00:05:00.000Z',
       count:40,average_score:85,complete:true,cohort:'synthetic'}],
     milestones:[{id:'first-forty',date:'2026-11-01',text:'First 40 decisions',count:40,
       from_at:'2026-10-31T23:55:00.000Z',to_at:'2026-11-01T00:05:00.000Z'}],
     total_windows:1,versions_comparable:true,limited:false,note:'Original scores.'},
   highlights:{schema_version:'decision-highlights-v2',page:1,has_more:{best:true,misses:true},
     best:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:1,puzzle_id:'fixture-1',
       set_id:'neo',environment:'mixed',pick_number:1,date:'2026-11-01',score:90,
       trophy_match:false,preview:{selected:{id:'mine',name:'Only Placeholder',image_url:'https://unsafe.invalid/tracker.jpg'},
         trophy:{id:'trophy',name:'Allowed Original',image_url:'https://cards.scryfall.io/normal/front/card.jpg'}}}],
     misses:[],note:'Original picks.'},
 };
 const next={...first,highlights:{...first.highlights,page:2,has_more:{best:false,misses:false},
   best:[{...first.highlights.best[0],puzzle_id:'fixture-2',preview:{
     selected:{id:'mine',name:'Second Card',image_url:'javascript:alert(1)'},
     trophy:{id:'trophy',name:'Trophy Card',image_url:null}}}],
   misses:[]}};
 const ui=await mount(t,{respond:async(_s,_e,_p,page)=>page===2?next:first});
 const content=ui.text();
 assert.match(content,/56 more eligible decisions/);
 assert.match(content,/Oct 31/,'v2 timestamps are rendered in local format');
 const images=ui.root.root.findAll(n=>n.type==='Image');
 assert.equal(images.length,1,'unapproved selected art is a card-name fallback');
 assert.equal(images[0].props.source.uri,'https://cards.scryfall.io/normal/front/card.jpg');
 assert.ok(content.includes('Only Placeholder'));
 await ui.choose('Load more saved picks (page 2 of 2)');
 assert.ok(ui.text().includes('Second Card'));
 assert.ok(!ui.text().includes('Load more saved picks (page 2 of 2)'));
 assert.deepEqual(ui.calls.map(c=>c[3]),[1,2]);
});
test('native shared image policy refuses HTTP, script and foreign hosts',async()=>{
 const {safeCardImageUrl}=await import('../../card-image-policy.mjs');
 for(const input of ['http://cards.scryfall.io/normal/x.jpg','javascript:alert(1)',
   'https://other.invalid/x.jpg'])assert.equal(safeCardImageUrl(input),null);
 assert.equal(safeCardImageUrl('https://cards.scryfall.io/normal/x.jpg'),
   'https://cards.scryfall.io/normal/x.jpg');
});

test('Metro resolver includes the repository root for the canonical shared image policy',()=>{
 const path=require('node:path');
 const config=require('../metro.config.js');
 const repoRoot=path.resolve(process.cwd(),'..');
 assert.ok(config.watchFolders.some(folder=>path.resolve(folder)===repoRoot));
});
