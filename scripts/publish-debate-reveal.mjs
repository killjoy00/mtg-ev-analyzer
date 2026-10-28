// Answer a Bluesky debate question hours after it was asked: the player split,
// the trophy drafter's pick, one factual observation and a link to play.
// The reply text comes from the same frozen feature the question was built from.
import {readFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {featureCopies,pacificDay,previousPacificDay,checkedFeatureDay} from './featured-pick.mjs';
import {debateCopies,debateFacets,debateLink,debateQuestionRkey,debateRevealRkey,
 isDebateSourceDay,REVEAL_DELAY_HOURS} from './featured-debate.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {createFormatMarkers,FORMAT_MARKERS} from './daily-social-ledger.mjs';
import {blueskySession,getPost,publishPost,publicPostCounts} from './bluesky-records.mjs';

export const FEATURE_CACHE='artifacts/featured-cache';
const knownRepo='killjoy00/mtg-ev-analyzer';
const dayBefore=day=>previousPacificDay(new Date(checkedFeatureDay(day)+'T20:00:00Z'));

// Today's question first; yesterday's too, in case every afternoon attempt failed.
export function revealSourceDays(now=new Date()) {
 const yesterday=previousPacificDay(now);
 return [yesterday,dayBefore(yesterday)].filter(isDebateSourceDay);
}
export async function cachedFeature(day,{read=readFile,dir=FEATURE_CACHE}={}) {
 let data;
 try {data=JSON.parse(await read(dir+'/'+day+'/pick.json','utf8'));}
 catch {return null;}
 const f=data?.feature;
 if(f?.day!==day||JSON.stringify(data.copy)!==JSON.stringify(featureCopies(f)))
  throw Error('Cached featured decision for '+day+' failed provenance checks.');
 return f;
}

export async function revealOne(fetchImpl,session,f,{now=new Date()}={}) {
 const copy=debateCopies(f);
 const question=await getPost(fetchImpl,session,debateQuestionRkey(f.day));
 if(!question)return {day:f.day,status:'skipped',reason:'no question was posted'};
 // Never answer a question with data from a different decision.
 if(question.value?.text!==copy.question &&
    question.value?.text!==debateCopies(f,{legacySplit:true}).question)
  throw Error('Bluesky question for '+f.day+' does not match its cached decision.');
 const asked=Date.parse(question.value?.createdAt);
 if(!Number.isFinite(asked))throw Error('Bluesky question for '+f.day+' has no timestamp.');
 const existing=await getPost(fetchImpl,session,debateRevealRkey(f.day));
 if(!existing&&now.getTime()-asked<REVEAL_DELAY_HOURS*3600_000)
  return {day:f.day,status:'skipped',reason:'question is under '+REVEAL_DELAY_HOURS+' hours old'};
 const ref={uri:question.uri,cid:question.cid};
 const url=debateLink('bluesky');
 const result=await publishPost(fetchImpl,session,{rkey:debateRevealRkey(f.day),record:{
  text:copy.reveal,facets:debateFacets(copy.reveal,{url}),langs:['en'],
  reply:{root:ref,parent:ref}}});
 return {day:f.day,status:result.status,question:question.uri,reveal:result.uri};
}

async function summarize(fetchImpl,did,{now,write}) {
 // Public counts only; Bluesky publishes no reach or impression numbers.
 const days=[];
 for(let d=previousPacificDay(now),i=0;i<21;i++,d=dayBefore(d))if(isDebateSourceDay(d))days.push(d);
 const uri=rkey=>'at://'+did+'/app.bsky.feed.post/'+rkey;
 const counts=new Map((await publicPostCounts(fetchImpl,days.flatMap(d=>
  [uri(debateQuestionRkey(d)),uri(debateRevealRkey(d))]))).map(c=>[c.uri,c]));
 const rows=days.flatMap(d=>{
  const q=counts.get(uri(debateQuestionRkey(d))),r=counts.get(uri(debateRevealRkey(d)));
  if(!q)return [];
  const sum=k=>(q?.[k]||0)+(r?.[k]||0);
  return ['| '+d+' | '+(r?'yes':'no')+' | '+sum('likes')+' | '+sum('reposts')+' | '+sum('replies')+' | '+sum('quotes')+' |'];
 });
 await write(['### Bluesky draft debates, last three weeks','',
  'Public counts for each question plus its reveal reply. Bluesky does not publish reach.','',
  '| Daily shown | Revealed | Likes | Reposts | Replies | Quotes |','| --- | --- | --- | --- | --- | --- |',
  ...(rows.length?rows:['| none yet | | | | | |']),''].join('\n'));
}

export async function publishReveals({env=process.env,fetcher=fetch,now=new Date(),
 read=readFile,write=text=>env.GITHUB_STEP_SUMMARY?appendFile(env.GITHUB_STEP_SUMMARY,text+'\n'):null}={}) {
 const live=env.GITHUB_EVENT_NAME==='schedule'||env.MANUAL_LIVE==='true';
 if(!live)return {dry_run:true,days:revealSourceDays(now)};
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==knownRepo)
  throw Error('Debate reveals are restricted to reviewed main.');
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 const handle=String(env.BLUESKY_HANDLE||'').trim(),password=String(env.BLUESKY_APP_PASSWORD||'');
 if(Boolean(handle)!==Boolean(password))throw Error('Bluesky credentials are incomplete.');
 if(!handle)return {skipped:true,reason:'Bluesky is not configured'};
 const session=await blueskySession(fetcher,{handle,password});
 const markers=createFormatMarkers({token:env.GITHUB_TOKEN,repo:knownRepo,fetchImpl:fetcher});
 const results=[],failures=[];
 for(const day of revealSourceDays(now)) {
  try {
   const f=await cachedFeature(day,{read});
   if(!f){results.push({day,status:'skipped',reason:'no cached decision for this day'});continue;}
   const result=await revealOne(fetcher,session,f,{now});
   results.push(result);
   // The first answered debate retires the generic morning Bluesky announcement.
   if(['posted','already-posted'].includes(result.status))
    await markers.record(FORMAT_MARKERS.blueskyDebate,day);
  } catch(error) {
   failures.push(day+': '+String(error.message||'reveal failed').replace(/https?:\/\/\S+/g,'[redacted]'));
  }
 }
 await summarize(fetcher,session.did,{now,write}).catch(()=>{});
 if(failures.length)throw Error('Debate reveal incomplete: '+failures.join(' | '));
 return {today:pacificDay(now),results};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 publishReveals().then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{console.error(error.message||'Debate reveal failed.');process.exitCode=1;});
}
