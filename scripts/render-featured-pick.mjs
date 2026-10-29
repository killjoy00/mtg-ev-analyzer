// Render yesterday's featured decision: the 20-second debate Short, the
// spoiler-free Bluesky question image and the Patreon/Discord cover.
// All card art URLs come from the verified immutable puzzle payload.
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {imageUrl,formatPercent} from './featured-pick.mjs';
import {debateCopies,debateObservation,otherVotePercent,DEBATE_TEMPLATE_VERSION} from './featured-debate.mjs';
import {buildFeaturedSoundtrack,FEATURED_AUDIO_VERSION,FEATURED_AUDIO_SECONDS} from './featured-soundtrack.mjs';

const DIR='artifacts/featured-pick',run=promisify(execFile);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letter=i=>String.fromCharCode(65+i);
// Letters sit under the card so they never cover its printed name.
const card=(c,{label='',state=''}={})=>
 '<div class="card '+state+'"><img src="'+escape(imageUrl(c.image_url))+'" alt="'+escape(c.name)+'">'+
 '<div class="cardname">'+(label?'<span class="badge">'+label+'</span>':'')+escape(c.name)+'</div></div>';
const priorCard=c=>'<div class="prior"><img src="'+escape(imageUrl(c.image_url))+
 '" alt="'+escape(c.name)+'"></div>';
