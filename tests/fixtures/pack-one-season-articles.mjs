// Public CI fixtures only: fictional season standings, votes, cards and game
// outcomes. Never use these values in production or as a real historical post.
import {FORMATS} from '../../scripts/pack-one-weekly-data.mjs';
import {seasonCaption,seasonTitle} from '../../weekly-patreon-contract.mjs';
export const seasonStart='2026-12-01',seasonEnd='2026-12-30',milestone='2026-12-31';
export const cards=Array.from({length:13},(_,i)=>({id:'fixture-'+i,name:'Synthetic card '+i,image_url:'https://cards.scryfall.io/normal/front/a/b/fixture-'+i+'.jpg',rarity:i===0?'rare':'common'}));
export const seasonArticle={kind:'season-results',start:seasonStart,end:seasonEnd,seasonName:'Fixture Set',seasonBoards:FORMATS.map(environment=>({environment,rows:[{rank:1,name:'Sample Player A',score:94.5,average_score:98.6,days:30},{rank:1,name:'Sample Player B',score:94.5,average_score:98.6,days:30},{rank:3,name:'Sample Player C',score:93.1,average_score:97.2,days:29},{rank:4,name:'Sample Player D',score:92,average_score:96.1,days:30},{rank:5,name:'Sample Player E',score:90,average_score:94.2,days:28}]})),perfectAwards:FORMATS.map(environment=>({environment,name:'Sample Player A',days:7}))};
const games=['WU','UB','BR','RG','GW','WB','UR','BG','RW','GU'].map((colors,i)=>({colors,games:2000,wins:1200-i*20,pct:60-i}));
const source='https://www.17lands.com/deck_color_data?expansion=FIXTURE&format=PremierDraft&time_period=ALL_TIME&separate_splashes=true';
export const guideArticle={kind:'midseason-guide',start:'2026-12-01',end:'2026-12-15',seasonName:'Fixture Set',decisions:{coverage:{decisions:40,days:15,scheduledDays:15},early:{decisions:20,responses:1600,trophyPct:62,modelPct:57,modelTrophyPct:55},later:{decisions:20,responses:1600,trophyPct:48,modelPct:43,modelTrophyPct:40},examples:[{day:'2026-12-03',pick:2,total:100,trophyVotes:55,modelVotes:30,trophyId:cards[0].id,modelId:cards[1].id,prior:cards.slice(3,4),candidates:cards},{day:'2026-12-10',pick:5,total:100,trophyVotes:35,modelVotes:45,trophyId:cards[2].id,modelId:cards[1].id,prior:cards.slice(5,9),candidates:cards.slice(0,9)}]},outcomes:{period:'ALL_TIME',sourceUrl:source,retrievedOn:'2026-12-15',colorCount:2,rows:games,baseline:{wins:11100,games:20000,pct:55.5}}};
export function fixtureSnapshot(article,seasonId='fixture'){
 const kind=article.kind,key='pack-one-season:'+(kind==='season-results'?'results':'guide')+':'+seasonId;
 return {key,title:seasonTitle(kind,article.seasonName),body:seasonCaption(kind,article.seasonName,article.start,article.end,article.outcomes?.sourceUrl),article,placements:kind==='season-results'?[{authId:'11111111-1111-4111-8111-111111111111',name:'Sample Player A'}]:[],gate:{seasonId,kind,milestone:kind==='season-results'?milestone:'2026-12-16'}};
}
