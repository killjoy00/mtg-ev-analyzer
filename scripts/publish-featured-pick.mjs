// Independently deduplicated featured-pick publishing, separate from today's Daily.
// Discord gets yesterday's result every qualifying day. On debate days (Mon/Wed/Fri)
// YouTube gets the 20-second debate Short and Bluesky gets the question only;
// publish-debate-reveal.mjs answers it hours later. Patreon copy is an artifact only.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {featureCopies,featureLink,featuredBlueskyRkey,formatPercent,pacificDay,previousPacificDay,
 imageUrl} from './featured-pick.mjs';
import {debateCopies,debateQuestionRkey,debateFacets,isDebateSourceDay,
 DEBATE_TEMPLATE_VERSION} from './featured-debate.mjs';
import {discordPublish,discordWebhookEntries,assertCurrentLivePublisher} from './post-daily-social.mjs';
import {createGithubReceiptLedger,discordReceiptKey,createFormatMarkers,
 FORMAT_MARKERS} from './daily-social-ledger.mjs';
import {blueskySession,getPost,uploadImage,publishPost} from './bluesky-records.mjs';
import {youtubeAccessToken,uploadVideo} from './upload-daily-short.mjs';
import {FEATURED_AUDIO_VERSION,FEATURED_AUDIO_SECONDS} from './featured-soundtrack.mjs';
import {CORRECTION_DAY} from './featured-pick-correction.mjs';

const DIR='artifacts/featured-pick';
const knownRepo='killjoy00/mtg-ev-analyzer';
// Unchanged from the earlier featured format so a source day can never get a second upload.
export const FEATURED_YOUTUBE_RECEIPT='featured:youtube:public:v1';
export function featuredYoutubeMetadata(f) {
 const {youtube}=debateCopies(f);
 return {snippet:{title:youtube.title,description:youtube.description,categoryId:'20',
  tags:['Magic The Gathering','MTG Draft','MTG Limited','Pack One','Daily Draft']},
  status:{privacyStatus:'public',selfDeclaredMadeForKids:false}};
}
// The earlier featured format's metadata, kept only for the one-time October 25
// music reissue script, which is date-locked and can no longer run.
export function legacyFeaturedYoutubeMetadata(f) {
 const format=f.environment==='latest'?'Latest Set':f.environment==='powered-cube'?'Powered Cube':'Draft Run';
 const title=f.tier+'-Way MTG Draft Split: '+f.choices.map(c=>c.name).join(' vs ')+' | Pack One #Shorts';
 const headline=title.length<=100?title:
  f.tier+'-Way MTG Draft Split! '+f.players+' Players Disagreed | Pack One #Shorts';
 const description=[
  f.players+' Pack One players faced yesterday\'s '+format+' P1P'+f.pick_number+'.',
  ...f.choices.map(c=>formatPercent(c.pct)+'% '+c.name),
  'Trophy drafter: '+f.trophy.name+'.',
  'What would YOU take? Play today at '+featureLink('youtube'),
  '#MTG #MagicTheGathering #MTGDraft #Shorts',
 ].join('\n');
 return {snippet:{title:headline,description,categoryId:'20',
  tags:['Magic The Gathering','MTG Draft','Pack One','Powered Cube','Daily Draft']},
  status:{privacyStatus:'public',selfDeclaredMadeForKids:false}};
}
export function verifyFeaturedArtifacts({feature:f,copy},render,{today=pacificDay()}={}) {
 const yesterday=previousPacificDay(new Date(today+'T20:00:00Z'));
 if(!f||f.day!==yesterday||![2,3].includes(f.tier)||
  render.day!==f.day||render.puzzle_id!==f.puzzle_id||
  render.template_version!==DEBATE_TEMPLATE_VERSION||
  render.real_card_art!==true||render.duration_seconds!==FEATURED_AUDIO_SECONDS||
  render.audio_track!==true||render.audio_source!==FEATURED_AUDIO_VERSION||
  render.audio_stats?.original_composition!==true||
  render.question_image?.shows_results!==false||
  !f.choices.every(c=>imageUrl(c.image_url))||
  !f.prior_picks.every(c=>imageUrl(c.image_url))||
  !f.choices.some(c=>c.id===f.trophy?.id)||
  JSON.stringify(copy)!==JSON.stringify(featureCopies(f,{legacyPatreon:!copy?.patreonTitle})))
  throw Error('Featured data or rendered asset failed provenance checks.');
 return {debate:isDebateSourceDay(f.day)};
}

// Bluesky question for a debate day. The earlier format posted its own featured
// post under a different key; if that already went out for this source day,
// the question is skipped rather than adding a second post about the same pick.
export async function publishDebateQuestion(fetchImpl,{handle,password,f,image}) {
 const session=await blueskySession(fetchImpl,{handle,password});
 if(await getPost(fetchImpl,session,featuredBlueskyRkey(f.day)))
  return {status:'skipped',reason:'earlier featured format already posted for this day'};
 const copy=debateCopies(f);
 // A question posted before this wording fix must remain valid on retries.
 const existing=await getPost(fetchImpl,session,debateQuestionRkey(f.day));
 if(existing?.value?.text===debateCopies(f,{legacySplit:true}).question)
  return {status:'already-posted',uri:existing.uri,cid:existing.cid};
 return publishPost(fetchImpl,session,{rkey:debateQuestionRkey(f.day),
  record:{text:copy.question,facets:debateFacets(copy.question),langs:['en']},
  prepare:async()=>({embed:{$type:'app.bsky.embed.images',images:[{
   alt:copy.questionAlt,image:await uploadImage(fetchImpl,session,{bytes:image,type:'image/jpeg'}),
   aspectRatio:{width:1200,height:1500}}]}})});
}