const brand=logo=>'<div class="brand"><img src="'+logo+'" alt="">PACK ONE</div>';
const css=(display,body)=>[
 '@font-face{font-family:Barlow;src:url(data:font/woff2;base64,'+display+') format("woff2");font-weight:700}',
 '@font-face{font-family:Source;src:url(data:font/woff2;base64,'+body+') format("woff2");font-weight:700}',
 '*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0d1828;color:#fff;font-family:Source,Arial,sans-serif}',
 // Shorts cover roughly the top 130px and bottom 330px with player UI.
 '.frame{position:relative;width:100%;height:100%;overflow:hidden;padding:130px 56px 330px;',
 'display:flex;flex-direction:column;',
 'background:radial-gradient(ellipse at 85% 0%,#245a94 0%,#112640 50%,#0d1828 88%)}',
 '.stage{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}',
 '.brand{display:flex;align-items:center;gap:14px;font:700 30px Barlow,Arial;letter-spacing:4px;color:#cfe6ff}',
 '.brand img{width:44px;height:44px;border-radius:8px}',
 'h1{font:700 112px/0.98 Barlow,Arial;margin:0 0 20px;letter-spacing:1px;text-transform:uppercase}',
 'h2{font:700 76px/1.02 Barlow,Arial;margin:0 0 14px;text-transform:uppercase}',
 '.sub{font-size:40px;line-height:1.25;color:#cfe0f0;margin:0}',
 '.cards{display:flex;gap:20px;justify-content:center;align-items:flex-start;margin-top:48px}',
 '.card{position:relative;flex:1;max-width:320px;text-align:center}',
 '.two .card{max-width:440px}',
 '.card img{width:100%;aspect-ratio:.716;object-fit:cover;border-radius:20px;box-shadow:0 16px 36px #000b;display:block}',
 '.cardname{font-size:34px;line-height:1.15;margin-top:16px;font-weight:700}',
 '.badge{display:block;width:58px;height:58px;margin:0 auto 10px;',
 'border-radius:50%;background:#fff;color:#103352;font:700 40px/58px Barlow,Arial}',
 '.dim{opacity:.28;filter:grayscale(.7)}',
 '.win img{outline:10px solid #ffd76a;outline-offset:0}',
 '.win .cardname{color:#ffd76a}',
 '.priors{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:18px}',
 '.prior{width:170px}.prior img{width:100%;aspect-ratio:.716;object-fit:cover;border-radius:10px;display:block}',
 '.small .prior{width:118px}',
 '.label{font:700 36px Barlow,Arial;letter-spacing:3px;color:#8fc8ff;margin-top:44px;text-align:center}',
 '.count{position:absolute;right:60px;top:200px;width:150px;height:150px;border-radius:50%;',
 'border:8px solid #9bd7ff;font:700 110px/134px Barlow,Arial;text-align:center;color:#fff}',
 '.votes{display:flex;flex-direction:column;gap:28px;margin-top:56px}',
 '.vote{display:flex;gap:26px;align-items:center;background:#15314f;border:2px solid #4d7899;border-radius:26px;padding:22px}',
 '.vote img{width:170px;aspect-ratio:.716;object-fit:cover;border-radius:12px}',
 '.vote .info{flex:1}.vote .row{display:flex;justify-content:space-between;align-items:baseline;gap:16px}',
 '.vote .name{font-size:40px;font-weight:700;line-height:1.15}',
 '.vote strong{font:700 84px Barlow,Arial;color:#a6d8ff}',
 '.bar{height:22px;margin-top:14px;background:#34516b;border-radius:12px;overflow:hidden}',
 '.bar span{display:block;height:100%;background:linear-gradient(90deg,#65b3ed,#a9ddff)}',
 '.note{font-size:46px;line-height:1.3;color:#e3f1ff;text-align:center;margin:44px 20px 0;font-weight:700}',
 '.other-votes{font-size:38px;color:#cfe0f0;text-align:center;margin:20px 0 0}',
 '.cta{font:700 112px/1.0 Barlow,Arial;text-transform:uppercase}',
 '.facts{font-size:52px;line-height:1.3;color:#e3f1ff;margin-top:40px;font-weight:700}',
 '.url{display:inline-block;margin-top:60px;background:#fff;color:#103352;font:700 96px Barlow,Arial;',
 'border-radius:26px;padding:24px 44px}',
 '.profile{font-size:44px;color:#cfe6ff;margin-top:34px;font-weight:700}',
 // Bluesky question image: 1200x1500, no results anywhere.
 '.post.frame{padding:56px 60px 48px}.post h1{font-size:84px;margin:0 0 10px}.post .sub{font-size:36px}',
 '.post .cards{margin-top:36px}.post .card{max-width:345px}.post .prior{width:140px}',
 '.post .label{margin-top:30px;font-size:32px}.post .ask{font:700 58px Barlow,Arial;text-align:center;margin-top:30px}',
 // Legacy cover (Patreon/Discord), unchanged in content.
 '.horizontal.frame{padding:28px 48px 32px;display:block}.horizontal .brand{font-size:26px}',
 '.horizontal h1{font-size:56px;margin:12px 0 8px}.horizontal .sub{font-size:22px}',
 '.horizontal .cards{margin:16px 0 0;gap:18px;justify-content:flex-start}',
 '.horizontal .card{flex:none;width:187px}.horizontal .card img{border-radius:9px}.horizontal .cardname{font-size:17px;margin-top:7px}',
 '.coverRight{position:absolute;left:710px;top:150px;right:38px}',
 '.coverRight .vote{padding:12px;margin-bottom:12px;border-radius:12px}.coverRight .name{font-size:20px}',
 '.coverRight strong{font-size:40px}',
].join('');
function page(fonts,body,cls='') {
 return '<!doctype html><html><head><meta charset="utf-8"><style>'+css(fonts.display,fonts.body)+
  '</style></head><body><main class="frame '+cls+'">'+body+'</main></body></html>';
}
function cardRow(f,opts={}) {
 return '<div class="cards'+(f.tier===2?' two':'')+'">'+f.choices.map((c,i)=>card(c,{
  label:opts.letters?letter(i):'',
  state:opts.trophy?(c.id===f.trophy.id?'win':'dim'):'',
 })).join('')+'</div>';
}
function voteRows(f,{thumbs=true}={}) {
 return f.choices.map(c=>'<div class="vote">'+(thumbs?'<img src="'+escape(imageUrl(c.image_url))+'" alt="">':'')+
  '<div class="info"><div class="row"><span class="name">'+escape(c.name)+'</span><strong>'+
  formatPercent(c.pct)+'%</strong></div><div class="bar"><span style="width:'+Math.min(100,c.pct)+
  '%"></span></div></div></div>').join('');
}
function priorRow(f,small=false) {
 return f.prior_picks.length?'<div class="label">ALREADY DRAFTED</div><div class="priors'+(small?' small':'')+'">'+
  f.prior_picks.map(priorCard).join('')+'</div>':'<div class="label">FIRST PICK OF THE DRAFT</div>';
}
const stage=(logo,inner)=>brand(logo)+'<div class="stage">'+inner+'</div>';

