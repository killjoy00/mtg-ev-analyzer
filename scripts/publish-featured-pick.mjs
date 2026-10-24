// Independently deduplicated featured-pick publishing, separate from today's Daily.
// Patreon copy is an artifact only: Patreon API v2 has no post-creation endpoint.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {featureCopies,featureLink,featuredBlueskyRkey,pacificDay,previousPacificDay,
 formatPercent,imageUrl} from './featured-pick.mjs';
import {blueskyPublish,discordPublish,discordWebhookEntries,
 assertCurrentLivePublisher} from './post-daily-social.mjs';
import {createGithubReceiptLedger,discordReceiptKey} from './daily-social-ledger.mjs';
import {youtubeAccessToken,uploadVideo} from './upload-daily-short.mjs';

const DIR='artifacts/featured-pick';
const knownRepo='killjoy00/mtg-ev-analyzer';
export function featuredYoutubeMetadata(f) {
 const format=f.environment==='latest'?'Latest Set':f.environment==='powered-cube'?'Powered Cube':'Draft Run';
 const title=f.tier+'-Way MTG Draft Split: '+f.choices.map(c=>c.name).join(' vs ')+
  ' | Pack One #Shorts';
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
export async function publishFeatured({env=process.env,fetcher=fetch}={}) {
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!==knownRepo)
  throw Error('Featured publication is restricted to reviewed main.');
 if(env.SOURCE_PACIFIC_DAY&&env.SOURCE_PACIFIC_DAY!==pacificDay())
  return {skipped:true,reason:'stale source Pacific day'};
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 const {feature:f,copy}=JSON.parse(await readFile(DIR+'/pick.json','utf8'));
 const render=JSON.parse(await readFile(DIR+'/render.json','utf8'));
 if(!f||f.day!==previousPacificDay()||![2,3].includes(f.tier)||
  render.day!==f.day||render.puzzle_id!==f.puzzle_id||
  render.real_card_art!==true||render.duration_seconds!==20||
  !f.choices.every(c=>imageUrl(c.image_url))||
  JSON.stringify(copy)!==JSON.stringify(featureCopies(f)))
  throw Error('Featured data or rendered asset failed provenance checks.');
 const {webhooks,invalid}=discordWebhookEntries(env.DISCORD_WEBHOOK_URLS||'');
 if(invalid.length)throw Error('Some featured Discord destinations are malformed.');
 const handle=String(env.BLUESKY_HANDLE||'').trim();
 const password=String(env.BLUESKY_APP_PASSWORD||'');
 if(Boolean(handle)!==Boolean(password))throw Error('Featured Bluesky credentials are incomplete.');
 const ytSecrets=[env.PACKONE_YOUTUBE_CLIENT_ID,env.PACKONE_YOUTUBE_CLIENT_SECRET,
  env.PACKONE_YOUTUBE_REFRESH_TOKEN].map(Boolean);
 if(ytSecrets.some(Boolean)&&!ytSecrets.every(Boolean))
  throw Error('Featured YouTube credentials are incomplete.');
 const youtubeEnabled=ytSecrets.every(Boolean)&&env.YOUTUBE_PAUSED!=='true'&&
  env.FEATURED_YOUTUBE_PAUSED!=='true';
 if(!handle&&!webhooks.length&&!youtubeEnabled)
  return {skipped:true,reason:'no featured destinations configured',patreon_draft:true};
 const ledger=createGithubReceiptLedger({token:env.GITHUB_TOKEN,repo:knownRepo,
  issueNumber:1135,fetchImpl:fetcher});
 const successes=[],failures=[];
 if(handle) {
  try {
   const image=new Uint8Array(await readFile(DIR+'/featured-cover.jpg'));
   if(image.length>1_000_000)throw Error('Featured Bluesky graphic exceeds 1MB');
   const state=await blueskyPublish(fetcher,{handle,password,day:f.day,
    rkey:featuredBlueskyRkey(f.day),text:copy.bluesky,url:featureLink('bluesky'),
    linkText:'packone.pro',image:{bytes:image,type:'image/jpeg'},
    imageAlt:'Community '+f.tier+'-way draft split on '+f.choices.map(c=>c.name).join(', ')});
   successes.push({channel:'bluesky',result:state});
  } catch(error){failures.push('Bluesky: '+String(error.message||'post failed').replace(/https?:\/\/\S+/g,'[redacted]'));}
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
  } catch(error){failures.push('Discord '+(i+1)+': '+String(error.message||'post failed').replace(/https?:\/\/\S+/g,'[redacted]'));}
 }
 if(youtubeEnabled) {
  const key=discordReceiptKey('featured:youtube:public:v1');
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
   }
  } catch(error){failures.push('YouTube: '+String(error.message||'upload failed').replace(/https?:\/\/\S+/g,'[redacted]'));}
 }
 if(failures.length)throw Error('Featured publishing incomplete: '+failures.join(' | '));
 return {day:f.day,environment:f.environment,tier:f.tier,players:f.players,
  channels:successes,patreon_draft:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 publishFeatured().then(result=>console.log(JSON.stringify(result)))
  .catch(e=>{console.error(e.message||'Featured post failed.');process.exitCode=1;});
}
