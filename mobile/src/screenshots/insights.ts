// Isolated, source-controlled Insights evidence for native screenshot acceptance.
// Imported only from the preview-only screenshot API; no player data or live reads.
import type {
  DraftInsights, InsightCard, InsightDecision, InsightHighlight,
  InsightsEnvironment, InsightsPeriod,
} from '@/src/api/insights';

const sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cards:InsightCard[]=[
  {id:'hero',name:'Hero in Training',rarity:'rare',type_line:'Creature — Human Soldier',image_url:
    'https://cards.scryfall.io/normal/front/1/0/105a937b-289c-47b5-96a4-654c697bbb7d.jpg?1783902973'},
  {id:'web',name:'Web Up',rarity:'uncommon',type_line:'Instant',image_url:
    'https://cards.scryfall.io/normal/front/9/a/9a1b057b-229c-4f65-ba4e-12dd342238de.jpg?1783902964'},
  {id:'vision',name:'The Vision',rarity:'rare',type_line:'Creature',image_url:null},
  {id:'cube',name:'Cosmic Cube',rarity:'mythic',type_line:'Artifact',image_url:null},
  {id:'thor',name:'The Mighty Thor, Jane Foster',rarity:'rare',type_line:'Creature',image_url:null},
];
const first=cards[0]!,second=cards[1]!,third=cards[2]!,fourth=cards[3]!,fifth=cards[4]!;
const prior:InsightCard[]=[
  {id:'prior-one',name:'Rimekin Recluse',image_url:null},
  {id:'prior-two',name:'Moon-Vigil Adherents',image_url:null},
];
function highlight(round:number,selected:InsightCard,trophy:InsightCard,score:number,
  reasonCode:string,reason:string,group:string):InsightHighlight {
  return {
    session_id:sessionId,round,puzzle_id:'screenshot-insight-'+round,set_id:'msh',
    environment:'mixed',pick_number:round+2,date:'2026-09-'+String(24-round).padStart(2,'0'),
    score,trophy_match:selected.id===trophy.id,
    selection_kind:selected.id===trophy.id?'trophy-match':'alternative',
    selected_name:selected.name,historical_name:trophy.name,
    reason_version:'highlight-reasons-v1',reason_code:reasonCode,reason_text:reason,
    reason_evidence:{original_score:score},
    finding_context:'From '+group+' in this comparison',
    preview:{selected,trophy},
  };
}
const best:InsightHighlight[]=[
  highlight(1,first,second,92,'strong-scored-alternative',
    'Your non-trophy choice earned 92/100 from the original scoring model.','hard-rated decisions'),
  highlight(2,second,second,100,'hard-trophy-match',
    'You matched the trophy selection on a historically hard-rated puzzle.','hard-rated decisions'),
  highlight(3,third,fourth,88,'strong-scored-alternative',
    'Your saved alternative earned 88/100 from the original scoring model.','easy-rated decisions'),
  highlight(4,fifth,second,90,'strong-scored-alternative',
    'The original model awarded this non-trophy pick 90/100.','hard-rated decisions'),
];
const misses:InsightHighlight[]=[
  highlight(5,fourth,first,32,'low-scored-alternative',
    'Your original non-trophy choice earned 32/100 in this saved puzzle.','easy-rated decisions'),
  highlight(6,third,second,38,'low-scored-alternative',
    'Your original non-trophy choice earned 38/100 in this saved puzzle.','hard-rated decisions'),
];
const months=[
  {month:'2026-08',count:40,average_score:74,trophy_match_pct:31},
  {month:'2026-09',count:40,average_score:85,trophy_match_pct:46},
];
function base():DraftInsights {
  return {
    environment:'mixed',period:'all',environment_label:'Mixed',eligible_decisions:80,
    total_eligible_decisions:160,unlocked:true,unlock_at:8,unknown_difficulty:0,
    pick_depth:[{pick_number:3,label:'P1P3',count:40,average_score:86,trophy_match_pct:36},
      {pick_number:8,label:'P1P8',count:40,average_score:74,trophy_match_pct:30}],
    difficulty:[{band:'hard',count:40,average_score:86,trophy_match_pct:48},
      {band:'easy',count:40,average_score:74,trophy_match_pct:27}],
    months,formats:[
      {environment:'mixed',label:'Mixed',count:80,average_score:80,trophy_match_pct:40},
      {environment:'latest',label:'Latest Set',count:42,average_score:82,trophy_match_pct:42},
      {environment:'powered-cube',label:'Powered Cube',count:38,average_score:78,trophy_match_pct:36},
    ],
    progress:{recent:{from:'2026-09-01',to:'2026-09-24',count:40,average_score:85,trophy_match_pct:45},
      previous:{from:'2026-08-01',to:'2026-08-25',count:40,average_score:74,trophy_match_pct:35},
      delta:11},
    observations:[{id:'difficulty',text:'Hard-rated decisions averaged 12.0 points higher than easy-rated decisions (40 vs 40 decisions).'}],
    leading_finding:{id:'difficulty',
      text:'Hard-rated decisions averaged 12.0 points higher than easy-rated decisions (40 vs 40 decisions).',
      compared_groups:[{label:'hard-rated decisions',relation:'higher'},
        {label:'easy-rated decisions',relation:'lower'}]},
    versions:{scoring:['synthetic-scoring-v1'],selection:['eight-pick-v4'],corpus:['synthetic-corpus']},
    range:{from:'2026-08-01',to:'2026-09-24'},session_limit:1000,
    methodology:'Synthetic original first-encounter picks. Historical scores are descriptive only.',
    default_environment:'mixed',
    drafting_dna:{
      schema_version:'drafting-dna-v2',status:'ready',scope:'all-eligible-history',
      eligible_decisions:160,primary:{status:'qualified',id:'independent-thinker',
        title:'The Independent Thinker',summary:'Several alternative picks earned strong original scores.',
        evidence_family:'alternatives',supporting_decisions:160,
        evidence:[{label:'Strong alternative picks',value:48}]},
      secondary:[{status:'qualified',id:'steady-hand',title:'The Steady Hand',
        summary:'Few recorded picks fell in the low-score band.',evidence_family:'score-distribution',
        supporting_decisions:160,evidence:[{label:'Scores of 40 or lower',value:8}]},
        {status:'emerging',label:'Trait still developing'}],
      note:'Synthetic example; patterns are not a validated skill measurement.',
    },
    card_choices:{schema_version:'choice-context-v1',scope:'all-eligible-history',
      minimum_opportunities:20,
      choices:[
        {id:'card-type',title:'Creature or noncreature',status:'ready',opportunities:26,
          selected:{creature:19,noncreature:7},availability:{creature:33,noncreature:35},
          cohort:'synthetic-v1',summary:'When both types were competitive, you chose a creature in 19 of 26 decisions.',
          examples:[{session_id:sessionId,round:1,puzzle_id:'screenshot-insight-1',
            set_id:'msh',pick_number:3,date:'2026-09-23',selected_name:first.name}]},
        {id:'rarity',title:'Rare/mythic or common/uncommon',status:'ready',opportunities:26,
          selected:{'rare-mythic':8,'common-uncommon':18},
          availability:{'rare-mythic':28,'common-uncommon':39},
          cohort:'synthetic-v1',summary:'When both rarity groups were competitive, you chose a rare or mythic in 8 of 26 decisions.',
          examples:[]},
      ],
      note:'Synthetic competitive-option data; these are counts, not choice probabilities.',
    },
    highlights:{schema_version:'decision-highlights-v3',page:1,
      best,misses,has_more:{best:false,misses:false},
      note:'Synthetic originally scored saved decisions.'},
    journey:{version:'drafting-journey-v2',eligible_decisions:80,window_size:40,
      windows:[
        {id:'window-0',from:'2026-08-01',to:'2026-08-25',count:40,average_score:74,
          complete:true,cohort:'synthetic-v1'},
        {id:'window-1',from:'2026-09-01',to:'2026-09-24',count:40,average_score:85,
          complete:true,cohort:'synthetic-v1'},
      ],
      total_windows:2,versions_comparable:true,progress_compatible:true,
      milestones:[{id:'first-forty',date:'2026-08-25',text:'First complete 40-pick window',count:40}],
      limited:false,note:'The original scores are not proof of improvement.',
    },
  };
}
export function screenshotInsights(path:string,scenario:string):DraftInsights {
  const params=new URL(path,'https://preview.invalid').searchParams;
  const possibleEnvironment=params.get('environment');
  const environment:InsightsEnvironment=
    possibleEnvironment==='latest'||possibleEnvironment==='powered-cube'?possibleEnvironment:'mixed';
  const possiblePeriod=params.get('period');
  const period:InsightsPeriod=possiblePeriod==='90d'||possiblePeriod==='365d'?possiblePeriod:'all';
  const data=base();
  const count=period==='90d'?40:environment==='latest'?42:environment==='powered-cube'?38:80;
  const result:DraftInsights={...data,environment,period,
    environment_label:environment==='mixed'?'Mixed':environment==='latest'?'Latest Set':'Powered Cube',
    eligible_decisions:count};
  if(scenario==='member-insights-versions'){
    return {...result,progress:null,journey:{...data.journey!,
      windows:data.journey!.windows.map((w,i)=>({...w,cohort:i?'synthetic-v2':'synthetic-v1'})),
      versions_comparable:false,progress_compatible:false,
      note:'Historical source/scoring versions differ; do not compare these windows.'}};
  }
  if(scenario==='member-insights-sparse'){
    return {...result,eligible_decisions:8,total_eligible_decisions:8,
      drafting_dna:{schema_version:'drafting-dna-v2',status:'emerging',
        scope:'all-eligible-history',eligible_decisions:8,primary:null,
        secondary:[{status:'emerging',label:'Trait still developing'},
          {status:'emerging',label:'Trait still developing'}],
        note:'More saved decisions are needed before a stable trait can qualify.'},
      card_choices:{...data.card_choices!,choices:data.card_choices!.choices.map(c=>({
        ...c,status:'developing' as const,opportunities:2,examples:[],summary:undefined,
      }))},
      leading_finding:null,observations:[],progress:null,months:[],
      highlights:{...data.highlights!,best:[],misses:[],has_more:{best:false,misses:false}},
      journey:{...data.journey!,eligible_decisions:8,
        windows:[{id:'window-0',from:'2026-09-21',to:'2026-09-24',count:8,
          average_score:81,complete:false,cohort:'synthetic-v1'}],
        total_windows:1,versions_comparable:false,progress_compatible:true,
        milestones:[],note:'A partial window, not a comparable trend.'}};
  }
  return result;
}
export function screenshotInsightDecision(path:string):InsightDecision {
  const params=new URL(path,'https://preview.invalid').searchParams;
  const round=Number(params.get('round'));
  const item=[...best,...misses].find(p=>p.round===round&&
    p.session_id===params.get('session_id')&&p.puzzle_id===params.get('puzzle_id'));
  if(!item?.preview)throw new Error('Unknown synthetic saved-decision locator.');
  return {
    set_id:item.set_id,pick_number:item.pick_number,score:item.score,
    trophy_match:item.trophy_match,selected:item.preview.selected,trophy:item.preview.trophy,
    candidates:cards,prior_picks:prior,
    ranking:cards.map((card,index)=>({id:card.id,name:card.name,
      score:[92,100,88,64,81][index]??null,support:[0.35,0.46,0.18,0.09,0.21][index]??null})),
    trophy_drafter:{record:'7–1',win_rate:null},scoring_version:'synthetic-scoring-v1',
    corpus_version:'synthetic-corpus',
    answered_at:item.date+'T12:00:00.000Z',
  };
}