// 0-3s hook with the real cards, 3-9s context and decision time, 9-15s the
// player vote and the trophy pick, 15-20s what Pack One is. Seconds sum to 20.
export function debateScenes(f,logo) {
 const copy=debateCopies(f),obs=debateObservation(f);
 const where=escape(copy.set)+' · Pick '+f.pick_number;
 const other=otherVotePercent(f);
 const decide=n=>({seconds:1,body:'<div class="count">'+n+'</div>'+stage(logo,
  '<h2>Lock in your pick</h2><p class="sub">'+where+'</p>'+priorRow(f,true)+cardRow(f,{letters:true}))});
 return [
  {seconds:3,body:stage(logo,'<h1>'+escape(copy.hook)+'</h1><p class="sub">'+where+
   ' of a real trophy draft. Which would you take?</p>'+cardRow(f))},
  {seconds:3,body:stage(logo,'<h2>What would you take?</h2><p class="sub">'+where+'</p>'+
   priorRow(f)+cardRow(f,{letters:true}))},
  decide(3),decide(2),decide(1),
  {seconds:4,body:stage(logo,'<h2>'+f.players+' Pack One players picked</h2><p class="sub">'+where+'</p>'+
   '<div class="votes">'+voteRows(f)+'</div>'+
   (other>0?'<p class="other-votes">'+formatPercent(other)+'% chose other cards</p>':''))},
  {seconds:2,body:stage(logo,'<h2>The trophy drafter took</h2><p class="sub">'+
   escape(f.trophy.name)+'</p>'+cardRow(f,{trophy:true})+'<p class="note">'+
   escape(obs.sentence.replace(/^The trophy drafter took [^,]+, /,'').replace(/^./,s=>s.toUpperCase()))+'</p>')},
  {seconds:5,body:stage(logo,'<div class="cta">Eight real trophy-draft decisions every day</div>'+
   '<div class="facts">Free. No account required.</div><div><span class="url">PACKONE.PRO</span></div>'+
   '<div class="profile">Link in profile</div>')},
 ];
}
export function questionImage(f,logo) {
 const copy=debateCopies(f);
 return stage(logo,'<h1>What would you take?</h1><p class="sub">'+escape(copy.set)+' · Pick '+
  f.pick_number+' of a real trophy draft</p>'+priorRow(f)+cardRow(f,{letters:true})+
  '<div class="ask">Reply with your pick and why</div>');
}
export function coverImage(f,label,logo) {
 return brand(logo)+'<h1>'+f.tier+'-way split!</h1><p class="sub">'+f.players+' Pack One players · '+
  escape(label)+' · P1P'+f.pick_number+'</p>'+'<div class="cards">'+f.choices.map(c=>card(c)).join('')+
  '</div><div class="coverRight">'+voteRows(f,{thumbs:false})+'</div>';
}
export async function renderFeatured() {
 const data=JSON.parse(await readFile(DIR+'/pick.json','utf8'));
 const f=data.feature;
 if(!f||!Array.isArray(f.choices)||![2,3].includes(f.tier)||
    !f.choices.some(c=>c.id===f.trophy?.id)||
    !f.choices.every(c=>imageUrl(c.image_url))||!imageUrl(f.trophy?.image_url)||
    !f.prior_picks.every(c=>imageUrl(c.image_url)))
  throw Error('Featured rendering requires source-verified card images.');
 const font=async name=>(await readFile('assets/fonts/'+name)).toString('base64');
 const fonts={display:await font('barlow-condensed-700.woff2'),body:await font('source-sans-3-700.woff2')};
 const logo='data:image/svg+xml;base64,'+(await readFile('mobile/assets/images/brand-mark.svg')).toString('base64');
 // Loaded here so the scene builders can be tested without a browser install.
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true});
 try {
  const tab=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  const render=async(html,file,size,jpeg=false)=>{
   await tab.setViewportSize(size);
   await tab.setContent(html,{waitUntil:'domcontentloaded',timeout:30000});
   await tab.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>40),
    null,{timeout:45000});
   await tab.evaluate(()=>document.fonts.ready);
   // Clipped copy or cards would publish a broken frame: fail instead.
   const overflow=await tab.evaluate(()=>{
    const frame=document.querySelector('.frame').getBoundingClientRect();
    return [...document.querySelectorAll('h1,h2,.sub,.card,.vote,.cta,.url,.profile,.ask,.priors')]
     .some(e=>{const r=e.getBoundingClientRect();return r.right>frame.right+1||r.bottom>frame.bottom+1;});
   });
   if(overflow)throw Error('Featured frame '+file+' overflows its canvas.');
   await tab.screenshot({path:DIR+'/'+file,...(jpeg?{type:'jpeg',quality:80}:{type:'png'})});
  };
  await render(page(fonts,coverImage(f,data.copy.label,logo),'horizontal'),'featured-cover.jpg',
   {width:1200,height:630},true);
  await render(page(fonts,questionImage(f,logo),'post'),'debate-question.jpg',{width:1200,height:1500},true);
  const shots=debateScenes(f,logo);
  for(let i=0;i<shots.length;i++)
   await render(page(fonts,shots[i].body),'scene-'+i+'.png',{width:1080,height:1920});
  const total=shots.reduce((n,s)=>n+s.seconds,0);
  if(total!==FEATURED_AUDIO_SECONDS)throw Error('Debate scenes must total the soundtrack length.');
  const soundtrack=buildFeaturedSoundtrack();
  await writeFile(DIR+'/featured-original-music.wav',soundtrack.wav);
  const inputs=shots.flatMap((scene,i)=>['-loop','1','-framerate','30','-t',String(scene.seconds),
   '-i',DIR+'/scene-'+i+'.png']);
  const graph=shots.map((_,i)=>'['+i+':v]fps=30,scale=1080:1920,setsar=1[v'+i+']').join(';')+';'+
   shots.map((_,i)=>'[v'+i+']').join('')+
   'concat=n='+shots.length+':v=1:a=0,format=yuv420p[out]';
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y',...inputs,
   '-i',DIR+'/featured-original-music.wav',
   '-filter_complex',graph,'-map','[out]','-map',shots.length+':a:0',
   '-c:v','libx264','-preset','veryfast','-crf','23',
   '-c:a','aac','-b:a','128k','-ac','2','-ar','44100',
   '-t',String(FEATURED_AUDIO_SECONDS),'-movflags','+faststart',
   DIR+'/featured-short.mp4'],{timeout:180000});
  const {stdout}=await run('ffprobe',['-hide_banner','-v','error',
   '-show_entries','stream=codec_type,codec_name,width,height:format=duration','-of','json',
   DIR+'/featured-short.mp4']);
  const probe=JSON.parse(stdout);
  const duration=Number(probe.format?.duration);
  const video=probe.streams?.find(s=>s.codec_type==='video');
  const audio=probe.streams?.find(s=>s.codec_type==='audio');
  if(Math.abs(duration-FEATURED_AUDIO_SECONDS)>0.1||video?.codec_name!=='h264'||
     video?.width!==1080||video?.height!==1920||audio?.codec_name!=='aac')
   throw Error('Featured Short audio/video verification failed: no reliable AAC soundtrack.');
  const question=(await readFile(DIR+'/debate-question.jpg')).length;
  if(question>1_000_000)throw Error('Bluesky question image exceeds 1MB.');
  await writeFile(DIR+'/render.json',JSON.stringify({day:f.day,puzzle_id:f.puzzle_id,
   template_version:DEBATE_TEMPLATE_VERSION,duration_seconds:duration,width:1080,height:1920,
   scene_seconds:shots.map(s=>s.seconds),real_card_art:true,poster_ready:true,
   question_image:{width:1200,height:1500,bytes:question,shows_results:false},
   audio_track:true,audio_source:FEATURED_AUDIO_VERSION,audio_stats:soundtrack.stats,
  },null,2)+'\n');
  return {rendered:true,day:f.day,video_seconds:duration};
 } finally {await browser.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 renderFeatured().then(x=>console.log(JSON.stringify(x)))
  .catch(e=>{console.error('Featured video rendering failed: '+e.message);process.exitCode=1;});
}
