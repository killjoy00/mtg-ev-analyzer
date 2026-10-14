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
    if(name==='@/src/components/MyPackSectionTabs')return compile('src/components/MyPackSectionTabs.tsx',mocks);
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
      ScrollView:host('ScrollView'),Modal:host('Modal'),StyleSheet:{create:v=>v},View:host('View'),
      useWindowDimensions:()=>({width:390,height:844,fontScale:1})},
    '@/src/components/AboutLink':{AboutLink:host('AboutLink')},
    '@/src/config':{config:{screenshots:{fixtures:false}}},
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

test('native Insights keeps hierarchy, breakdowns collapsed and navigation intact',async t=>{
 const ui=await mount(t),content=ui.text();
 for(const piece of ['Stats','Insights','Account settings','Your picks','More stats','80 picks included']){
   assert.ok(content.includes(piece),'Expected overview: '+piece);
 }
 assert.ok(!content.includes('Pick-by-pick breakdown'),'Charts start collapsed');
 await ui.choose('More stats');
 for(const piece of ['Pick-by-pick breakdown','Difficulty breakdown','Format breakdown','P1P1','74.0','78.0']){
   assert.ok(ui.text().includes(piece),'Missing expanded chart: '+piece);
 }
 assert.equal(ui.calls[0][1],'mixed');
 await ui.choose('Format: Powered Cube');
 assert.ok(ui.text().includes('Powered Cube'));
 assert.equal(ui.calls.at(-1)[1],'powered-cube');
 await ui.choose('Time period: Last 90 days');
 assert.equal(ui.calls.at(-1)[2],'90d');
 await ui.choose('Stats');assert.deepEqual(ui.routes.at(-1),['dismiss','/career']);
 await ui.choose('Account settings');assert.deepEqual(ui.routes.at(-1),['push','/account']);
});

test('237 decisions without standout finding keep neutral copy, not a manufactured average',async t=>{
 const sample=fixture('mixed'),data={...sample,eligible_decisions:237,total_eligible_decisions:237,observations:[],
   highlights:{schema_version:'decision-highlights-v2',best:[],misses:[],note:'Historical calls.'}};
 const ui=await mount(t,{respond:async()=>data});
 const view=ui.text();
 assert.ok(view.includes('237 picks included'));
 assert.ok(view.includes('No high-scoring picks here'));
 assert.ok(!view.includes('Leading finding'));
 assert.ok(!view.includes('hard-rated decisions averaged'));
 assert.ok(!view.includes('Your most-recorded source pick position'));
});

test('under-sampled groups remain descriptive, without repetitive threshold paragraphs',async t=>{
 const sample=fixture('mixed');
 const data={...sample,eligible_decisions:8,total_eligible_decisions:8,observations:[],progress:null,
   pick_depth:[{label:'P1P1',pick_number:1,count:3,average_score:null,trophy_match_pct:null}],
   drafting_dna:{schema_version:'drafting-dna-v2',status:'emerging',scope:'all-eligible-history',
     eligible_decisions:8,primary:null,secondary:[{status:'emerging',label:'Developing'},
     {status:'emerging',label:'Developing'}],note:'Provisional only.'}};
 const ui=await mount(t,{respond:async()=>data});
 assert.ok(ui.text().includes('8 picks included'));
 assert.ok(!ui.text().includes('3-pick average is a skill measure'));
 await ui.choose('More stats');
 assert.ok(ui.text().includes('Need 5 picks'));
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
  for(const piece of ['Your pick patterns','The Independent Thinker','The Closer',
    'Picks to review','Your scores over time','69.0','81.0','Verdant Rebirth']) {
    assert.ok(ui.text().includes(piece),'Missing scouting UI: '+piece);
  }
  await ui.choose('High-scoring picks');
  await ui.choose('Review pick');
  for(const piece of ['Review pick','Swiftwater Cliffs','Mystic Monastery','7–0']){
    assert.ok(ui.text().includes(piece),'Original detail missing '+piece);
  }
  assert.ok(ui.calls.some(x=>x[1]==='decision'&&x[2]==='fixture-1'));
  await ui.choose('Close');
  assert.ok(!ui.text().includes('Mystic Monastery'),'Detail closes without losing overview');
  await ui.switchAccount(null);
  assert.ok(ui.text().includes('Sign in to see your Insights'));
  assert.ok(!ui.text().includes('Verdant Rebirth'));
});

