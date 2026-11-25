// Issue #1805: comparison-only creative previews. No credentials, live calls or
// publisher modifications. Use the existing verified anonymized preview fixture.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {imageUrl,formatPercent} from './featured-pick.mjs';
import {assertDebatable,setLabel,otherVotePercent,debateObservation,graphemes} from './featured-debate.mjs';
const run=promisify(execFile),root='artifacts/featured-pick',dir=root+'/social-v3-review';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letter=i=>String.fromCharCode(65+i);
const context=f=>setLabel(f)+' · P1P'+f.pick_number;
const hook=f=>f.pick_number===1?'Your first pick?':'What’s your pick '+f.pick_number+'?';
const label=(f,i)=>letter(i)+' · '+f.choices[i].name;
const thumb=(c,cls='')=>'<img class="'+cls+'" src="'+esc(imageUrl(c.image_url))+'" alt="'+esc(c.name)+'">';
const choices=(f,{focus=null}={})=>'<div class="choices '+(f.tier===2?'two':'')+'">'+f.choices.map((c,i)=>
 '<div class="choice '+(focus===i?'focus':'')+'">'+thumb(c)+'<div class="choice-label"><b>'+letter(i)+'</b><span>'+esc(c.name)+'</span></div></div>').join('')+'</div>';
const prior=f=>f.prior_picks.length?'<div class="prior"><div class="eyebrow">YOUR PICKS SO FAR</div><div class="prior-grid '+(f.prior_picks.length>7?'dense':'')+'">'+
 f.prior_picks.map(c=>'<div>'+thumb(c)+'<span>'+esc(c.name)+'</span></div>').join('')+'</div></div>':
 '<div class="prior"><div class="eyebrow">FIRST PICK · NO PRIOR CARDS</div></div>';
const header=(f,logo)=>'<header><div class="brand"><img src="'+logo+'" alt="">PACK ONE</div><span>'+esc(context(f))+'</span></header>';
const bottom=(txt='Pick a card before the reveal')=>'<footer>'+esc(txt)+'</footer>';
const stage=(f,logo,body,foot)=>header(f,logo)+'<section>'+body+'</section>'+bottom(foot);
const time=(n)=>'<div class="timer"><span>LOCK IN YOUR PICK</span><strong>'+n+'</strong><div class="track"><i style="width:'+n/3*100+'%"></i></div></div>';
const comparison=(f,logo,n=null)=>stage(f,logo,'<div class="eyebrow">REAL TROPHY DRAFT</div><h1>'+esc(hook(f))+'</h1>'+
 prior(f)+choices(f)+(n===null?'<div class="prompt">A, B'+(f.tier===3?' or C':'')+'?</div>':time(n)),n===null?'Pause if you need a closer look':'');
const focusCard=(f,logo,i)=>stage(f,logo,'<div class="eyebrow">OPTION '+letter(i)+' OF '+f.tier+'</div><h1 class="card-title">'+esc(f.choices[i].name)+'</h1>'+
 '<div class="hero-card">'+thumb(f.choices[i])+'</div><div class="step-dots">'+f.choices.map((_,j)=>'<i class="'+(i===j?'active':'')+'"></i>').join('')+'</div>','Compare each card, then decide.');
const results=(f,logo,step)=>stage(f,logo,'<div class="eyebrow">THE COMMUNITY PICKED</div><h1>'+f.players+' players</h1>'+
 '<div class="results">'+f.choices.map((c,i)=>'<div class="result">'+thumb(c)+'<div><div class="result-label"><b>'+letter(i)+'</b> '+esc(c.name)+'<strong>'+ (i<step?formatPercent(c.pct)+'%':'—')+'</strong></div><div class="track"><i style="width:'+(i<step?c.pct:0)+'%"></i></div></div></div>').join('')+'</div>'+
 (step===f.tier&&otherVotePercent(f)>0?'<p class="other">'+formatPercent(otherVotePercent(f))+'% chose other cards</p>':''),'Share of all '+f.players+' player picks');
