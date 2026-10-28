import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {youtubeReport,shortFormat,youtubeReportConfigured,clearYoutubeReportCache} from '../worker/youtube-report.mjs';

const env={PACKONE_YOUTUBE_ANALYTICS_CLIENT_ID:'client',PACKONE_YOUTUBE_ANALYTICS_CLIENT_SECRET:'secret',
 PACKONE_YOUTUBE_ANALYTICS_REFRESH_TOKEN:'refresh'};
const now=new Date('2026-11-10T20:00:00Z');
const uploads=[
 {id:'debateAAAAA',title:'Which Would You Draft? A vs B vs C #Shorts',at:'2026-11-02T15:00:00Z'},
 {id:'genericBBBB',title:'Today\'s MTG Draft Pick | Pack One Nov 1, 2026 #Shorts',at:'2026-11-01T16:40:00Z'},
 {id:'legacyCCCCC',title:'3-Way MTG Draft Split: X vs Y vs Z | Pack One #Shorts',at:'2026-10-25T15:00:00Z'},
 {id:'ancientDDDD',title:'Which Would You Draft? Old #Shorts',at:'2026-08-01T15:00:00Z'},
];
function google({fullMetrics=true,failToken=false}={}) {
 const calls=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(url);calls.push(u.pathname+(u.searchParams.get('metrics')?'?'+u.searchParams.get('metrics'):''));
  const json=(body,status=200)=>({ok:status<300,status,json:async()=>body});
  if(u.href.startsWith('https://oauth2.googleapis.com/token')) {
   assert.equal(new URLSearchParams(options.body).get('refresh_token'),'refresh');
   return failToken?json({error:'invalid_grant',error_description:'secret detail'},400):json({access_token:'access-token'});
  }
  assert.equal(options.headers.authorization,'Bearer access-token');
  if(u.pathname==='/youtube/v3/channels')return json({items:[{contentDetails:{relatedPlaylists:{uploads:'UUpack'}}}]});
  if(u.pathname==='/youtube/v3/playlistItems')return json({items:uploads.map(v=>({snippet:{title:v.title,publishedAt:v.at},contentDetails:{videoId:v.id,videoPublishedAt:v.at}}))});
  if(u.pathname==='/v2/reports'&&u.searchParams.get('dimensions')==='video') {
   assert.equal(u.searchParams.get('ids'),'channel==MINE');
   assert.equal(u.searchParams.get('sort'),'-views');
   assert.ok(Number(u.searchParams.get('maxResults'))<=200);
   const metrics=u.searchParams.get('metrics').split(',');
   if(metrics.includes('engagedViews')&&!fullMetrics)return json({error:{message:'unsupported'}},400);
   const value={views:1000,engagedViews:620,averageViewDuration:13,averageViewPercentage:65,likes:40,shares:5,subscribersGained:3};
   return json({columnHeaders:[{name:'video'},...metrics.map(name=>({name}))],
    rows:[['debateAAAAA',...metrics.map(m=>value[m])],['genericBBBB',...metrics.map(m=>Math.round(value[m]/4))]]});
  }
  if(u.pathname==='/v2/reports'&&u.searchParams.get('dimensions')==='elapsedVideoTimeRatio') {
   assert.equal(u.searchParams.get('filters'),'video==debateAAAAA','retention is one video per request');
   return json({rows:Array.from({length:100},(_,i)=>[(i+1)/100,1-(i+1)/200])});
  }
  throw Error('unexpected '+u.href);
 };
 return {fetcher,calls};
}

test('formats come from the titles each publisher generates',()=>{
 assert.equal(shortFormat('Which Would You Draft? Web Up vs Thor #Shorts'),'debate');
 assert.equal(shortFormat('3-Way MTG Draft Split: A vs B | Pack One #Shorts'),'featured_v1');
 assert.equal(shortFormat('Today\'s MTG Draft Pick | Pack One Oct 27, 2026 #Shorts'),'daily_generic');
 assert.equal(shortFormat('What Would You Take? Real Reality Fracture Trophy Draft | Pack One #Shorts'),'other');
});

test('reports recent Shorts by format with engaged views and debate retention',async()=>{
 clearYoutubeReportCache();
 const {fetcher}=google();
 const report=await youtubeReport({env,fetcher,now,useCache:false});
 assert.equal(report.configured,true);
 assert.equal(report.engaged_views_available,true);
 assert.deepEqual(report.videos.map(v=>[v.id,v.format]),[['debateAAAAA','debate'],['genericBBBB','daily_generic'],['legacyCCCCC','featured_v1']],
  'uploads older than 60 days are left out');
 const debate=report.videos[0];
 assert.equal(debate.views,1000);assert.equal(debate.engaged_views,620);assert.equal(debate.average_view_pct,65);
 assert.deepEqual(debate.retention,{'3s':92.5,'9s':77.5,'15s':62.5});
 assert.equal(report.videos[1].retention,null,'retention points describe the debate format only');
 assert.equal(report.videos[2].views,0,'a video missing from the analytics rows reads as zero');
});

test('falls back to basic metrics when YouTube rejects the fuller set',async()=>{
 const {fetcher,calls}=google({fullMetrics:false});
 const report=await youtubeReport({env,fetcher,now,useCache:false});
 assert.equal(report.engaged_views_available,false);
 assert.equal(report.videos[0].engaged_views,null);
 assert.equal(report.videos[0].views,1000);
 assert.equal(calls.filter(c=>c.startsWith('/v2/reports?')&&!c.includes('audienceWatchRatio')).length,2,'one rejected full request, one basic retry');
});

test('missing or failing credentials never leak provider details',async()=>{
 assert.equal(youtubeReportConfigured({}),false);
 assert.deepEqual(await youtubeReport({env:{},fetcher:()=>{throw Error('no network');}}),{configured:false});
 const {fetcher}=google({failToken:true});
 await assert.rejects(youtubeReport({env,fetcher,now,useCache:false}),error=>{
  assert.equal(error.message,'YouTube Analytics sign-in returned HTTP 400.');
  return true;
 });
});

test('results are cached for ten minutes per function instance',async()=>{
 clearYoutubeReportCache();
 const {fetcher,calls}=google();
 await youtubeReport({env,fetcher,now});
 const first=calls.length;
 await youtubeReport({env,fetcher,now:new Date(now.getTime()+5*60_000)});
 assert.equal(calls.length,first);
 await youtubeReport({env,fetcher,now:new Date(now.getTime()+11*60_000)});
 assert.ok(calls.length>first);
 clearYoutubeReportCache();
});

test('the admin route is read-only and the secrets reach only production draftrunapi',()=>{
 const admin=readFileSync('worker/measurement-admin.mjs','utf8');
 assert.match(admin,/url\.pathname==='\/v1\/admin\/youtube'\)\n\s+return youtubeReport\(\)\.catch/);
 assert.ok(admin.indexOf("'/v1/admin/youtube'")>admin.indexOf("if(request.method!=='GET')fail('Method not allowed.',405);"),
  'only GET reaches the report, after the administrator check');
 const deploy=readFileSync('.github/workflows/deploy-functions.yml','utf8');
 assert.match(deploy,/"\$slug" == draftrunapi && "\$RELEASE_TARGET" == production && "\$YOUTUBE_ANALYTICS_CONFIGURED" == true/);
 assert.doesNotMatch(deploy,/PACKONE_YOUTUBE_REFRESH_TOKEN/,'the upload credential never reaches the backend');
 const ui=readFileSync('admin/admin.mjs','utf8');
 assert.match(ui,/request\('\/v1\/admin\/youtube'\)/);
});