test('native Insights clears private data after logout and blocks old-owner responses',async t=>{
  const ui=await mount(t);
  assert.ok(ui.text().includes('80 picks included · Mixed sets'));
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
  assert.ok(ui.text().includes('80 picks included · Powered Cube'));
  assert.ok(!ui.text().includes('80 picks included · Mixed sets'));
  assert.equal(ui.calls.at(-1)[0],'synthetic-token-b');
});

test('native Insights files stay local to My Pack One; no new bottom tab',()=>{
  const career=fs.readFileSync('src/screens/career.tsx','utf8');
  const layout=fs.readFileSync('app/_layout.tsx','utf8');
  const tabBar=fs.readFileSync('app/(tabs)/_layout.tsx','utf8');
  assert.match(career,/<MyPackSectionTabs active="stats" \/>/);
  const navigation=fs.readFileSync('src/components/MyPackSectionTabs.tsx','utf8');
  assert.match(navigation,/router\.push\('\/insights'\)/);
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
 assert.ok(content.includes('How this works'));
 assert.ok(!content.includes('56 more eligible decisions'),'threshold copy stays collapsed');
 assert.match(content,/Oct 31/,'v2 timestamps are rendered in local format');
 const images=ui.root.root.findAll(n=>n.type==='Image');
 assert.equal(images.length,1,'unapproved selected art is a card-name fallback');
 assert.equal(images[0].props.source.uri,'https://cards.scryfall.io/normal/front/card.jpg');
 assert.ok(content.includes('Only Placeholder'));
 await ui.choose('See more picks');
 await ui.choose('Load more picks');
 assert.ok(ui.text().includes('Second Card'));
 assert.ok(!ui.text().includes('Load more picks'));
 assert.deepEqual(ui.calls.map(c=>c[3]),[1,2]);
});

test('older native API still shows scores without inventing unsupported review cards or headlines',async t=>{
  const data=fixture('mixed'); // No highlights, Journey or DNA.
  const ui=await mount(t,{respond:async()=>data});
  const text=ui.text();
  assert.ok(text.includes('Picks to review'));
  assert.ok(text.includes('Pick examples aren’t available from this version yet.'));
  assert.ok(text.includes('Your scores over time'));
  assert.ok(text.includes('Your last 40 picks averaged 83.0/100'));
  assert.ok(text.includes('previous 40 (70.0/100)'));
  assert.ok(text.includes('2026-09'));
  assert.ok(!text.includes('Recent picks averaged 13.0 points higher'),
    'older API observations are not automatically promoted into a player diagnosis');
});
test('older native leading difficulty finding is not presented as a strength or weakness',async t=>{
  const data={...fixture('mixed'),observations:[],
    leading_finding:{id:'difficulty',text:'Hard-rated decisions scored differently from easy-rated decisions.'}};
  const ui=await mount(t,{respond:async()=>data});
  assert.ok(!ui.text().includes(data.leading_finding.text));
});
test('native Journey visibly marks incomparable versions and the exact cohort boundary',async t=>{
  const data={...fixture('mixed'),
    journey:{version:'drafting-journey-v2',eligible_decisions:80,window_size:40,
      windows:[{id:'one',from:'2026-08-01',to:'2026-08-25',count:40,average_score:63,
        complete:true,cohort:'old-scoring'},
        {id:'two',from:'2026-09-01',to:'2026-09-25',count:40,average_score:89,
          complete:true,cohort:'new-scoring'}],
      total_windows:2,versions_comparable:false,progress_compatible:false,
      milestones:[],limited:false,note:'Historical scoring differs.'}};
  const ui=await mount(t,{respond:async()=>data});
  const text=ui.text();
  assert.ok(text.includes('These groups cannot be read as one continuous trend'));
  assert.ok(text.includes('Scoring or card pool changed'),'boundary marker appears next to the chart');
  assert.ok(!text.includes('Your last 40 picks averaged 83.0/100'),
    'unsupported comparison is never presented as a coherent progress line');
  await ui.choose('More score details');
  assert.ok(ui.text().includes('Historical scoring differs.'));
});
test('a single short Journey without a full window does not invent a model-version change',async t=>{
  const data={...fixture('mixed'),progress:null,
    journey:{version:'drafting-journey-v2',eligible_decisions:12,window_size:40,
      windows:[{id:'partial',from:'2026-10-01',to:'2026-10-04',count:12,
        average_score:75,complete:false,cohort:'same-model'}],
      total_windows:1,versions_comparable:false,progress_compatible:true,
      milestones:[],limited:false,note:'Original recorded scores.'}};
  const ui=await mount(t,{respond:async()=>data});
  assert.ok(ui.text().includes('Your scores over time'));
  assert.ok(!ui.text().includes('Scoring or card-pool versions changed'));
  assert.ok(!ui.text().includes('Scoring or card pool changed'));
});

