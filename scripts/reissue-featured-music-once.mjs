// Exactly one separate scored featured Short for the corrected October 25 post.
// The existing silent and the unrelated Daily videos are never changed or deleted.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {featureDbRows} from './generate-featured-pick.mjs';
import {featureCopies,selectFeaturedPick,pacificDay} from './featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {legacyFeaturedYoutubeMetadata} from './publish-featured-pick.mjs';
import {FEATURED_AUDIO_VERSION,FEATURED_AUDIO_SECONDS} from './featured-soundtrack.mjs';
import {youtubeAccessToken,uploadVideo} from './upload-daily-short.mjs';
import {createGithubReceiptLedger,discordReceiptKey} from './daily-social-ledger.mjs';

export const VIDEO_REISSUE_DAY='2026-10-25';
export const SOURCE_DAY='2026-10-24';
export const CORRECT_PUZZLE_ID='f13bcd75621cd97348a3d85a75aaec91';
const REPO='killjoy00/mtg-ev-analyzer',DIR='artifacts/featured-pick';
const CHANNEL=discordReceiptKey('youtube-featured-scored-reissue-2026-10-25-v1');

export function validateReissueEnvironment(env=process.env,now=new Date()) {
 if(pacificDay(now)!==VIDEO_REISSUE_DAY)throw Error('One-time video reissue date has passed.');
 if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main'||
    env.GITHUB_REPOSITORY!==REPO||env.GITHUB_RUN_ATTEMPT!=='1')
  throw Error('One-time video reissue must be a first-attempt push on reviewed main.');
 if(!env.GITHUB_TOKEN)throw Error('Missing GitHub receipt token.');
 return true;
}
export function validateFeaturedMusicReissue(f,render) {
 if(f?.day!==SOURCE_DAY||f?.puzzle_id!==CORRECT_PUZZLE_ID||
    f.environment!=='mixed'||f.tier!==3||f.round!==2||
    !f.choices?.some(c=>c.id===f.trophy?.id)||
    render?.day!==SOURCE_DAY||render.puzzle_id!==f.puzzle_id||
    render.real_card_art!==true||render.audio_track!==true||
    render.audio_source!==FEATURED_AUDIO_VERSION||
    render.audio_stats?.original_composition!==true||
    Math.abs(render.duration_seconds-FEATURED_AUDIO_SECONDS)>.1)
  throw Error('Corrected October 25 Short failed card, audio or provenance verification.');
 return true;
}
export function scoredReissueMetadata(f) {
 const meta=legacyFeaturedYoutubeMetadata(f);
 meta.snippet.title='284 MTG Drafters Split 3 Ways! Now With Music | Pack One #Shorts';
 meta.snippet.description+='\\nOriginal Pack One soundtrack and sound cues.';
 return meta;
}
export async function prepare({env=process.env,now=new Date(),fetcher=fetch}={}) {
 validateReissueEnvironment(env,now);
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 const rows=await featureDbRows(SOURCE_DAY,{apiKey:env.NEON_API_KEY,fetcher});
 const f=selectFeaturedPick(rows,{day:SOURCE_DAY});
 if(f?.puzzle_id!==CORRECT_PUZZLE_ID||f.tier!==3||f.environment!=='mixed'||
    !f.choices.some(c=>c.id===f.trophy.id))
  throw Error('The corrected October 25 featured decision no longer matches production data.');
 await mkdir(DIR,{recursive:true});
 await writeFile(DIR+'/pick.json',JSON.stringify({feature:f,copy:featureCopies(f)},null,2)+'\n');
 return {reissue:true,day:f.day,tier:f.tier,players:f.players,puzzle_id:f.puzzle_id};
}
export async function publish({env=process.env,now=new Date(),fetcher=fetch}={}) {
 validateReissueEnvironment(env,now);
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 const {feature:f}=JSON.parse(await readFile(DIR+'/pick.json','utf8'));
 const render=JSON.parse(await readFile(DIR+'/render.json','utf8'));
 validateFeaturedMusicReissue(f,render);
 const bytes=new Uint8Array(await readFile(DIR+'/featured-short.mp4'));
 if(bytes.length<100_000)throw Error('Refusing to publish an empty music video.');
 const token=await youtubeAccessToken({clientId:env.PACKONE_YOUTUBE_CLIENT_ID,
  clientSecret:env.PACKONE_YOUTUBE_CLIENT_SECRET,
  refreshToken:env.PACKONE_YOUTUBE_REFRESH_TOKEN,fetchImpl:fetcher});
 const ledger=createGithubReceiptLedger({token:env.GITHUB_TOKEN,repo:REPO,issueNumber:1135,
  fetchImpl:fetcher});
 const claim=await ledger.claim(SOURCE_DAY,CHANNEL);
 if(claim.alreadyPosted)return {day:SOURCE_DAY,already_posted:true};
 let upload;
 try {
  upload=await uploadVideo({accessToken:token,day:SOURCE_DAY,bytes,fetchImpl:fetcher,
   metadata:scoredReissueMetadata(f)});
 }catch(error) {
  // No retry after uncertain writes. Only a definite YouTube HTTP refusal is safe.
  if(error.refused)await ledger.markFailed(SOURCE_DAY,CHANNEL,claim).catch(()=>{});
  throw error;
 }
 await ledger.markPosted(SOURCE_DAY,CHANNEL,claim);
 const link='https://youtu.be/'+upload.id;
 if(env.GITHUB_STEP_SUMMARY)await writeFile(env.GITHUB_STEP_SUMMARY,
  '### October 25 corrected featured Short with original soundtrack\n\n'+
  'New video: '+link+'\n\n'+
  'Earlier videos to remove in YouTube Studio:\n\n'+
  '- https://studio.youtube.com/video/d1COWi1TOq4/edit\n'+
  '- https://studio.youtube.com/video/UQEPwSXPnAc/edit\n',{flag:'a'});
 return {day:SOURCE_DAY,posted:true,video_url:link,visibility:upload.visibility,
  preserves_existing_videos:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const task=process.argv[2];
 if(!['prepare','publish'].includes(task))throw Error('Expected prepare or publish');
 (task==='prepare'?prepare():publish()).then(x=>console.log(JSON.stringify(x)))
 .catch(e=>{console.error('One-time scored Short: '+e.message);process.exitCode=1;});
}
