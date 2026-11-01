// Yesterday's most debated pick. Pure ranking is independent of publication.
// Public posts quote this sample size, so a thin split is not evidence.
export const MIN_FEATURED_PEERS=50;
// A basic-land trophy pick reads as a data error to viewers, whatever the reason.
const BASIC_LAND=/^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/;
export const isBasicLand=c=>/\bBasic\b.*\bLand\b/.test(String(c?.type_line||''))||
 BASIC_LAND.test(String(c?.name||''));
export const FEATURED_SQL=`
WITH scheduled AS (
 SELECT s.environment,a.ordinality::int round,p.puzzle_id,p.set_id,p.pick_number,p.payload
 FROM draft_run_schedules s
 CROSS JOIN LATERAL jsonb_array_elements_text(s.puzzle_ids) WITH ORDINALITY a(puzzle_id,ordinality)
 JOIN draft_run_verified_puzzles p ON p.puzzle_id=a.puzzle_id
 WHERE s.day=$1::date
), first_answers AS (
 SELECT s.environment,o.puzzle_id,o.selected_id,
 row_number() OVER (
  PARTITION BY s.environment,o.puzzle_id,COALESCE(s.daily_account_id::text,s.player_id::text)
  ORDER BY s.created_at,s.id,o.revision
 ) AS occurrence
 FROM draft_run_decision_observations o JOIN draft_run_sessions s ON s.id=o.session_id
 WHERE s.day=$1::date AND o.outcome='pick' AND NOT s.measurement_qa
  AND EXISTS(SELECT 1 FROM scheduled d WHERE d.environment=s.environment
   AND d.puzzle_id=o.puzzle_id AND d.round=o.round)
), counts AS (
 SELECT environment,puzzle_id,selected_id,count(*)::int votes
 FROM first_answers WHERE occurrence=1 GROUP BY 1,2,3
), aggregates AS (
 SELECT environment,puzzle_id,jsonb_object_agg(selected_id,votes) AS votes
 FROM counts GROUP BY 1,2
)
SELECT d.environment,d.round,d.puzzle_id,d.set_id,d.pick_number,d.payload,
 COALESCE(a.votes,'{}'::jsonb) AS votes
FROM scheduled d LEFT JOIN aggregates a ON a.environment=d.environment AND a.puzzle_id=d.puzzle_id
ORDER BY d.environment,d.round`;

