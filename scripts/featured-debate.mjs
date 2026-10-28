// One featured decision as a public debate: the question first, the answer later.
// Shared by the YouTube Short and the Bluesky discussion. No network or file writes.
import {readFileSync} from 'node:fs';
import {checkedFeatureDay,formatPercent} from './featured-pick.mjs';

const SET_NAMES=JSON.parse(readFileSync(new URL('../data/set-display-names.json',import.meta.url),'utf8')).names;
// Debates publish on Monday, Wednesday and Friday mornings (Pacific), about
// 13 a month at most. Days without a qualifying decision are skipped, never filled.
export const DEBATE_WEEKDAYS=Object.freeze([1,3,5]);
// The largest MTG Bluesky feed picks up any tag beginning with #mtg.
export const DEBATE_TAGS=Object.freeze(['MTG','MTGDraft']);
export const REVEAL_DELAY_HOURS=4;
export const DEBATE_TEMPLATE_VERSION='debate-short-v1';
export const BLUESKY_LIMIT=300;
const SITE='https://packone.pro/';

export function nextDay(day) {
 checkedFeatureDay(day);
 const d=new Date(day+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
}
// The feature describes yesterday's Daily; it is published the following morning.
export function isDebateSourceDay(sourceDay) {
 return DEBATE_WEEKDAYS.includes(new Date(nextDay(sourceDay)+'T12:00:00Z').getUTCDay());
}
// Cold visitors from public channels land on the homepage, not inside a game.
export function debateLink(platform) {
 const source={bluesky:'bluesky',youtube:'youtube'}[platform];
 if(!source)throw Error('Unknown debate platform.');
 const campaign=source==='youtube'?'organic_shorts':'draft_debate';
 return SITE+'?utm_source='+source+'&utm_medium=social&utm_campaign='+campaign;
}
// The YouTube channel profile link is the only clickable link a Short viewer
// sees. It must point here (owner step in YouTube Studio, see the guide).
export const YOUTUBE_PROFILE_LINK='https://packone.pro/go/shorts/';

export function setLabel(f) {
 if(f.environment==='powered-cube'||f.set_id==='powered-cube')return 'Powered Cube';
 return SET_NAMES[f.set_id]||String(f.set_id||'').toUpperCase();
}
export const graphemes=s=>[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(s)].length;
const orList=names=>names.length<2?names.join(''):
 names.slice(0,-1).join(', ')+' or '+names[names.length-1];
const andList=names=>names.length<2?names.join(''):
 names.slice(0,-1).join(', ')+' and '+names[names.length-1];
const ordinalChoice=['most popular','second most popular','third most popular'];

export function assertDebatable(f) {
 if(!f||![2,3].includes(f.tier)||!Array.isArray(f.choices)||f.choices.length!==f.tier||
  !f.choices.some(c=>c.id===f.trophy?.id)||!Number.isInteger(f.pick_number)||
  !Array.isArray(f.prior_picks)||f.prior_picks.length!==f.pick_number-1||
  !Number.isInteger(f.players)||f.players<1)
  throw Error('Invalid debate: the trophy must be one of the displayed choices with full context.');
 return f;
}

// A factual reason the decision is interesting. It never calls a pick correct.
export function debateObservation(f) {
 assertDebatable(f);
 const rank=f.choices.findIndex(c=>c.id===f.trophy.id);
 const last=rank===f.tier-1;
 const where=rank===0?'the most popular choice':
  last?'the least popular of the '+(f.tier===2?'two':'three'):'the '+ordinalChoice[rank]+' choice';
 const gap=Math.round(10*(f.choices[0].pct-f.choices[1].pct))/10;
 const close=gap<=5?' Only '+formatPercent(gap)+' points separated the top two.':'';
 return {rank,sentence:'The trophy drafter took '+f.trophy.name+', '+where+'.'+close};
}

export function debateCopies(f) {
 assertDebatable(f);
 const set=setLabel(f),names=f.choices.map(c=>c.name);
 const prior=f.prior_picks.map(c=>c.name);
 const where='Pick '+f.pick_number+' of a real '+set+' trophy draft.';
 const split=f.players+' Pack One players split '+f.tier+' ways on it.';
 const tags=DEBATE_TAGS.map(t=>'#'+t).join(' ');
 const ask='Your pick, and why? Results later today.';
 const already=prior.length?'Already drafted: '+prior.join(', ')+'.':'First pick of the draft.';
 // Keep the full prior-pick context in text when it fits; the image always has it.
 const variants=[
  [where+' '+split,already,orList(names)+'?',ask,tags],
  [where+' '+split,prior.length?'Already drafted: see image.':already,orList(names)+'?',ask,tags],
  [where,prior.length?'Prior picks in the image.':already,orList(names)+'?',ask,tags],
  [where,'The choices and prior picks are in the image.',orList(f.choices.map((_,i)=>String.fromCharCode(65+i)))+'?',ask,tags],
 ].map(parts=>parts.join('\n\n'));
 const question=variants.find(text=>graphemes(text)<=BLUESKY_LIMIT);
 if(!question)throw Error('Debate question exceeds the Bluesky limit.');
 const questionAlt=where+' '+(prior.length?'Cards already drafted: '+andList(prior)+'.':'First pick of the draft.')+
  ' The choices: '+andList(names)+'. No results shown.';
 const obs=debateObservation(f);
 const lines=f.choices.map(c=>formatPercent(c.pct)+'% '+c.name);
 const otherPct=Math.round(1000*f.other_votes/f.players)/10;
 if(otherPct>0)lines.push(formatPercent(otherPct)+'% other cards');
 const closing='Fresh Dailies every day: packone.pro';
 const revealVariants=[
  ['Results from '+f.players+' Pack One players:\n'+lines.join('\n'),obs.sentence,closing],
  ['Results from '+f.players+' players:\n'+lines.join('\n'),'The trophy drafter took '+f.trophy.name+'.',closing],
  ['Results from '+f.players+' players: '+f.choices.map((c,i)=>String.fromCharCode(65+i)+' '+
   formatPercent(c.pct)+'%').join(', ')+'.','The trophy drafter took '+
   String.fromCharCode(65+obs.rank)+'.',closing],
 ].map(parts=>parts.join('\n\n'));
 const reveal=revealVariants.find(text=>graphemes(text)<=BLUESKY_LIMIT);
 if(!reveal)throw Error('Debate reveal exceeds the Bluesky limit.');
 // A no-break space keeps "3 ways" together when the headline wraps.
 const hook=f.players+' players split '+f.tier+'\u00a0ways';
 const longTitle='Which Would You Draft? '+names.join(' vs ')+' #Shorts';
 const title=longTitle.length<=100?longTitle:
  'Which Would You Draft? '+f.players+' Players Split '+f.tier+' Ways | MTG #Shorts';
 const description=[
  f.players+' Pack One players split '+f.tier+' ways on Pick '+f.pick_number+' of a real '+set+
   ' trophy draft. Which would you take? Comment your pick.',
  '',
  'Pack One: eight real trophy-draft decisions every day. Free. No account required. '+
   'Play at packone.pro (link in our channel profile).',
  '',
  'Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is '+
   'not approved or endorsed by Wizards. Card images: Scryfall.',
  '',
  '#MTG #MTGDraft #MagicTheGathering #Shorts',
 ].join('\n');
 return {set,hook,question,questionAlt,reveal,observation:obs.sentence,
  youtube:{title,description}};
}

// app.bsky.feed.post requires a TID record key. Deterministic per source day,
// and distinct from the Daily announcement (15:10) and legacy featured post (15:12).
function dayTid(day,clock) {
 checkedFeatureDay(day);
 let value=(BigInt(Date.parse(day+'T'+clock+'Z'))*1000n<<10n)|49n;
 const chars='234567abcdefghijklmnopqrstuvwxyz';
 let key='';
 for(let i=0;i<13;i++){key=chars[Number(value&31n)]+key;value>>=5n;}
 if(value!==0n||!/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(key))
  throw Error('Invalid debate Bluesky record key.');
 return key;
}
export const debateQuestionRkey=day=>dayTid(day,'15:14:00');
export const debateRevealRkey=day=>dayTid(day,'15:16:00');

// Bluesky only treats text as a link or hashtag when a facet marks its UTF-8 bytes.
export function debateFacets(text,{url=null,linkText='packone.pro'}={}) {
 const bytes=s=>Buffer.byteLength(s,'utf8');
 const facets=[];
 for(const tag of DEBATE_TAGS) {
  // #MTG must not match the start of #MTGDraft.
  const found=[...text.matchAll(new RegExp('#'+tag+'(?![A-Za-z0-9_])','g'))].pop();
  if(!found)continue;
  const at=found.index;
  facets.push({index:{byteStart:bytes(text.slice(0,at)),byteEnd:bytes(text.slice(0,at+tag.length+1))},
   features:[{$type:'app.bsky.richtext.facet#tag',tag}]});
 }
 if(url) {
  const at=text.lastIndexOf(linkText);
  if(at<0)throw Error('Debate link text is missing from the post.');
  facets.push({index:{byteStart:bytes(text.slice(0,at)),byteEnd:bytes(text.slice(0,at+linkText.length))},
   features:[{$type:'app.bsky.richtext.facet#link',uri:url}]});
 }
 return facets.sort((a,b)=>a.index.byteStart-b.index.byteStart);
}
