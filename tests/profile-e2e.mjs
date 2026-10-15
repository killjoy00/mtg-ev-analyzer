import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { selectInsightHighlights } from '../worker/draft-run-insights-extras.mjs';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const growthOrigin = 'https://br-twilight-hill-ayffyd2b-pack1growth.compute.c-5.us-east-2.aws.neon.tech';
const draftOrigin = 'https://br-twilight-hill-ayffyd2b-draftrunapi.compute.c-5.us-east-2.aws.neon.tech';
const profileKey = '0123456789abcdef';
await mkdir('artifacts', { recursive: true });

const browser = await chromium.launch(process.env.CI ? { headless:true, channel:'chrome' } : { headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 }, timezoneId:'America/Los_Angeles' });
let updatePayload = null;
let updateMode = 'success';
let shareCalls = 0;
let accountMode = 'signed-in';
let insightsMode = 'ready';
let releaseDelayedPageTwo = null;
const savedDecisions = new Map();
const decisionKey = (session, round, puzzle) => JSON.stringify([session, String(round), puzzle]);

await page.addInitScript(() => {
  localStorage.setItem('pack1-auth-session-v1','profile-auth-fixture');
  Object.defineProperty(navigator, 'share', { configurable:true, value: async () => { window.__pack1ShareCalls = (window.__pack1ShareCalls || 0) + 1; } });
  Object.defineProperty(navigator, 'canShare', { configurable:true, value: () => false });
});

// The UI snapshot needs a deterministic *loaded-image* state as well as
// card-name fallbacks. This route never fetches live card art or uses player data.
const syntheticCardArt = `<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680">
  <rect width="488" height="680" fill="#e8f0f6"/>
  <rect x="21" y="21" width="446" height="638" rx="24" fill="#244d75"/>
  <circle cx="244" cy="237" r="143" fill="#7fb7c7"/>
  <path d="M76 462 L186 285 L252 380 L331 260 L415 462 Z" fill="#f1d593"/>
  <text x="244" y="558" text-anchor="middle" font-family="sans-serif" font-size="33" fill="#fff">SYNTHETIC ART</text>
</svg>`;
await page.route('https://cards.scryfall.io/normal/front/synthetic-*.svg', async route => {
  await route.fulfill({ status:200, contentType:'image/svg+xml', body:syntheticCardArt });
});

const fixture = {
  player: {
    display_name:'Profile Tester',
    profile_key:profileKey,
    profile_public:true,
    favorite_set_id:'neo',
    showcase_achievement:'explorer5',
    claimed:true,
    username_owned:true,
  },
  summary: {
    games:42,
    average_score:78.6,
    best_score:100,
    challenge_wins:8,
    challenge_losses:3,
    challenge_ties:1,
    daily_games:14,
    environments_played:6,
    current_streak:5,
  },
  environment_total:32,
  current_season:{
    id:'hob',
    set_id:'hob',
    name:'The Hobbit',
    set_release_date:'2026-08-14',
    start_date:'2026-09-10',
    end_date:null,
    established_by_day:'2026-09-19',
    standings:[
      {environment:'mixed',rank:312,average:88.4,days:17},
      {environment:'powered-cube',rank:7,average:91.1,days:11},
      {environment:'latest',rank:18,average:86.9,days:8},
    ],
  },
  by_set:[
    { set_id:'neo', games:8, average_score:86.2, best_score:100, daily_games:3, last_played_at:'2026-09-09T12:00:00Z' },
    { set_id:'ktk', games:6, average_score:82.1, best_score:95, daily_games:2, last_played_at:'2026-09-08T12:00:00Z' },
    { set_id:'mid', games:5, average_score:79.4, best_score:91, daily_games:2, last_played_at:'2026-09-07T12:00:00Z' },
    { set_id:'vow', games:4, average_score:77.0, best_score:88, daily_games:1, last_played_at:'2026-09-06T12:00:00Z' },
    { set_id:'msh', games:3, average_score:75.0, best_score:84, daily_games:1, last_played_at:'2026-09-05T12:00:00Z' },
    { set_id:'powered-cube', games:2, average_score:73.5, best_score:81, daily_games:0, last_played_at:'2026-09-04T12:00:00Z' },
  ],
  by_mode:[
    { mode:'top3', games:24, average_score:81.2, best_score:100 },
    { mode:'full', games:18, average_score:75.1, best_score:94 },
  ],
  best_environments:[
    { set_id:'neo', games:8, average_score:86.2, best_score:100 },
    { set_id:'ktk', games:6, average_score:82.1, best_score:95 },
    { set_id:'mid', games:5, average_score:79.4, best_score:91 },
  ],
  cube:{ set_id:'powered-cube', games:2, average_score:73.5, best_score:81 },
  daily_history:[
    { date:'2026-09-09', set_id:'neo', mode:'top3', score:93, grade:'A', rank:7, total:100, percentile:7 },
    { date:'2026-09-08', set_id:'ktk', mode:'full', score:84, grade:'B+', rank:18, total:90, percentile:20 },
  ],
  recent:Array.from({ length:20 }, (_,index) => ({
    cursor:String(200-index),
    played_at:`2026-09-${String(Math.max(1,9-Math.floor(index/3))).padStart(2,'0')}T12:00:00Z`,
    set_id:index % 5 === 0 ? 'powered-cube' : index % 2 ? 'neo' : 'ktk',
    mode:index % 3 ? 'top3' : 'full',
    score:70 + (index % 25),
    grade:'B',
    is_daily:index < 4,
    outcome:null,
  })),
  trend:Array.from({ length:12 }, (_,index) => ({ played_at:`2026-09-${String(index+1).padStart(2,'0')}T12:00:00Z`, score:70+index, set_id:'neo', mode:'top3' })),
  achievements:[
    { id:'first', label:'First Pack', description:'Complete your first scored Pack One game.', unlocked:true, current:1, target:1, progress_text:'1/1' },
    { id:'explorer5', label:'Archive Explorer', description:'Play five different environments.', unlocked:true, current:5, target:5, progress_text:'5/5' },
    { id:'explorer10', label:'Format Traveler', description:'Play ten different environments.', unlocked:false, current:6, target:10, progress_text:'6/10' },
    { id:'top10', label:'Top Ten Percent', description:'Finish in the top 10% of a Daily leaderboard with at least 10 players.', unlocked:true, current:1, target:1, progress_text:'Top 7% best' },
  ],
};

// Serving metadata has a different lifecycle than the published archive.
await page.route(`${draftOrigin}/v1/set-catalog`, async route => {
  await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
    corpus_version:'fixture', sets:[
      { set_id:'neo' }, { set_id:'ktk' }, { set_id:'powered-cube' },
    ],
  }) });
});