export function pacificDay(now=new Date()) {
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',
 }).formatToParts(now).filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));
 return [fields.year,fields.month,fields.day].join('-');
}
export function previousPacificDay(now=new Date()) {
 const d=new Date(pacificDay(now)+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()-1);
 return d.toISOString().slice(0,10);
}
export function checkedFeatureDay(day) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day))||
    new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)
  throw Error('Invalid featured pick day.');
 return day;
}
export function imageUrl(value) {
 try {
  const u=new URL(value);
  if(u.protocol==='https:'&&u.hostname==='cards.scryfall.io'&&
   /^\/(normal|large|png)\/front\//.test(u.pathname)&&!u.username&&!u.password)
   return u.toString();
 } catch {}
 return null;
}
const name=s=>typeof s==='string'&&s.length>0&&s.length<=100?s:null;
const validId=s=>typeof s==='string'&&/^[a-z0-9-]{1,120}$/.test(s);
export function selectFeaturedPick(rows,{day,minPeers=MIN_FEATURED_PEERS}={}) {
 checkedFeatureDay(day);
 if(!Array.isArray(rows))throw Error('Featured rows must be an array.');
 const eligible=[];
 for(const row of rows) {
  if(!['latest','mixed','powered-cube'].includes(row.environment))continue;
  const cards=Array.isArray(row.payload?.candidates)?row.payload.candidates:[];
  const byId=new Map(cards.filter(c=>validId(c.id)&&name(c.name)&&imageUrl(c.image_url))
   .map(c=>[c.id,{id:c.id,name:c.name,image_url:imageUrl(c.image_url),
    model_probability:Number(c.model_probability)||0}]));
  // Never undercount the denominator when a selected card lacks usable art.
  const rawVotes=Object.entries(row.votes||{}).filter(([,n])=>
   Number.isSafeInteger(Number(n))&&Number(n)>0);
  if(rawVotes.some(([id])=>!byId.has(id)))continue;
  const counts=rawVotes.filter(([id,n])=>
   byId.has(id)&&Number.isSafeInteger(Number(n))&&Number(n)>0)
   .map(([id,n])=>({...byId.get(id),votes:Number(n)}))
   .sort((a,b)=>b.votes-a.votes||a.id.localeCompare(b.id));
  const total=counts.reduce((n,c)=>n+c.votes,0);
  if(total<minPeers||counts.length<2||!validId(row.payload?.historical_pick_id)||
   !byId.has(row.payload.historical_pick_id))continue;
  const share=n=>counts[n]?.votes/total||0;
  const three=counts.length>=3&&share(2)>=0.15&&share(1)>=0.20&&
   share(0)<=0.60&&share(0)+share(1)+share(2)>=0.75;
  const two=share(1)>=0.18&&share(0)<=0.75&&share(0)+share(1)>=0.65;
  if(!three&&!two)continue;
  const tier=three?3:2;
  // A featured debate must NEVER reveal a trophy pick outside the displayed choices.
  // Skip the puzzle entirely rather than silently turning a three-way into a two-way.
  if(!counts.slice(0,tier).some(c=>c.id===row.payload.historical_pick_id))continue;
  const trophy=byId.get(row.payload.historical_pick_id);
  const trophyCard=cards.find(c=>c.id===trophy.id);
  if(isBasicLand(trophyCard))continue;
  const prior=Array.isArray(row.payload.prior_picks)?row.payload.prior_picks:[];
  // Viewers judge the pick from the drafter's earlier picks. A missing or
  // imageless prior pick would make the shown context misleading, so skip.
  const pickNumber=Number(row.pick_number);
  if(!Number.isInteger(pickNumber)||pickNumber<1||pickNumber>15||prior.length!==pickNumber-1||
   prior.some(c=>!name(c?.name)||!imageUrl(c?.image_url)))continue;
  const priorPicks=prior.map(c=>({name:c.name,image_url:imageUrl(c.image_url)}));
  const trophyVotes=counts.find(c=>c.id===trophy.id)?.votes||0;
  const spread=share(0)-share(tier-1);
  const surprise=1-trophyVotes/total;
  const score=Math.round(100*(0.7*(1-spread)+0.3*surprise));
  eligible.push({
   day,environment:row.environment,round:Number(row.round),
   pick_number:Number(row.pick_number),set_id:row.set_id,puzzle_id:row.puzzle_id,
   players:total,tier,score,
   choices:counts.slice(0,tier).map(c=>({...c,pct:Math.round(1000*c.votes/total)/10})),
   other_votes:total-counts.slice(0,tier).reduce((n,c)=>n+c.votes,0),
   trophy:{...trophy,votes:trophyVotes,pct:Math.round(1000*trophyVotes/total)/10},
   prior_picks:priorPicks,
  });
 }
 eligible.sort((a,b)=>b.tier-a.tier||
  Number(b.environment==='latest')-Number(a.environment==='latest')||
  b.score-a.score||b.players-a.players||a.environment.localeCompare(b.environment)||
  a.round-b.round);
 return eligible[0]||null;
}
export function formatPercent(p) {
 return Number.isInteger(p)?String(p):Number(p).toFixed(1).replace(/\.0$/,'');
}
export function featureLink(platform) {
 const source={bluesky:'bluesky',discord:'discord',youtube:'youtube'}[platform]||'social';
 return 'https://packone.pro/?game=draft-run&daily=1&utm_source='+source+
  '&utm_medium=social&utm_campaign=featured_pick';
}
export function featureCopies(f,{legacyPatreon=false}={}) {
 if(!f||![2,3].includes(f.tier)||f.choices.length!==f.tier||
  !f.choices.some(c=>c.id===f.trophy?.id))
  throw Error('Invalid featured pick: trophy choice must be displayed.');
 const label=f.environment==='latest'?'Latest Set':f.environment==='powered-cube'?'Powered Cube':'Draft Run';
 const pct=c=>formatPercent(c.pct)+'% '+c.name;
 const intro='Yesterday\'s Pack One '+label+' P1P'+f.pick_number+
  ' split '+f.tier+' ways! 🃏';
 const trophy='The trophy drafter took '+f.trophy.name+
  ' ('+formatPercent(f.trophy.pct)+'%).';
 let blue=intro+'\n\n'+f.choices.map(pct).join('\n')+'\n\n'+f.players+' Pack One players. '+
  trophy+'\n\nYour pick? packone.pro';
 if([...blue].length>300)blue=intro+'\n\n'+f.choices.map(c=>
  formatPercent(c.pct)+'% '+c.name).join(' · ')+
  '\n\nTrophy: '+f.trophy.name+'. Your pick? packone.pro';
 if([...blue].length>300)throw Error('Featured Bluesky post exceeds 300 characters.');
 const discord='**A contested pick from yesterday\'s Daily** 🃏\n\n'+
  label+' · P1P'+f.pick_number+' · '+f.players+' Pack One players\n\n'+
  (f.prior_picks.length?'**Already drafted:** '+f.prior_picks.map(c=>c.name).join(', ')+'\n\n':'')+
  '**The community chose:**\n'+f.choices.map((c,i)=>
   '**'+String.fromCharCode(65+i)+'. '+c.name+'** — '+formatPercent(c.pct)+
   '% ('+c.votes+' votes)').join('\n')+
  (f.other_votes?'\nOther cards — '+f.other_votes+' votes':'')+
  '\n\n**Trophy choice:** ||'+f.trophy.name+'||\n\n'+
  '**What would you take, and why?**\n'+featureLink('discord');
 const title='The Pick That Split '+f.players+' Drafters '+f.tier+
  ' Ways | Pack One '+label;
 const patreonTitle="Pack One's Contested Daily Pick "+f.day;
 const patreon='# '+(legacyPatreon?title:patreonTitle)+'\n\n'+label+' · P1P'+f.pick_number+
  ' · '+f.day+'\n\n'+
  (f.prior_picks.length?'**Prior picks:** '+f.prior_picks.map(c=>c.name).join(', ')+'.\n\n':'')+
  (legacyPatreon?'Of '+f.players+' distinct Pack One players:\n\n':"Here’s what "+f.players+' Pack One players picked:\n\n')+
  f.choices.map(c=>'- **'+formatPercent(c.pct)+'%** chose '+c.name+' ('+c.votes+' players)').join('\n')+
  (f.other_votes?'\n- **'+f.other_votes+'** chose other cards.':'')+
  '\n\nThe original trophy drafter took **'+f.trophy.name+
  '**.'+(legacyPatreon?' That was the choice of '+formatPercent(f.trophy.pct)+'% of players.':'')+
  '\n\n**What would you take, and why?**\n\nPlay today\'s Daily: https://packone.pro/';
 return {label,bluesky:blue,discord,patreon,title,...(legacyPatreon?{}:{patreonTitle})};
}
// Deterministic ATProto TID, distinct from the existing Daily announcement.
export function featuredBlueskyRkey(day) {
 checkedFeatureDay(day);
 const stamp=Date.parse(day+'T15:12:00Z');
 let value=(BigInt(stamp)*1000n<<10n)|49n;
 const chars='234567abcdefghijklmnopqrstuvwxyz';
 let key='';
 for(let i=0;i<13;i++){key=chars[Number(value&31n)]+key;value>>=5n;}
 if(value!==0n||!/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(key))
  throw Error('Invalid featured Bluesky record key.');
 return key;
}