const trophy=(f,logo)=>stage(f,logo,'<div class="eyebrow">THE TROPHY DRAFTER PICKED</div><h1 class="card-title">'+esc(f.trophy.name)+'</h1>'+
 '<div class="hero-card trophy">'+thumb(f.trophy)+'</div><p class="observation">'+formatPercent(f.trophy.pct)+'% of Pack One players agreed.</p>','One successful drafter’s choice — not the only valid pick.');
const end=(f,logo)=>stage(f,logo,'<div class="end"><img src="'+logo+'" alt=""><h1>Eight picks.<br>Your call.</h1><p>Free daily Magic draft challenge</p><strong>PACKONE.PRO</strong></div>','Link in channel profile');
export function previewConcept(f,logo,style='quick'){
 assertDebatable(f);
 if(!['quick','closeup'].includes(style))throw Error('Unknown preview concept');
 const shots=[{seconds:style==='quick'?5:3,body:comparison(f,logo)}];
 if(style==='closeup')for(let i=0;i<f.tier;i++)shots.push({seconds:3,body:focusCard(f,logo,i)});
 for(const n of [3,2,1])shots.push({seconds:1,body:comparison(f,logo,n)});
 for(let n=1;n<=f.tier;n++)shots.push({seconds:n===f.tier?3:1,body:results(f,logo,n)});
 shots.push({seconds:4,body:trophy(f,logo)},{seconds:3,body:end(f,logo)});
 return shots;
}
export function previewQuestion(f,style='quick'){
 assertDebatable(f);
 const opts=f.choices.map((_,i)=>label(f,i)).join('\n');
 const first=f.pick_number===1?'P1P1. Start your draft.':'P1P'+f.pick_number+'. You have '+f.prior_picks.length+' earlier pick'+(f.prior_picks.length===1?'':'s')+' (pictured).';
 const tag='#MTG #MTGDraft';
 const intro=setLabel(f)+' · '+first;
 const ask=style==='quick'?'A, B'+(f.tier===3?' or C':'')+'? What’s your pick?':'Which would you take here, and what would make you change your mind?';
 const variants=[[intro,opts,ask,'Results later today.',tag],[intro,ask,'Options and context in the image. Results later today.',tag]];
 const text=variants.map(p=>p.join('\n\n')).find(t=>graphemes(t)<=300);
 if(!text)throw Error('Preview question too long');
 const reveal=[f.players+' Pack One players:',...f.choices.map(c=>formatPercent(c.pct)+'% · '+c.name),
 ...(otherVotePercent(f)>0?[formatPercent(otherVotePercent(f))+'% · other cards']:[]),'Trophy drafter: '+f.trophy.name+'.','Play free: packone.pro'].join('\n');
 return {text,reveal,alt:context(f)+'. '+(f.prior_picks.length?'Prior picks: '+f.prior_picks.map(c=>c.name).join(', ')+'. ':'First pick. ')+opts.replaceAll('\n',', ')+'. No results shown.'};
}
export function previewGraphic(f,logo,style='quick'){
 const title=style==='quick'?hook(f):'What would you take here?';
 return stage(f,logo,'<div class="eyebrow">REAL TROPHY DRAFT · CHOOSE A CARD</div><h1>'+esc(title)+'</h1>'+
 prior(f)+choices(f)+'<div class="prompt">'+(style==='quick'?'A, B'+(f.tier===3?' or C':'')+'?':'What’s your pick, and why?')+'</div>','Results later today · packone.pro');
}
const css=(fonts)=>`
@font-face{font-family:Barlow;src:url(data:font/woff2;base64,${fonts.display})} @font-face{font-family:Source;src:url(data:font/woff2;base64,${fonts.body})}
*{box-sizing:border-box}body{margin:0;background:#122a46;color:#f7f8fa;font-family:Source,Arial,sans-serif;font-weight:700}
main{width:1080px;height:1920px;padding:145px 155px 350px 72px;display:flex;flex-direction:column;background:#122a46}
header{display:flex;justify-content:space-between;align-items:center;gap:18px;padding-bottom:28px;border-bottom:2px solid #57728d;color:#cfe0f0;font-size:32px}
.brand{display:flex;gap:12px;align-items:center;white-space:nowrap;font-family:Barlow,Arial;font-size:38px;letter-spacing:2px}.brand img{width:48px;height:48px} header>span{text-align:right}
section{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:25px}
.eyebrow{font-size:29px;letter-spacing:2px;color:#a8c9e5}h1{font:700 92px/.98 Barlow,Arial;margin:0;color:#fff}h1.card-title{font-size:68px;line-height:1.04}
.prior{padding:16px 18px;background:#203e5e;border-radius:16px}.prior .eyebrow{font-size:23px;margin-bottom:12px}
.prior-grid{display:flex;gap:10px;flex-wrap:wrap}.prior-grid>div{flex:1;min-width:95px;max-width:190px;display:flex;gap:8px;align-items:center;font-size:23px;line-height:1.05}.prior-grid img{width:54px;height:auto;border-radius:4px}.prior-grid.dense>div{min-width:75px;max-width:105px}.prior-grid.dense span{display:none}.prior-grid.dense img{width:65px}
.choices{display:flex;gap:16px;align-items:flex-start;justify-content:center}.choice{flex:1;min-width:0;max-width:290px}.choices.two .choice{max-width:395px}.choice>img{display:block;width:100%;height:auto;border-radius:16px;border:2px solid #8ba7bd}
.choice-label{display:flex;align-items:flex-start;gap:9px;margin-top:12px;font-size:29px;line-height:1.05}.choice-label b,.result-label b{display:inline-flex;align-items:center;justify-content:center;flex:none;width:37px;height:37px;background:#e6f0fa;color:#1e4d7a;border-radius:8px;font:700 29px Barlow,Arial}
.prompt{font:700 62px Barlow,Arial;text-align:center;color:#e6f0fa}.timer{display:flex;align-items:center;gap:15px;font-size:27px;color:#cfe0f0}.timer strong{font:700 62px Barlow,Arial;color:#fff}.timer .track{flex:1}
.track{height:15px;background:#45617b;border-radius:10px;overflow:hidden}.track i{display:block;height:100%;background:#86c4f0;border-radius:10px}
.hero-card{display:flex;justify-content:center;min-height:0}.hero-card img{width:520px;max-width:100%;height:auto;border-radius:22px;border:3px solid #a8c9e5}.hero-card.trophy img{width:460px;border:6px solid #e5c678}
.step-dots{display:flex;gap:14px;justify-content:center}.step-dots i{width:15px;height:15px;border-radius:50%;background:#55718b}.step-dots i.active{background:#fff}
.results{display:flex;flex-direction:column;gap:16px}.result{display:flex;gap:18px;align-items:center;padding:16px;background:#203e5e;border-radius:16px}.result>img{width:112px;border-radius:8px}.result>div{flex:1;min-width:0}.result-label{display:flex;align-items:center;gap:10px;font-size:30px;line-height:1.03;margin-bottom:14px}.result-label strong{margin-left:auto;white-space:nowrap;font:700 61px Barlow,Arial;color:#b5dfff}
.other,.observation{margin:0;color:#cfe0f0;font-size:35px;line-height:1.2}.observation{text-align:center}.end{text-align:center;display:flex;flex-direction:column;align-items:center;gap:35px}.end>img{width:110px;height:110px}.end h1{font-size:115px}.end p{margin:0;font-size:42px}.end strong{font:700 66px Barlow,Arial;color:#b5dfff}
footer{border-top:2px solid #57728d;padding-top:20px;text-align:center;font-size:29px;color:#cfe0f0;min-height:55px}
main.post{width:1200px;height:1500px;padding:62px 60px 55px}main.post section{gap:26px}main.post .choice{max-width:340px}main.post .choices.two .choice{max-width:460px}main.post .prior-grid>div{max-width:280px}main.post .prior-grid img{width:65px}main.post .choice-label{font-size:35px}main.post h1{font-size:92px}main.post footer{font-size:32px}
`;
const page=(fonts,body,post=false)=>'<!doctype html><meta charset="utf-8"><style>'+css(fonts)+'</style><main class="'+(post?'post':'')+'">'+body+'</main>';
export async function renderSocialReview(f,fonts,logo){
 if(process.env.GITHUB_EVENT_NAME!=='pull_request')throw Error('Review rendering is PR-only');
 await mkdir(dir,{recursive:true});
 const {chromium}=await import('playwright'),browser=await chromium.launch({headless:true});
 try{
  const tab=await browser.newPage({deviceScaleFactor:1});
  async function render(body,file,post=false){
   await tab.setViewportSize(post?{width:1200,height:1500}:{width:1080,height:1920});
   await tab.setContent(page(fonts,body,post),{waitUntil:'domcontentloaded'});
   await tab.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>40),null,{timeout:45000});
   await tab.evaluate(()=>document.fonts.ready);
   const overflow=await tab.evaluate(()=>{
    const m=document.querySelector('main'),s=document.querySelector('section'),b=m.getBoundingClientRect(),sb=s.getBoundingClientRect();
    const rects=[...document.querySelectorAll('section > *, .choice, .choice-label, .result, .result-label, .hero-card img, .prior-grid')].map(e=>e.getBoundingClientRect());
    return rects.some(r=>r.left<b.left-1||r.right>b.right+1||r.top<sb.top-2||r.bottom>sb.bottom+2)||document.documentElement.scrollHeight>innerHeight+1;
   });
   if(overflow)throw Error('Preview layout overflow: '+file);
   await tab.screenshot({path:dir+'/'+file,...(post?{type:'jpeg',quality:82}:{type:'png'})});
  }
  const review=['# Issue #1805 — creative comparison','Real anonymized October 23 Reality Fracture decision, '+f.players+' player picks. Both concepts show the identical decision. No publication.',''];
  for(const style of ['quick','closeup']){
   const shots=previewConcept(f,logo,style),files=[];
   await render(previewGraphic(f,logo,style),style+'-bluesky.jpg',true);
   for(let i=0;i<shots.length;i++){const file=style+'-frame-'+i+'.png';await render(shots[i].body,file);files.push(file);}
   const seconds=shots.reduce((s,x)=>s+x.seconds,0);
   // Use the existing original soundtrack for review only. Loop/fade to the new cut length.
   const inputs=shots.flatMap((s,i)=>['-loop','1','-framerate','30','-t',String(s.seconds),'-i',dir+'/'+files[i]]);
   const graph=shots.map((_,i)=>'['+i+':v]fps=30,setsar=1[v'+i+']').join(';')+';'+shots.map((_,i)=>'[v'+i+']').join('')+'concat=n='+shots.length+':v=1:a=0,format=yuv420p[out]';
   await run('ffmpeg',['-hide_banner','-loglevel','error','-y',...inputs,'-stream_loop','-1','-i',root+'/featured-original-music.wav','-filter_complex_threads','2','-filter_complex',graph,'-map','[out]','-map',shots.length+':a:0','-af','afade=t=out:st='+(seconds-1)+':d=1','-t',String(seconds),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-c:a','aac','-movflags','+faststart',dir+'/'+style+'-short.mp4'],{timeout:240000});
   const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height:format=duration','-of','json',dir+'/'+style+'-short.mp4'])).stdout);
   const v=probe.streams.find(s=>s.codec_type==='video');
   if(v?.width!==1080||v?.height!==1920||v?.codec_name!=='h264'||Math.abs(Number(probe.format.duration)-seconds)>.1||!probe.streams.some(s=>s.codec_name==='aac'))throw Error('Preview encode invalid');
   if((await readFile(dir+'/'+style+'-bluesky.jpg')).length>1_000_000)throw Error('Preview graphic exceeds Bluesky limit');
   const q=previewQuestion(f,style);
   review.push('## '+style+' ('+seconds+' seconds)','Video: '+style+'-short.mp4','Graphic: '+style+'-bluesky.jpg','**Morning post**','',q.text,'','**Alt text**',q.alt,'','**Reply**','',q.reveal,'');
  }
  await writeFile(dir+'/REVIEW.md',review.join('\n'));
 }finally{await browser.close();}
}