test('native compact choice rows show the result first and hide method/examples by default',async t=>{
  const data={...fixture('mixed'),drafting_dna:{
    schema_version:'drafting-dna-v2',status:'ready',scope:'all-eligible-history',eligible_decisions:237,
    primary:{status:'qualified',id:'independent-thinker',title:'The Independent Thinker',
      summary:'You often made strong alternative picks.',supporting_decisions:237,
      evidence_family:'alternatives',evidence:[{label:'Strong alternatives',value:48}]},
    secondary:[{status:'emerging',label:'Trait still developing'},{status:'emerging',label:'Trait still developing'}],
    note:'Threshold rules stay behind a disclosure.'
  },card_choices:{schema_version:'choice-context-v1',scope:'all-eligible-history',minimum_opportunities:20,
    note:'Same saved pack support only.',choices:[
      {id:'card-type',title:'Creature vs noncreature',status:'ready',opportunities:26,
        selected:{creature:19,noncreature:7},availability:{creature:26,noncreature:26},
        cohort:'v1',summary:'When both creatures and noncreatures were competitive, 19 were creatures.',examples:[]},
      {id:'rarity',title:'Rarity',status:'ready',opportunities:26,
        selected:{'rare-mythic':8,'common-uncommon':18},
        availability:{'rare-mythic':26,'common-uncommon':26},
        cohort:'v1',summary:'When rarities competed, 8 were rare or mythic.',examples:[]}]
  }};
  const ui=await mount(t,{respond:async()=>data});
  const text=ui.text();
  assert.ok(text.includes('The Independent Thinker'));
  assert.ok(text.includes('Across formats · All available history'));
  assert.ok(!text.includes('19 of 26 qualifying picks'),'conditional denominators stay collapsed');
  await ui.choose('Card type and rarity counts');
  assert.ok(ui.text().includes('19 of 26 qualifying picks'));
  assert.ok(ui.text().includes('8 of 26 qualifying picks'));
  assert.ok(!text.includes('When both creatures and noncreatures were competitive'));
  assert.ok(!text.includes('Threshold rules stay behind a disclosure'));
  await ui.choose('Examples and counts');
  assert.ok(ui.text().includes('When both creatures and noncreatures were competitive'));
  await ui.choose('How this works');
  assert.ok(ui.text().includes('Threshold rules stay behind a disclosure'));
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

test('native review tabs prefer picks to revisit and fall back to high-scoring picks',async t=>{
  const a=fixture('mixed'),p={session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:1,
    puzzle_id:'category-a',set_id:'neo',environment:'mixed',pick_number:2,date:'2026-09-12',
    score:39,trophy_match:false,selected_name:'Chosen',historical_name:'Trophy',
    preview:{selected:{id:'x',name:'Chosen',image_url:null},trophy:{id:'t',name:'Trophy',image_url:null}}};
  const first={...a,highlights:{schema_version:'decision-highlights-v3',best:[{...p,puzzle_id:'category-b',score:91}],
    misses:[p],note:''}};
  const ui=await mount(t,{respond:async()=>first});
  assert.ok(ui.text().includes('No clear pick pattern')===false);
  let tabs=ui.root.root.findAll(n=>n.type==='Pressable'&&n.props.accessibilityRole==='tab');
  assert.equal(tabs[0].props.accessibilityState.selected,true,'revisit is the default');
  await ui.choose('High-scoring picks');
  tabs=ui.root.root.findAll(n=>n.type==='Pressable'&&n.props.accessibilityRole==='tab');
  assert.equal(tabs[1].props.accessibilityState.selected,true);
  await ui.switchAccount(null);
});
test('native sparse history and both empty highlight categories stay neutral',async t=>{
 const f=fixture('mixed');
 const data={...f,eligible_decisions:9,progress:null,observations:[],
   drafting_dna:{schema_version:'drafting-dna-v2',status:'emerging',scope:'all-eligible-history',
     eligible_decisions:9,primary:null,secondary:[],note:'Needs support.'},
   highlights:{schema_version:'decision-highlights-v3',best:[],misses:[],note:''}};
 const ui=await mount(t,{respond:async()=>data});
 assert.ok(ui.text().includes('No high-scoring picks here'));
 assert.ok(ui.text().includes('No clear pick pattern to show yet.'));
 assert.ok(!ui.text().includes('Trait still developing'));
 assert.ok(!ui.text().includes('You drafted badly'));
});
