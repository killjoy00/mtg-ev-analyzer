// Render a real-card, data-derived cover and silent vertical Short from yesterday's pick.
// All source card art URLs come from the verified immutable puzzle payload.
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {imageUrl,formatPercent} from './featured-pick.mjs';

const DIR='artifacts/featured-pick',run=promisify(execFile);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const card=(c,compact=false)=>
 '<div class="card '+(compact?'compact':'')+'"><img src="'+escape(imageUrl(c.image_url))+
 '" alt="'+escape(c.name)+'"><div class="cardname">'+escape(c.name)+'</div></div>';
const head=(h,sub='')=>'<div class="kicker">PACK ONE · YESTERDAY\'S PICK</div>'+
 '<h1>'+escape(h)+'</h1>'+(sub?'<p class="subtitle">'+escape(sub)+'</p>':'');
const frame=body=>'<main class="frame"><div class="brand"><span class="mark">P¹</span>'+
 '<span>PACK ONE</span></div>'+body+'<footer>REAL DRAFTERS · REAL TROPHY DRAFTS · PACKONE.PRO</footer></main>';
const css=font=>[
 '@font-face{font-family:Barlow;src:url(data:font/woff2;base64,'+font+') format("woff2");font-weight:700}',
 '*{box-sizing:border-box}html,body{padding:0;margin:0;height:100%;font-family:Arial,sans-serif;background:#0d1828;color:#fff}',
 '.frame{height:100%;width:100%;position:relative;overflow:hidden;padding:80px 66px 85px;',
 'background:radial-gradient(ellipse at 90% 0%,#245a94 0%,#112640 48%,#0d1828 85%)}',
 '.brand{font-family:Barlow,Arial,sans-serif;font-size:42px;letter-spacing:4px;display:flex;align-items:center;gap:22px;color:#e9f5ff}',
 '.mark{font-size:51px;color:#91cbff;border:3px solid #91cbff;border-radius:14px;padding:5px 15px;letter-spacing:0}',
 '.kicker{color:#86c7ff;font-size:25px;letter-spacing:2px;font-weight:700;margin-top:80px}',
 'h1{font-family:Barlow,Arial,sans-serif;font-size:94px;line-height:1.02;margin:25px 0 25px;letter-spacing:1px}',
 'h2{font-family:Barlow,Arial,sans-serif;font-size:60px;line-height:1.03;margin:26px 0}',
 '.subtitle{font-size:34px;color:#d1deec;line-height:1.27;margin-top:8px}',
 '.panel{border:2px solid #4f789b;background:#132d4b;border-radius:28px;padding:24px;margin-top:48px}',
 '.big{font-family:Barlow,Arial,sans-serif;font-size:125px;color:#9bd7ff;font-weight:700;line-height:1}',
 '.stats{font-size:40px;font-weight:700;margin-top:10px;color:#fff}',
 '.cards{display:flex;gap:15px;justify-content:space-between;align-items:flex-start;margin-top:75px}',
 '.card{width:31%;min-width:0;text-align:center}',
 '.card img{width:100%;aspect-ratio:0.716;object-fit:contain;object-position:center top;border-radius:18px;',
 'background:#071423;box-shadow:0 15px 35px #0009}',
 '.cardname{font-size:29px;font-weight:700;line-height:1.16;margin-top:18px}',
 '.card.compact{width:18%;}.card.compact .cardname{font-size:22px}',
 '.choices{margin-top:85px;display:flex;flex-direction:column;gap:25px}',
 '.vote{border:2px solid #4d7899;border-radius:25px;padding:26px 28px;background:#15314f}',
 '.voteHead{display:flex;justify-content:space-between;font-size:34px;align-items:center;gap:20px;font-weight:700}',
 '.vote strong{font-family:Barlow,Arial,sans-serif;font-size:61px;color:#a6d8ff}',
 '.bar{height:20px;margin-top:20px;background:#34516b;border-radius:12px;overflow:hidden}',
 '.bar span{display:block;height:100%;border-radius:12px;background:linear-gradient(90deg,#65b3ed,#a9ddff)}',
 '.trophy{width:55%;margin:65px auto 25px;text-align:center}.trophy .card{width:100%}.trophy img{width:100%;border-radius:16px}',
 '.trophy .cardname{font-size:42px}.reveal{font-size:39px;text-align:center;color:#cae8ff}',
 '.cta{font-family:Barlow,Arial,sans-serif;font-size:107px;font-weight:700;line-height:1.05;margin-top:290px}',
 '.url{background:#fff;color:#103352;font-family:Barlow,Arial,sans-serif;font-size:81px;font-weight:700;',
 'border-radius:26px;padding:30px 42px;display:inline-block;margin-top:55px}',
 'footer{position:absolute;bottom:50px;left:66px;right:66px;font-size:22px;font-weight:700;letter-spacing:1.1px;',
 'color:#8dafcd;text-align:center}',
 '.horizontal.frame{padding:28px 48px 32px}.horizontal .brand{font-size:30px;gap:12px}',
 '.horizontal .mark{font-size:35px;padding:2px 10px;border-width:2px;border-radius:9px}',
 '.horizontal h1{font-size:56px;margin:9px 0 10px}.horizontal .kicker{font-size:17px;margin-top:13px}',
 '.horizontal .subtitle{font-size:22px}.horizontal .cards{margin:16px 0 0;gap:18px;justify-content:flex-start}',
 '.horizontal .card{width:187px}.horizontal .card img{border-radius:9px}.horizontal .cardname{font-size:17px;margin-top:7px}',
 '.horizontal .coverRight{position:absolute;left:710px;top:155px;right:38px}',
 '.horizontal .vote{padding:13px;margin-bottom:12px;border-radius:12px}.horizontal .voteHead{font-size:20px}',
 '.horizontal .vote strong{font-size:40px}.horizontal footer{font-size:12px;bottom:14px;left:48px;right:48px}',
].join('');
function document(body,font) {
 return '<!doctype html><html><head><meta charset="utf-8"><style>'+css(font)+
 '</style></head><body>'+body+'</body></html>';
}
function votes(f,small=false) {
 return f.choices.map(c=>
  '<div class="vote"><div class="voteHead"><span>'+escape(c.name)+
  '</span><strong>'+formatPercent(c.pct)+'%</strong></div>'+
  (small?'':'<div class="bar"><span style="width:'+Math.min(100,c.pct)+'%"></span></div>')+
  '</div>').join('');
}
function scenes(f) {
 return [
  {seconds:2,body:frame(head(f.tier+'-WAY DRAFT DEBATE',
    f.players+' players · '+f.environment.replace('-',' ').toUpperCase()+' · P1P'+f.pick_number)+
    '<div class="panel"><div class="big">'+f.tier+' CHOICES</div><div class="stats">ONE TROPHY DRAFT</div></div>')},
  {seconds:3,body:frame(head('YOUR PICKS SO FAR','The same draft, the same pack.')+
    '<div class="cards" style="flex-wrap:wrap;gap:20px;justify-content:center">'+
    f.prior_picks.slice(0,5).map(c=>card(c,true)).join('')+'</div>')},
  {seconds:4,body:frame(head('WHAT WOULD YOU TAKE?','Choose before the reveal.')+
    '<div class="cards">'+f.choices.map(c=>card(c)).join('')+'</div>')},
  {seconds:4,body:frame(head('THE COMMUNITY VOTED',f.players+' distinct Pack One players')+
    '<div class="choices">'+votes(f)+'</div>')},
  {seconds:4,body:frame(head('THE TROPHY DRAFTER TOOK...','A real successful draft decision')+
    '<div class="trophy">'+card(f.trophy)+'</div>'+
    '<div class="reveal">Only '+formatPercent(f.trophy.pct)+'% of players made that choice.</div>')},
  {seconds:3,body:frame('<div class="cta">WHAT WOULD<br>YOU PICK?</div>'+
    '<p class="subtitle">Eight decisions. Your call.</p>'+
    '<div class="url">PACKONE.PRO</div>')},
 ];
}
export async function renderFeatured() {
 const data=JSON.parse(await readFile(DIR+'/pick.json','utf8'));
 const f=data.feature;
 if(!f||!Array.isArray(f.choices)||![2,3].includes(f.tier)||
    !f.choices.every(c=>imageUrl(c.image_url))||!imageUrl(f.trophy?.image_url))
  throw Error('Featured rendering requires source-verified card images.');
 const font=(await readFile('assets/fonts/barlow-condensed-700.woff2')).toString('base64');
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  const render=async(body,file,wide=false)=>{
   await page.setViewportSize({width:wide?1200:1080,height:wide?630:1920});
   await page.setContent(document(body,font),{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>100),
    null,{timeout:45000});
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:DIR+'/'+file,...(wide?{type:'jpeg',quality:78}:{type:'png'})});
  };
  const cover='<main class="frame horizontal"><div class="brand"><span class="mark">P¹</span> PACK ONE</div>'+
   head(f.tier+'-WAY SPLIT!',f.players+' drafters · '+data.copy.label+' · P1P'+f.pick_number)+
   '<div class="cards">'+f.choices.map(c=>card(c)).join('')+'</div>'+
   '<div class="coverRight">'+votes(f,true)+'</div>'+
   '<footer>YESTERDAY\'S MOST DEBATED PICK · PACKONE.PRO</footer></main>';
  await render(cover,'featured-cover.jpg',true);
  const shots=scenes(f);
  for(let i=0;i<shots.length;i++)await render(shots[i].body,'scene-'+i+'.png');
  const inputs=shots.flatMap((scene,i)=>['-loop','1','-framerate','30','-t',String(scene.seconds),
   '-i',DIR+'/scene-'+i+'.png']);
  const graph=shots.map((_,i)=>'['+i+':v]fps=30,scale=1080:1920,setsar=1[v'+i+']').join(';')+';'+
   shots.map((_,i)=>'[v'+i+']').join('')+
   'concat=n='+shots.length+':v=1:a=0,format=yuv420p[out]';
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y',...inputs,
   '-filter_complex',graph,'-map','[out]','-an','-c:v','libx264',
   '-preset','veryfast','-crf','25','-movflags','+faststart',DIR+'/featured-short.mp4'],
   {timeout:180000});
  const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration',
   '-of','default=noprint_wrappers=1:nokey=1',DIR+'/featured-short.mp4']);
  const duration=Number(stdout.trim());
  if(Math.abs(duration-20)>0.1)throw Error('Featured Short duration failed validation: '+duration);
  await writeFile(DIR+'/render.json',JSON.stringify({day:f.day,puzzle_id:f.puzzle_id,
   duration_seconds:duration,width:1080,height:1920,real_card_art:true,poster_ready:true},null,2)+'\n');
  return {rendered:true,day:f.day,video_seconds:duration};
 } finally {await browser.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 renderFeatured().then(x=>console.log(JSON.stringify(x)))
  .catch(e=>{console.error('Featured video rendering failed: '+e.message);process.exitCode=1;});
}