await page.route(`${growthOrigin}/**`, async (route) => {
  const url = new URL(route.request().url());
  let status = 200;
  let body = { ok:true };
  if (url.pathname === '/v1/session') {
    body = { token:'p1_00000000-0000-4000-8000-000000000000.e2e', playerId:'00000000-0000-4000-8000-000000000000', displayName:'Profile Tester', profileKey };
  } else if (url.pathname === '/v1/account/session') {
    assert.equal(route.request().headers()['x-pack1-auth-session'],'profile-auth-fixture');
    if(accountMode === 'unavailable') {
      status = 503;
      body = { error:'Account unavailable fixture.' };
    } else if(accountMode === 'signed-out') {
      status = 401;
      body = { error:'Account session expired.' };
    } else {
      body = { session:{ token:'profile-auth-fixture' }, user:{ email:'profile@example.invalid', name:'Profile Tester' } };
    }
  } else if (url.pathname === '/v1/account/link') {
    assert.equal(route.request().headers()['x-pack1-auth-session'],'profile-auth-fixture');
    body = { token:'p1_00000000-0000-4000-8000-000000000000.e2e', merged:false };
  } else if (url.pathname === '/v1/patreon/status') {
    body = { configured:true, connected:false, membership:null, capabilities:[], support_url:'https://www.patreon.com/c/PackOne' };
  } else if (url.pathname === '/v1/profile/insights') {
    const env = url.searchParams.get('environment') || 'mixed';
    const period = url.searchParams.get('period') || 'all';
    if (insightsMode === 'offline') {
      status = 503;
      body = { error:'Synthetic Insights outage.' };
    } else {
      body = {
        environment:env,
        period,
        environment_label:{mixed:'Mixed',latest:'Latest Set','powered-cube':'Powered Cube'}[env],
        eligible_decisions:80,total_eligible_decisions:160,unlocked:true,unlock_at:8,unknown_difficulty:0,
        pick_depth:[{pick_number:env==='powered-cube'?2:1,label:env==='powered-cube'?'P1P2':'P1P1',count:40,average_score:78,trophy_match_pct:50}],
        difficulty:[{band:'hard',count:40,average_score:88,trophy_match_pct:55},
           {band:'easy',count:40,average_score:76,trophy_match_pct:35}],
        months:[{month:'2026-09',count:80,average_score:77,trophy_match_pct:40}],
        formats:['mixed','latest','powered-cube'].map((environment,index)=>({
          environment,label:{mixed:'Mixed',latest:'Latest Set','powered-cube':'Powered Cube'}[environment],
          count:80,average_score:76+index,trophy_match_pct:40,
        })),
        progress:{recent:{count:40,average_score:83,trophy_match_pct:50,from:'2026-09-15',to:'2026-09-25'},
          previous:{count:40,average_score:70,trophy_match_pct:30,from:'2026-09-01',to:'2026-09-14'},delta:13},
        observations:[{id:'difficulty',text:'Hard-rated decisions averaged 12.0 points higher than easy-rated decisions (40 vs 40 decisions).'},
           {id:'progress',text:'Recent 40 picks averaged 13.0 points higher than the previous 40 picks (40 vs 40 decisions).'}],
         leading_finding:{id:'difficulty',text:'Hard-rated decisions averaged 12.0 points higher than easy-rated decisions (40 vs 40 decisions).',
           compared_groups:[{label:'hard-rated decisions',relation:'higher'},
             {label:'easy-rated decisions',relation:'lower'}]},
        versions:{scoring:['trophy-consensus-v3-linear-v2'],selection:['eight-pick-v4'],corpus:['fixture']},
        range:{from:'2026-09-01',to:'2026-09-25'},session_limit:1000,
        drafting_dna:{schema_version:'drafting-dna-v1',status:'ready',scope:'all-eligible-history',
          eligible_decisions:160,primary:{status:'qualified',id:'independent-thinker',title:'The Independent Thinker',
            evidence_family:'alternatives',summary:'You often found a supported alternative to the trophy pick.',
            supporting_decisions:160,evidence:[{label:'High scoring alternatives',value:44}]},
          secondary:[{status:'qualified',id:'steady-hand',title:'The Steady Hand',evidence_family:'consistency',
            summary:'Your first-time scores had a narrow low tail.',supporting_decisions:160,
            evidence:[{label:'Low-score picks',value:3}]},
            {status:'emerging',label:'Trait still developing'}],
          note:'Descriptive labels, not proven skill ratings.'},
        card_choices:{schema_version:'choice-context-v1',scope:'all-eligible-history',minimum_opportunities:20,
          note:'Competitive saved support is a descriptive comparison, not a card-pick probability.',
          choices:[
            {id:'card-type',title:'Creature or noncreature',status:'ready',opportunities:26,
              selected:{creature:19,noncreature:7},availability:{creature:26,noncreature:26},
              cohort:'fixture-scoring|eight-pick-v4|fixture-corpus',
              summary:'When both creatures and noncreatures had competitive saved model support, you chose a creature in 19 of 26 decisions.',
              examples:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:2,puzzle_id:'fixture-pack-1',
                set_id:'neo',pick_number:3,date:'2026-09-15',selected_name:'Daring Skyjek'}]},
            {id:'rarity',title:'Rare/mythic or common/uncommon',status:'ready',opportunities:26,
              selected:{'rare-mythic':8,'common-uncommon':18},
              availability:{'rare-mythic':26,'common-uncommon':26},
              cohort:'fixture-scoring|eight-pick-v4|fixture-corpus',
              summary:'When rare/mythic and common/uncommon cards both had competitive saved model support, you chose a rare or mythic in 8 of 26 decisions.',
              examples:[]}
          ]},
        journey:{version:'drafting-journey-v1',eligible_decisions:80,window_size:40,total_windows:2,
          windows:[{id:'window-0',from:'2026-09-01',to:'2026-09-14',count:40,
            average_score:70,complete:true,cohort:'same'},
            {id:'window-1',from:'2026-09-15',to:'2026-09-25',count:40,
              average_score:83,complete:true,cohort:'same'}],
          versions_comparable:true,limited:false,best_window:null,
          milestones:[{id:'first-forty',date:'2026-09-14',text:'First completed 40-decision window',count:40}],
          note:'Original recorded scores, not an estimate of skill improvement.'},
        highlights:{schema_version:'decision-highlights-v1',note:'Original awarded picks',
          best:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:2,puzzle_id:'fixture-pack-1',
            set_id:'neo',environment:'mixed',pick_number:3,date:'2026-09-15',score:92,
            trophy_match:false,reason_code:'strong-scored-alternative',
            finding_context:'From hard-rated decisions in this comparison',
            reason_text:'Your original non-trophy pick earned 92/100 in a hard-rated saved pack.',
            preview:{selected:{id:'card-mine',name:'Daring Skyjek',image_url:'https://cards.scryfall.io/normal/front/synthetic-selected.svg'},
              trophy:{id:'card-trophy',name:'Frost Lynx',image_url:'https://cards.scryfall.io/normal/front/synthetic-trophy.svg'}}},
          {session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:4,puzzle_id:'fixture-pack-4',
            set_id:'ktk',environment:'mixed',pick_number:6,date:'2026-09-20',score:100,
            trophy_match:true,reason_code:'hard-trophy-match',
            finding_context:'From hard-rated decisions in this comparison',
            reason_text:'You matched the source trophy pick on a historically hard-rated pack.',
            preview:{selected:{id:'same',name:'Skyguard Captain',image_url:null},
              trophy:{id:'same',name:'Skyguard Captain',image_url:null}}},
          {session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:5,puzzle_id:'fixture-pack-5',
            set_id:'mkm',environment:'mixed',pick_number:8,date:'2026-09-18',score:88,
            trophy_match:false,reason_code:'strong-scored-alternative',
            finding_context:'From easy-rated decisions in this comparison',
            reason_text:'Your saved alternative earned 88/100 from the original scoring model.',
            preview:{selected:{id:'oath',name:'Luminous Oath',image_url:null},
              trophy:{id:'reckoner',name:'Boros Reckoner',image_url:null}}},
          {session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:6,puzzle_id:'fixture-pack-6',
            set_id:'neo',environment:'mixed',pick_number:6,date:'2026-09-17',score:90,
            trophy_match:false,finding_context:'From hard-rated decisions in this comparison',
            preview:{selected:{id:'four',name:'Skyline Adept',image_url:null},
              trophy:{id:'other',name:'Frost Lynx',image_url:null}}},
          {session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:7,puzzle_id:'fixture-pack-7',
            set_id:'ktk',environment:'mixed',pick_number:8,date:'2026-09-16',score:89,
            trophy_match:false,finding_context:'From easy-rated decisions in this comparison',
            preview:{selected:{id:'five',name:'Riverstone Sentinel',image_url:null},
              trophy:{id:'other',name:'Frost Lynx',image_url:null}}}],
          misses:[{session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',round:3,puzzle_id:'fixture-pack-2',
            set_id:'ktk',environment:'mixed',pick_number:5,date:'2026-09-16',score:32,
            trophy_match:false,preview:{selected:{id:'card-mine',name:'Daring Skyjek',image_url:null},
              trophy:{id:'card-trophy',name:'Frost Lynx',image_url:null}}}]},
        methodology:'First answer to each puzzle, original points, 1,000-session cap.',
      };
      if(insightsMode==='v2'||insightsMode==='v2-delayed') {
        body={...body,
          drafting_dna:{schema_version:'drafting-dna-v2',status:'emerging',scope:'all-eligible-history',
            eligible_decisions:38,picks_needed:42,primary:null,
            secondary:[{status:'emerging',label:'Trait still developing',picks_needed:42},
              {status:'emerging',label:'Trait still developing',picks_needed:42}],note:'Provisional gates.'},
          journey:{...body.journey,version:'drafting-journey-v2',windows:[
            {...body.journey.windows[0],from:'2026-10-31',to:'2026-11-01',
              from_at:'2026-10-31T23:55:00.000Z',to_at:'2026-11-01T00:05:00.000Z'}],
            milestones:[{id:'first-forty',date:'2026-11-01',text:'First complete window',count:40,
              from_at:'2026-10-31T23:55:00.000Z',to_at:'2026-11-01T00:05:00.000Z'}]},
          highlights:{...body.highlights,schema_version:'decision-highlights-v2',
            page:Number(url.searchParams.get('page')||'1'),
            has_more:{best:url.searchParams.get('page')!=='2',misses:false},
            best:url.searchParams.get('page')==='2'?
              [{...body.highlights.best[0],puzzle_id:'fixture-pack-3',preview:{
                selected:{id:'card-mine',name:'Second Page Card',image_url:'https://not-scryfall.invalid/x.jpg'},
                trophy:{id:'card-trophy',name:'Source Card',image_url:null}}}]:
              [{...body.highlights.best[0],preview:{
                selected:{id:'card-mine',name:'First Page Card',image_url:'javascript:alert(1)'},
                trophy:{id:'card-trophy',name:'Scryfall Art',image_url:'https://cards.scryfall.io/normal/front/x.jpg'}}}],
          },
        };
      }
      if(insightsMode==='third-card'){
        // Use the real backend reason builder, not a fabricated reason object.
        const saved=(id,leader)=>({
          session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          round:3,puzzle_id:id,set_id:'neo',environment:'mixed',
          pick_number:5,answered_at:'2026-09-16T12:00:00.000Z',
          score:32,trophy_match:false,selected_id:'card-mine',
          historical_id:'card-trophy',selected_name:'Daring Skyjek',
          historical_name:'Frost Lynx',difficulty_band:'medium',
          choice_ranking:[
            {id:'card-mine',name:'Daring Skyjek',support:.1},
            {id:'card-trophy',name:'Frost Lynx',support:leader==='trophy'?.9:.5},
            {id:'card-third',name:'Goblin Electromancer',support:leader==='third'?.9:.5},
          ],
        });
        const misses=selectInsightHighlights([
          saved('fixture-leader-third','third'),saved('fixture-leader-trophy','trophy'),
          saved('fixture-leader-unknown','third'),
        ]).misses.map(item=>({...item,preview:{
          selected:{id:'card-mine',name:'Daring Skyjek',image_url:null},
          trophy:{id:'card-trophy',name:'Frost Lynx',image_url:null},
        }}));
        const incomplete=misses.find(item=>item.puzzle_id==='fixture-leader-unknown');
        incomplete.reason_evidence={leader_id:'card-third',leader_name:'Goblin Electromancer'};
        incomplete.preview.trophy=null;
        body={...body,leading_finding:null,comparison_contract:'compatible-source-groups-v1',
          highlights:{...body.highlights,best:[],misses,has_more:{best:false,misses:false}}};
      }
      if(insightsMode==='sparse-filter'){
        body={...body,eligible_decisions:0,unlocked:false,progress:null,leading_finding:null,
          highlights:{...body.highlights,best:[],misses:[],has_more:{best:false,misses:false}}};
      }
      if(insightsMode==='descriptive') {
        // 237 real-looking eligible decisions with no qualifying 10-point gap.
        // Keep the backend's observations array empty to test the UI fallback.
        body={...body,eligible_decisions:237,total_eligible_decisions:237,observations:[],leading_finding:null,
           difficulty:[{band:'medium',count:237,average_score:76.8,trophy_match_pct:42.2}],
          formats:[
            {environment:'mixed',label:'Mixed',count:237,average_score:76.8,trophy_match_pct:42.2},
            {environment:'latest',label:'Latest Set',count:0,average_score:null,trophy_match_pct:null},
            {environment:'powered-cube',label:'Powered Cube',count:0,average_score:null,trophy_match_pct:null},
          ],
          pick_depth:[{pick_number:4,label:'P1P4',count:31,average_score:74.5,trophy_match_pct:41}],
          progress:{
            recent:{count:40,average_score:77.1,trophy_match_pct:50,from:'2026-09-15',to:'2026-09-25'},
            previous:{count:40,average_score:75.2,trophy_match_pct:47,from:'2026-09-01',to:'2026-09-14'},
            delta:1.9,
          },
        };
      }
      if(insightsMode==='no-examples'||insightsMode==='no-revisit'||insightsMode==='no-best'){
        body={...body,leading_finding:null,observations:[],highlights:{...body.highlights,
          best:insightsMode==='no-examples'||insightsMode==='no-best'?[]:body.highlights.best,
          misses:insightsMode==='no-examples'||insightsMode==='no-revisit'?[]:body.highlights.misses,
          has_more:{best:false,misses:false}}};
      }
      if(insightsMode==='sparse'){
        body={...body,eligible_decisions:9,total_eligible_decisions:9,
          leading_finding:null,observations:[],progress:null,
          drafting_dna:{...body.drafting_dna,eligible_decisions:9,primary:null,secondary:[],note:'No qualified traits.'},
          card_choices:{...body.card_choices,choices:[]},
          highlights:{...body.highlights,best:[],misses:[],has_more:{best:false,misses:false}}};
      }
      if(insightsMode==='versions'){
        body={...body,progress:null,leading_finding:null,observations:[],
          journey:{...body.journey,progress_compatible:false,
            windows:[{...body.journey.windows[0],cohort:'old-version'},
              {...body.journey.windows[1],cohort:'new-version'}]}};
      }
    }
  } else if (url.pathname === '/v1/profile/insights/decision') {
    assert.equal(route.request().headers()['x-pack1-auth-session'],'profile-auth-fixture');
    const key=decisionKey(url.searchParams.get('session_id'),url.searchParams.get('round'),
      url.searchParams.get('puzzle_id'));
    assert.ok(savedDecisions.has(key),'Review must request the exact saved session/round/puzzle tuple');
    body=savedDecisions.get(key);
  } else if (url.pathname === '/v1/profile/me') {
    body = fixture;
  } else if (url.pathname === `/v1/profile/${profileKey}`) {
    body = { ...fixture, player:{ ...fixture.player, claimed:undefined } };
  } else if (url.pathname === '/v1/profile/history' || url.pathname === `/v1/profile/${profileKey}/history`) {
    body = { rows:[{ cursor:'150', played_at:'2026-08-30T12:00:00Z', set_id:'woe', mode:'top3', score:88, grade:'A-', is_daily:false, outcome:null }], next_cursor:null };
  } else if (url.pathname === '/v1/profile' && route.request().method() === 'PATCH') {
    assert.equal(route.request().headers()['x-pack1-auth-session'],'profile-auth-fixture');
    updatePayload = route.request().postDataJSON();
    if(updateMode === 'network') {
      status = 503;
      body = { error:'Profile save fixture unavailable.' };
    } else if(updateMode === 'taken') {
      status = 409;
      body = { error:'That display name is already taken.', code:'USERNAME_TAKEN' };
    } else if(updateMode === 'not_allowed') {
      status = 400;
      body = { error:'That display name is not allowed.', code:'USERNAME_NOT_ALLOWED' };
    } else {
      const placeholder = updateMode === 'placeholder';
      body = {
        ...fixture,
        player:{
          ...fixture.player,
          display_name:updatePayload.displayName || fixture.player.display_name,
          profile_public:Boolean(updatePayload.profilePublic),
          favorite_set_id:updatePayload.favoriteSetId || null,
          showcase_achievement:updatePayload.showcaseAchievement || null,
          username_owned:!placeholder,
          display_name_reason:placeholder ? 'username_required' : null,
        },
      };
    }
  } else if (url.pathname === '/v1/profile-lookup') {
    body = { profiles:{ 'profile tester':{ display_name:'Profile Tester', profile_key:profileKey } } };
  } else if (url.pathname === '/v1/stats') {
    body = { summary:fixture.summary, bySet:fixture.by_set, byMode:fixture.by_mode, recent:fixture.recent };
  } else if (url.pathname === '/v1/account/daily-dates') {
    body = { dates:['2026-09-09','2026-09-08'] };
  } else if (url.pathname === '/v1/events') {
    body = { ok:true, accepted:1 };
  }
  if(url.pathname==='/v1/profile/insights'&&body.highlights){
    // Each served summary has its own saved detail; mismatched tuple parts fail.
    for(const row of [...body.highlights.best,...body.highlights.misses]){
      const selected=row.preview?.selected,trophy=row.preview?.trophy;
      savedDecisions.set(decisionKey(row.session_id,row.round,row.puzzle_id),{
        set_id:row.set_id,pick_number:row.pick_number,score:row.score,trophy_match:row.trophy_match,
        selected,trophy,candidates:[selected,trophy,
          {id:'card-third',name:'Goblin Electromancer',image_url:null}].filter(Boolean),
        prior_picks:[{id:'previous-card',name:'Counterspell',image_url:null}],
        trophy_drafter:{record:'7–1',win_rate:63},answered_at:row.date,
        scoring_version:'v1',corpus_version:'c1',
      });
    }
  }
  if(url.pathname==='/v1/profile/insights'&&insightsMode==='v2-delayed'&&
      url.searchParams.get('page')==='2'){
    await new Promise(resolve=>{releaseDelayedPageTwo=resolve;});
  }
  await route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
});