export async function publishFeatured({env=process.env,fetcher=fetch}={}) {
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==knownRepo)
  throw Error('Featured publication is restricted to reviewed main.');
 if(env.SOURCE_PACIFIC_DAY&&env.SOURCE_PACIFIC_DAY!==pacificDay())
  return {skipped:true,reason:'stale source Pacific day'};
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 const data=JSON.parse(await readFile(DIR+'/pick.json','utf8'));
 const render=JSON.parse(await readFile(DIR+'/render.json','utf8'));
 const {debate}=verifyFeaturedArtifacts(data,render);
 const {feature:f,copy}=data;
 // The October 24 correction was published once; never revisit that day.
 if(f.day===CORRECTION_DAY)throw Error('The corrected featured day is closed; do not republish.');
 const {webhooks,invalid}=discordWebhookEntries(env.DISCORD_WEBHOOK_URLS||'');
 if(invalid.length)throw Error('Some featured Discord destinations are malformed.');
 const handle=String(env.BLUESKY_HANDLE||'').trim();
 const password=String(env.BLUESKY_APP_PASSWORD||'');
 if(Boolean(handle)!==Boolean(password))throw Error('Featured Bluesky credentials are incomplete.');
 const ytSecrets=[env.PACKONE_YOUTUBE_CLIENT_ID,env.PACKONE_YOUTUBE_CLIENT_SECRET,
  env.PACKONE_YOUTUBE_REFRESH_TOKEN].map(Boolean);
 if(ytSecrets.some(Boolean)&&!ytSecrets.every(Boolean))
  throw Error('Featured YouTube credentials are incomplete.');
 const youtubeEnabled=debate&&ytSecrets.every(Boolean)&&env.YOUTUBE_PAUSED!=='true'&&
  env.FEATURED_YOUTUBE_PAUSED!=='true';
 const blueskyEnabled=debate&&Boolean(handle);
 if(!blueskyEnabled&&!webhooks.length&&!youtubeEnabled)
  return {skipped:true,debate,reason:debate?'no featured destinations configured':
   'not a debate day and no Discord destinations',patreon_draft:true};
 const ledger=createGithubReceiptLedger({token:env.GITHUB_TOKEN,repo:knownRepo,
  issueNumber:1135,fetchImpl:fetcher});
 const markers=createFormatMarkers({token:env.GITHUB_TOKEN,repo:knownRepo,fetchImpl:fetcher});
 const successes=[],failures=[];
 const redact=e=>String(e.message||'failed').replace(/https?:\/\/\S+/g,'[redacted]');
 if(blueskyEnabled) {
  try {
   const image=new Uint8Array(await readFile(DIR+'/debate-question.jpg'));
   const state=await publishDebateQuestion(fetcher,{handle,password,f,image});
   successes.push({channel:'bluesky-question',result:state.status,...(state.reason?{reason:state.reason}:{})});
  } catch(error){failures.push('Bluesky: '+redact(error));}
 }
 for(const [i,webhook] of webhooks.entries()) {
  const key=discordReceiptKey('featured:'+webhook);
  try {
   const claim=await ledger.claim(f.day,key);
   if(claim.alreadyPosted){successes.push({channel:'discord-'+i,result:'already-posted'});continue;}
   try {await discordPublish(fetcher,webhook,{text:copy.discord});}
   catch(error) {
    if(Number.isInteger(error.status))await ledger.markFailed(f.day,key,claim).catch(()=>{});
    throw error;
   }
   await ledger.markPosted(f.day,key,claim);
   successes.push({channel:'discord-'+i,result:'posted'});
  } catch(error){failures.push('Discord '+(i+1)+': '+redact(error));}
 }
 if(youtubeEnabled) {
  const key=discordReceiptKey(FEATURED_YOUTUBE_RECEIPT);
  try {
   const token=await youtubeAccessToken({clientId:env.PACKONE_YOUTUBE_CLIENT_ID,
    clientSecret:env.PACKONE_YOUTUBE_CLIENT_SECRET,
    refreshToken:env.PACKONE_YOUTUBE_REFRESH_TOKEN,fetchImpl:fetcher});
   const claim=await ledger.claim(f.day,key);
   if(claim.alreadyPosted){successes.push({channel:'youtube',result:'already-posted'});}
   else {
    const bytes=new Uint8Array(await readFile(DIR+'/featured-short.mp4'));
    let uploaded;
    try {uploaded=await uploadVideo({accessToken:token,day:f.day,bytes,fetchImpl:fetcher,
      metadata:featuredYoutubeMetadata(f)});}
    catch(error) {
     if(error.refused)await ledger.markFailed(f.day,key,claim).catch(()=>{});
     throw error;
    }
    await ledger.markPosted(f.day,key,claim);
    successes.push({channel:'youtube',result:'posted',visibility:uploaded.visibility,
     link:'https://youtu.be/'+uploaded.id});
    // The first public debate Short retires the generic 10-second Daily Short.
    if(uploaded.visibility==='public')
     await markers.record(FORMAT_MARKERS.youtubeDebate,f.day)
      .catch(error=>failures.push('YouTube format marker: '+redact(error)));
   }
  } catch(error){failures.push('YouTube: '+redact(error));}
 }
 if(failures.length)throw Error('Featured publishing incomplete: '+failures.join(' | '));
 return {day:f.day,environment:f.environment,tier:f.tier,players:f.players,debate,
  channels:successes,patreon_draft:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 publishFeatured().then(result=>console.log(JSON.stringify(result)))
  .catch(e=>{console.error(e.message||'Featured post failed.');process.exitCode=1;});
}