async function noOverflow() {
  const metrics = await page.evaluate(() => ({ client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth }));
  assert.ok(metrics.scroll <= metrics.client + 1, `profile horizontal overflow: ${metrics.scroll} > ${metrics.client}`);
}

try {
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.locator('#account-nav').waitFor({ timeout:10000 });
  assert.equal(await page.locator('#profile-nav').count(), 0, 'Profile and Account share one navigation destination');
  await page.waitForFunction(()=>document.querySelector('#account-nav')?.textContent?.trim()==='My Pack One');
  await page.locator('#account-nav').click();
  await page.locator('.my-pack-one-page').waitFor({ timeout:10000 });
  assert.equal((await page.locator('.my-pack-one-heading h1').textContent())?.trim(), 'My Pack One');
  assert.equal((await page.locator('.my-career-metrics > div:last-child strong').textContent())?.trim(), '3/3',
    'the career snapshot counts the Live catalog, not the 30-set archive');
  assert.equal((await page.locator('.my-career-metrics > div:last-child span').textContent())?.trim(), 'Environments');
  assert.match(await page.locator('.my-archive-summary').textContent(), /3\/3\s*environments played/);
  assert.equal(await page.locator('[data-environment-id="pio"]').count(), 0,
    'Candidate environments must not be visible to players');
  assert.equal(await page.locator('[data-environment-id="vow"]').count(), 0,
    'archived but inactive environments must not be visible');
  assert.equal(await page.locator('.my-archive-note').count(), 0,
    'do not display inactive-set explanations to players');
  assert.equal((await page.locator('.my-profile-card h2').textContent())?.trim(), 'Profile Tester');
  assert.equal(await page.locator('.my-profile-card h2 [data-achievement-mark="explorer5"]').count(),1,'showcased badge sits beside the player name');
  assert.equal(await page.locator('#profile-stats-tab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#profile-account-panel').isHidden(),true);

  assert.equal(await page.locator('[role="tab"][id^="profile-"]').count(),3,'My Pack One has three local sections');
  await page.locator('#profile-insights-tab').click();
  assert.equal(await page.locator('#profile-insights-tab').getAttribute('aria-selected'),'true');
  await page.locator('#my-insights-result').getByText('Picks to review',{exact:true}).waitFor();
  assert.equal(await page.locator('.my-insights-heading h2').textContent(),'Your picks');
  assert.equal(await page.locator('#my-insights-environment').evaluate(el=>el.previousSibling?.textContent),'Format');
  const order=await page.locator('#my-insights-result .my-insights-grid > *').evaluateAll(nodes=>
    nodes.map(node=>node.querySelector('h2')?.textContent||node.querySelector('summary')?.textContent));
  assert.deepEqual(order,['Picks to review','Your scores over time','Your pick patterns','More stats']);
  assert.match(await page.locator('.my-insights-dna').textContent(),/Across formats · All available history/);
  assert.match(await page.locator('.my-insights-dna').textContent(),/The Independent Thinker/);
  assert.equal(await page.locator('.my-insights-qualified-trait').count(),2,
    'only qualified traits appear, with no empty secondary positions');
  assert.equal(await page.locator('.my-insights-explore').evaluate(node=>node.open),false);
  assert.equal(await page.locator('.my-insights-choice-disclosure').evaluate(node=>node.open),false);

  const revisit=page.getByRole('tab',{name:'Picks to revisit'});
  const high=page.getByRole('tab',{name:'High-scoring picks'});
  assert.equal(await revisit.getAttribute('aria-selected'),'true','revisit is default when available');
  assert.equal(await page.locator('#my-insights-misses-panel .my-insights-pick:visible').count(),1);
  assert.match(await page.locator('#my-insights-misses-panel').textContent(),/Khans of Tarkir/);
  assert.match(await page.locator('#my-insights-misses-panel').textContent(),/Source P1P5/);
  assert.doesNotMatch(await page.locator('.my-insights-leading').count().then(String),/^[1-9]/,
    'an old difficulty comparison cannot be promoted to a headline');
  // Default screenshot shows the actual first-open state for a player with revisit picks.
  await page.screenshot({path:'artifacts/ui-profile-insights-revisit-default-390.png',fullPage:true});
  await high.click();
  assert.equal(await page.locator('#my-insights-best-panel .my-insights-pick:visible').count(),3);
  assert.equal(await page.locator('#my-insights-best-panel .my-insights-pick.is-featured:visible').count(),1);
  assert.equal(await page.locator('#my-insights-best-panel .my-insights-pick.is-compact:visible').count(),2);
  const featuredArt=page.locator('#my-insights-best-panel .my-insights-pick.is-featured img');
  assert.equal(await featuredArt.count(),2,'synthetic card art is shown for both cards');
  await featuredArt.first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const images=[...document.querySelectorAll('#my-insights-best-panel .my-insights-pick.is-featured img')];
    return images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0);
  },null,{timeout:10000});
  const featuredText=await page.locator('#my-insights-best-panel .my-insights-pick.is-featured').textContent();
  assert.match(featuredText,/Kamigawa: Neon Dynasty/);
  assert.match(featuredText,/Source P1P3/);
  assert.match(featuredText,/Score 92\/100/);
  assert.doesNotMatch(featuredText,/hard-rated decisions/,'unqualified old comparison tags are hidden');
  assert.match(await page.locator('#my-insights-best-panel .my-insights-pick.is-compact').nth(0).textContent(),/Skyguard Captain/);
  assert.match(await page.locator('#my-insights-best-panel .my-insights-pick.is-compact').nth(1).textContent(),/Luminous Oath/);

  // Optional card-choice denominator and real examples stay behind disclosures.
  await page.locator('.my-insights-choice-disclosure > summary').click();
  assert.match(await page.locator('.my-insights-choice-disclosure').textContent(),/19 of 26 qualifying picks/);
  assert.match(await page.locator('.my-insights-choice-disclosure').textContent(),/8 of 26 qualifying picks/);
  await page.locator('.my-insights-choice-fact').first().getByText('Examples and counts').click();
  await page.getByRole('button',{name:/Daring Skyjek · Kamigawa: Neon Dynasty P1P3/}).click();
  await page.locator('#my-insights-decision-dialog[open] .my-insights-locked-pack').waitFor();
  await page.locator('#my-insights-decision-dialog').getByRole('button',{name:'Close'}).click();
  await page.screenshot({path:'artifacts/ui-profile-insights-evidence-expanded-390.png',fullPage:true});
  await page.locator('.my-insights-choice-disclosure > summary').click();
  await page.screenshot({path:'artifacts/ui-profile-insights-populated-390.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await noOverflow();
  await page.screenshot({path:'artifacts/ui-profile-insights-populated-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});

  // Different cards/scores must open their own saved decisions, including a miss.
  for(const [tab,panel,index] of [[high,'best',0],[high,'best',1],[revisit,'misses',0]]){
    await tab.click();
    const card=page.locator('#my-insights-'+panel+'-panel .my-insights-pick').nth(index);
    const names=await card.locator('.my-insights-pick-names strong').allTextContents();
    const summary=await card.textContent();
    const scoreText=summary.match(/Score \d+\/100/)[0];
    const position=summary.match(/Source P1P\d+/)[0];
    await card.getByRole('button',{name:'Review pick'}).click();
    const detail=page.locator('#my-insights-decision-dialog[open] .my-insights-locked-pack');
    await detail.waitFor();
    assert.deepEqual(await detail.locator('.my-insights-locked-choices figcaption').allTextContents(),names,
      'the opened selected and trophy cards match the clicked summary');
    const metadata=await detail.locator(':scope > .my-insights-note').first().textContent();
    assert.ok(metadata.includes(scoreText),'the opened original score matches the clicked summary');
    assert.ok(metadata.includes(position),'the opened source position matches the clicked summary');
    await detail.getByRole('button',{name:'Close',exact:true}).click();
  }
  await high.click();
  const scoringHelp=page.locator('.my-insights-how');
  assert.equal(await scoringHelp.locator('summary').textContent(),'How scores work');
  assert.equal(await scoringHelp.getAttribute('open'),null);
  await scoringHelp.locator('summary').click();
  assert.equal(await scoringHelp.getByText(/Matching the trophy pick earns 100 points/).isVisible(),true);
  await scoringHelp.locator('summary').click();

  const reviewButton=page.getByRole('button',{name:'Review pick'}).first();
  await reviewButton.click();
  await page.locator('#my-insights-decision-dialog[open] .my-insights-locked-pack').getByText('Frost Lynx').first().waitFor();
  const savedPackText=await page.locator('#my-insights-decision-dialog').textContent();
  assert.match(savedPackText,/Full pack.*Goblin Electromancer/s);
  assert.match(savedPackText,/Trophy drafter’s earlier picks.*Counterspell/s);
  assert.match(savedPackText,/7–1/);
  assert.match(savedPackText,/Read-only review/);
  await page.locator('#my-insights-decision-dialog').getByRole('button',{name:'Close'}).click();
  assert.equal(await page.locator('#my-insights-decision-dialog').isHidden(),true);
  assert.equal(await reviewButton.evaluate(node=>document.activeElement===node),true,
    'closing review returns keyboard focus to the same Review pick button');
  await high.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await revisit.getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');
  assert.equal(await high.getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');
  assert.equal(await revisit.getAttribute('aria-selected'),'true');
  await high.click();
  assert.match(await page.locator('.my-insights-journey-point').first().textContent(),/Sep 1–Sep 14/);
  await page.locator('.my-insights-journey-details > summary').click();
  assert.match(await page.locator('.my-insights-journey-details').textContent(),/2026-09-01 to 2026-09-14/);

  // Old response, missing/unsafe art, paginated cards, no qualified DNA.
  insightsMode='v2';
  await page.locator('#my-insights-refresh').click();
  await page.locator('.my-insights-dna').getByText('No clear pick pattern to show yet.').waitFor();
  await high.click();
  await page.locator('#my-insights-best-panel').getByText(/First Page Card/).first().waitFor();
  assert.match(await page.locator('.my-insights-journey-point').first().textContent(),/Oct 31/,
    'local dates collapse UTC midnight to the correct local day');
  assert.equal(await page.locator('#my-insights-best-panel img[src*="not-scryfall.invalid"]').count(),0);
  assert.equal(await page.locator('#my-insights-best-panel img[src*="javascript"]').count(),0);
  assert.equal(await page.locator('#my-insights-best-panel img[src*="cards.scryfall.io"]').count(),1);
  await page.getByRole('button',{name:'See more picks'}).click();
  await page.locator('#my-insights-best-panel').getByText(/Second Page Card/).first().waitFor();
  assert.equal(await page.locator('#my-insights-best-panel .my-insights-pick').count(),2);
  assert.equal(await page.getByRole('button',{name:'See more picks'}).count(),0);


  // Actual new-backend reason evidence must render, including a third leader.
  insightsMode='third-card';
  await page.locator('#my-insights-refresh').click();
  const reasonFor=id=>page.locator('#my-insights-misses-panel .my-insights-pick:has(button[data-puzzle="'+id+'"]) .my-insights-reason');
  await reasonFor('fixture-leader-third').waitFor();
  assert.match(await reasonFor('fixture-leader-third').textContent(),
    /saved model favored Goblin Electromancer.*different card from the trophy pick/i);
  assert.match(await reasonFor('fixture-leader-trophy').textContent(),
    /saved model supported the trophy pick more strongly/i);
  assert.match(await reasonFor('fixture-leader-unknown').textContent(),
    /saved model favored Goblin Electromancer more strongly than your choice/i);
  assert.equal(await page.getByText('Insights unavailable',{exact:true}).count(),0);

  // Switching tabs or using the review dialog must not strand page-two loading.
  insightsMode='v2-delayed';
  await page.locator('#my-insights-refresh').click();
  await high.click();
  await page.locator('#my-insights-best-panel').getByText(/First Page Card/).first().waitFor();
  await page.locator('#my-insights-best-panel [data-insights-more]').click();
  const pending=page.locator('#my-insights-best-panel [data-insights-more]');
  assert.equal(await pending.isDisabled(),true);
  await revisit.click();
  await page.locator('#my-insights-misses-panel [data-insights-review]').first().click();
  await page.locator('#my-insights-decision-dialog[open] .my-insights-locked-pack').waitFor();
  await page.locator('#my-insights-decision-dialog').getByRole('button',{name:'Close'}).click();
  await high.click();
  for(let tries=0;!releaseDelayedPageTwo&&tries<100;tries++)
    await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(typeof releaseDelayedPageTwo,'function','the page-two fetch was delayed');
  releaseDelayedPageTwo();releaseDelayedPageTwo=null;
  await page.locator('#my-insights-best-panel').getByText(/Second Page Card/).first().waitFor();
  assert.equal(await pending.count(),0,'completed pagination must not remain disabled');

  insightsMode='ready';
  await page.locator('#my-insights-refresh').click();
  await page.locator('.my-insights-dna').getByText('The Independent Thinker').waitFor();
  await page.locator('.my-insights-explore > summary').click();
  assert.equal(await page.locator('.my-insights-bar').count(),3);
  await page.locator('#my-insights-environment').selectOption('powered-cube');
  await page.locator('.my-insights-sample').getByText(/Powered Cube/).waitFor();
  await page.locator('.my-insights-explore > summary').click();
  await page.locator('#my-insights-result').getByText('P1P2').waitFor();
  await page.locator('#my-insights-period').selectOption('90d');
  await page.locator('.my-insights-sample').getByText(/Last 90 days/).waitFor();
  assert.match(await page.locator('.my-insights-dna').textContent(),/Across formats · All available history/,
    'all-history DNA scope does not change under review filters');
  await high.click();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:844});
    await noOverflow();
    assert.equal(await page.locator('#my-insights-best-panel .my-insights-pick:visible').count(),3,
      'all layouts show a featured comparison and two supporting cards');
  }
  await page.setViewportSize({width:320,height:844});
  await page.screenshot({path:'artifacts/ui-profile-insights-320.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/ui-profile-insights-390.png',fullPage:true});

  insightsMode='descriptive';
  await page.locator('#my-insights-environment').selectOption('mixed');
  await page.locator('#my-insights-period').selectOption('all');
  await page.locator('#my-insights-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.my-insights-sample')?.textContent?.includes('237 picks included'));
  const reported=await page.locator('#my-insights-result').textContent();
  assert.doesNotMatch(reported,/No standout comparison has qualified|Leading finding/);
  assert.match(reported,/237 picks included/);
  assert.match(reported,/Your last 40 picks averaged 77\.1\/100, up 1\.9 points from the previous 40/);
  await page.locator('.my-insights-explore > summary').click();
  const supporting=await page.locator('.my-insights-explore-content').textContent();
  assert.match(supporting,/P1P4/);
  assert.match(supporting,/74\.5/);
  assert.match(supporting,/76\.8/);
  await page.screenshot({path:'artifacts/ui-profile-insights-237.png',fullPage:true});

  insightsMode='no-revisit';
  await page.locator('#my-insights-refresh').click();
  assert.equal(await high.getAttribute('aria-selected'),'true','only high-scoring picks are available');
  insightsMode='no-best';
  await page.locator('#my-insights-refresh').click();
  assert.equal(await revisit.getAttribute('aria-selected'),'true','only revisit picks are available');
  insightsMode='no-examples';
  await page.locator('#my-insights-refresh').click();
  assert.match(await page.locator('#my-insights-best-panel').textContent(),/No high-scoring picks/);
  await revisit.click();
  assert.match(await page.locator('#my-insights-misses-panel').textContent(),/No picks to revisit/);
  insightsMode='sparse';
  await page.locator('#my-insights-refresh').click();
  await page.locator('.my-insights-sample').getByText(/9 picks included/).waitFor();
  assert.match(await page.locator('.my-insights-dna').textContent(),/No clear pick pattern/);
  assert.equal(await page.locator('.my-insights-qualified-trait').count(),0);
  insightsMode='sparse-filter';
  await page.locator('#my-insights-refresh').click();
  await page.locator('#my-insights-result').getByText(/0 of 8 picks included/).waitFor();
  assert.match(await page.locator('.my-insights-dna').textContent(),/The Independent Thinker/,
    'qualified all-history traits remain visible when a filtered view is locked');
  assert.equal(await page.locator('.my-insights-journey').count(),0,
    'selected-filter score sections remain locked');

  insightsMode='versions';
  await page.locator('#my-insights-refresh').click();
  assert.match(await page.locator('.my-insights-journey-warning').textContent(),/cannot be read as one continuous trend/);
  assert.equal(await page.locator('.my-insights-journey-break').count(),1);

  insightsMode='offline';
  await page.locator('#my-insights-refresh').click();
  await page.getByText('Insights unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('.my-insights-dna').count(),0,
    'failed refresh cannot expose an earlier account’s private patterns');
  insightsMode='ready';
  await page.locator('#my-insights-retry').click();
  await page.locator('#my-insights-result').getByText('Picks to review',{exact:true}).waitFor();
  await page.locator('#profile-insights-tab').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#profile-account-tab').getAttribute('aria-selected'),'true','right arrow moves focus/selection');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#profile-stats-tab').getAttribute('aria-selected'),'true','Home returns to Stats');
  await page.locator('#profile-stats-tab').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#profile-account-tab').getAttribute('aria-selected'),'true','left arrow wraps');
  await page.locator('#profile-stats-tab').click();
  assert.equal(await page.locator('#profile-insights-panel').isHidden(),true);


  const liveIds = ['neo','ktk','powered-cube'];
  const activePlayed = fixture.by_set.filter(row => liveIds.includes(row.set_id)).length;
  assert.equal(await page.locator('.my-archive-item').count(), liveIds.length, 'Only Live sets appear in the player archive');
  assert.match((await page.locator('.my-archive-summary').textContent()) || '',
    new RegExp(`${activePlayed}/${liveIds.length}\\s*environments played`));
  assert.equal(await page.locator('#profile-settings-form select[name="favoriteSetId"] option').count(),
    liveIds.length + 1, 'favorite choices must be Live-only');
  assert.equal(await page.locator('[data-environment-id="powered-cube"].is-played').count(), 1, 'Powered Cube must be part of archive progression');
  assert.match((await page.locator('.my-daily-preview li').first().textContent()) || '', /Top 7%/i);
  assert.match((await page.locator('.my-daily-preview li').first().textContent()) || '', /NEO/i);
  assert.match((await page.locator('.profile-current-season').textContent()) || '', /The Hobbit Season.*Current/i);
  assert.match((await page.locator('.profile-current-season').textContent()) || '', /Draft Run.*#312.*88\.4.*17 days/i);
  assert.equal(await page.locator('#profile-edit').count(),0,'Stats sidebar does not duplicate the Account-tab edit action');
  assert.equal(await page.locator('.my-achievement-badge').count(), fixture.achievements.length);
  assert.equal(await page.locator('.my-achievement-badge.is-locked').count(), 1);
  assert.equal(await page.locator('[data-profile-section="archive"]').getAttribute('open'), null, 'large archive starts collapsed');
  await page.locator('[data-profile-section="archive"] summary').click();
  assert.ok(await page.locator('[data-environment-id="neo"]').isVisible(), 'archive entries link to set coverage');
  await page.locator('[data-profile-section="archive"] summary').click();
  await page.locator('[data-profile-section="achievements"] summary').click();
  assert.equal(await page.locator('.my-achievement-row.is-unlocked').first().isVisible(), true);
  assert.equal(await page.locator('#profile-settings-form').count(), 1);
  const achievementTargets=await page.locator('.my-achievement-actions .text-button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  assert.ok(achievementTargets.length>0&&achievementTargets.every(height=>height>=43.5),'achievement actions meet the 44px control target');
  await noOverflow();
  await page.screenshot({ path:'artifacts/ui-profile-mobile.png', fullPage:true });

  await page.locator('#profile-account-tab').click();
  assert.equal(await page.locator('#profile-account-tab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#profile-account-title').textContent(),'Signed in');
  assert.ok(await page.locator('#profile-account input[name="displayName"]').isVisible(),'Account settings are in the Account tab');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});await noOverflow();await page.locator('#profile-account-panel').screenshot({path:`artifacts/ui-profile-settings-${width}.png`});}
  await page.setViewportSize({width:390,height:844});

  await page.locator('#profile-stats-tab').click();
  await page.locator('#profile-load-more').evaluate(button=>{button.closest('details').open=true;});
  const historyBefore=await page.locator('#profile-history-list > li').count();
  await page.locator('#profile-load-more').click();
  await page.locator('#profile-load-more').waitFor({ state:'hidden', timeout:5000 });
  assert.equal(await page.locator('#profile-history-list > li').count(),historyBefore+1,'load more appends the next history row');
  assert.match((await page.locator('#profile-history-list > li').last().textContent())||'',/88/,'loaded history preserves the returned score');

  await page.locator('#profile-account-tab').click();
  assert.equal(await page.locator('#profile-manage-account,#profile-share-progress').count(),0);
  assert.equal(await page.locator('input[name="displayName"]').inputValue(), 'Profile Tester');
  // Saving carries a short directly linked Public Identity notice, never a required checkbox.
  assert.match((await page.locator('.profile-identity-rules').textContent())||'',/Display names and public profiles follow the Pack One Public Identity rules/);
  assert.equal(await page.locator('.profile-identity-rules a[href="/terms/#public-identity-rules"]').count(),1);
  assert.equal(await page.locator('input[name="acceptPublicIdentityTerms"]').count(),0);
  assert.equal((await page.locator('.profile-toggle strong').textContent())?.trim(),'Public profile');
  assert.equal((await page.locator('.profile-toggle small').textContent())?.trim(),'Let players view your Pack One record from leaderboards and shared links.');
  const toggleBox=await page.locator('.profile-toggle').boundingBox();
  assert.ok(toggleBox&&toggleBox.height>=43.5,'public profile row is a full touch target');
  const saveProfile=page.locator('#profile-settings-form button[type="submit"]');
  assert.equal(await saveProfile.count(),1,'Save profile is available with the profile fields');
  assert.equal(await page.locator('.profile-settings-heading-row').getByRole('link',{name:'Change name'}).count(),0,'Account settings do not duplicate the display-name action');

  updateMode='success';
  await page.locator('input[name="displayName"]').fill('Leaderboard Ace');
  await page.locator('select[name="favoriteSetId"]').selectOption('ktk');
  await page.locator('select[name="showcaseAchievement"]').selectOption('top10');
  await saveProfile.click();
  await page.getByText('Profile saved.',{exact:true}).waitFor();
  assert.deepEqual(updatePayload, { displayName:'Leaderboard Ace', profilePublic:true, favoriteSetId:'ktk', showcaseAchievement:'top10', acceptPublicIdentityTerms:true });
  await page.waitForFunction(() => localStorage.getItem('pack1-player-name-v1') === 'Leaderboard Ace');

  updateMode='taken';
  await page.locator('input[name="displayName"]').fill('Taken Name');
  await saveProfile.click();
  await page.getByText('That display name is already taken.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="displayName"]').inputValue(),'Taken Name');
  assert.match((await page.locator('#profile-save-status').textContent())||'',/Profile not saved/);

  updateMode='not_allowed';
  await page.locator('input[name="displayName"]').fill('Pack One Support');
  await saveProfile.click();
  await page.getByText('That display name is not allowed.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[name="displayName"]').inputValue(),'Pack One Support');
  assert.match((await page.locator('#profile-save-status').textContent())||'',/Profile not saved/);

  updateMode='network';
  await page.locator('input[name="displayName"]').fill('Unsaved Edit');
  await page.locator('select[name="favoriteSetId"]').selectOption('neo');
  await saveProfile.click();
  await page.getByText(/Your edits are still here\./).waitFor();
  assert.equal(await page.locator('input[name="displayName"]').inputValue(),'Unsaved Edit');
  assert.equal(await page.locator('select[name="favoriteSetId"]').inputValue(),'neo');

  updateMode='placeholder';
  await page.locator('input[name="displayName"]').fill('Pack Player');
  await page.locator('input[name="profilePublic"]').uncheck();
  await saveProfile.click();
  await page.getByText('Profile saved.',{exact:true}).waitFor();
  assert.equal(await page.locator('#profile-display-name-error').textContent(),'Choose a display name to join Daily leaderboards.');
  assert.deepEqual(updatePayload, {
    displayName:'Pack Player',
    profilePublic:false,
    favoriteSetId:'neo',
    showcaseAchievement:'top10',
    acceptPublicIdentityTerms:true,
  });

  await page.evaluate(()=>{document.documentElement.style.fontSize='125%';});
  await noOverflow();
  await page.screenshot({path:'artifacts/ui-profile-settings-large-text-390.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.fontSize='';});

  await page.locator('#profile-stats-tab').click();
  assert.equal((await page.locator('.my-profile-card h2').textContent())?.trim(), 'Pack Player');
  assert.equal(await page.locator('.my-profile-card h2 [data-achievement-mark="top10"]').count(),1,'successful placeholder-name save refreshes the authoritative profile while prior failed edits stayed local');
  await page.locator('#profile-share').click();
  await page.waitForFunction(() => (window.__pack1ShareCalls || 0) > 0, null, { timeout:5000 });
  shareCalls = await page.evaluate(() => window.__pack1ShareCalls || 0);
  assert.equal(shareCalls, 1, 'profile sharing invokes native share');

  await page.goto(`${base}/?profile=${profileKey}`, { waitUntil:'domcontentloaded' });
  await page.locator('.player-profile-page').waitFor({ timeout:10000 });
  assert.equal(await page.locator('#profile-settings-form').count(), 0, 'public visitor must not see owner settings');
  assert.equal(await page.locator('#profile-share').isEnabled(), true);
  assert.match((await page.locator('.profile-hero').textContent()) || '', /public Pack One career/i);
  assert.equal(await page.locator('.profile-hero h1 [data-achievement-mark="explorer5"]').count(),1,'public profile shows the showcased badge beside the name');
  assert.match((await page.locator('.profile-current-season').textContent()) || '', /The Hobbit Season.*Current/i);
  assert.match((await page.locator('.profile-current-season').textContent()) || '', /Draft Run.*#312/i);
  await noOverflow();
  await page.screenshot({ path:'artifacts/ui-profile-public-mobile.png', fullPage:true });

  // A saved account-owned record can remain accessible when the session expires
  // or the account service fails. Its settings must report the actual auth state.
  for(const [mode,label] of [['unavailable','Account unavailable'],['signed-out','Signed out']]) {
    accountMode = mode;
    await page.evaluate(async()=>{
      const profiles=await import('/profile-product.mjs?v=9');
      await profiles.renderMyProfile();
    });
    await page.locator('#profile-account-tab').click();
    assert.equal(await page.locator('#profile-account-title').textContent(),label);
    assert.equal(await page.locator('#profile-settings-form').count(),0);
    if(mode === 'unavailable') {
      assert.equal(await page.getByRole('button',{name:'Retry account',exact:true}).isVisible(),true);
    } else {
      assert.equal(await page.locator('#profile-claim-account').isVisible(),true);
    }
  }

  console.log('Player profile / progression browser regression passed.');
} finally {
  await browser.close();
}
