// #1805 automated motion renderer. Review-only until the publishing contract,
// seven-example visual review, and daily fallback/receipt gates are approved.
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {editorialPlan,fetchOracleMetadata} from './social-editorial.mjs';
import {formatPercent,imageUrl} from './featured-pick.mjs';
import {otherVotePercent} from './featured-debate.mjs';
import {buildMotionSoundtrack} from './social-motion-soundtrack.mjs';
const run=promisify(execFile);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters='ABC';
const colors={W:'white',U:'blue',B:'black',R:'red',G:'green'};
const hue={W:'#866a30',U:'#21678e',B:'#53515f',R:'#ad4937',G:'#3c7659'};
const image=(c,cls='')=>'<img class="'+cls+'" src="'+esc(imageUrl(c.image_url))+'" alt="'+esc(c.name)+'">';
const colorLabel=o=>{
 const xs=o.manaFacts.possible;
 return xs.length?xs.map(k=>colors[k]).join(o.manaFacts.hybrid?'/':' + '):'no colored cost shown';
};
const accent=o=>hue[o.manaFacts.possible[0]]||'#1e4d7a';
const brand=logo=>'<div class="brand"><img src="'+logo+'" alt="">PACK ONE</div>';
const stage=(p,logo,body,foot='',progress=0)=>'<header>'+brand(logo)+'<span>'+esc(p.where.toUpperCase())+'</span></header>'+
 '<div class="topline"><i style="width:'+progress+'%"></i></div><section>'+body+'</section><footer>'+esc(foot)+'</footer>';
const title=(k,h,q='')=>'<div class="eyebrow">'+esc(k)+'</div><h1>'+esc(h)+'</h1>'+(q?'<div class="question">'+esc(q)+'</div>':'');
const prior=(f,p)=>f.prior_picks.length?'<div class="prior"><div class="eyebrow">YOUR PRIOR PICKS</div><div class="prior-grid '+(f.prior_picks.length>8?'many':f.prior_picks.length>4?'compact':f.prior_picks.length===1?'single':f.prior_picks.length===2?'pair':'')+'">'+
 f.prior_picks.map(c=>'<div class="prior-card">'+image(c)+'<div><b>'+esc(c.name)+'</b><small>'+esc(c.mana_cost||'')+'</small></div></div>').join('')+'</div></div>':
 '<div class="prior-first">FIRST PICK OF THE DRAFT</div>';
const choices=(f,p)=>'<div class="choices '+(f.tier===2?'two':'')+'">'+f.choices.map((c,i)=>'<div class="choice motion" style="--accent:'+accent(p.options[i])+';--delay:'+i*.10+'">'+
 image(c)+'<div class="option-label"><b>'+letters[i]+'</b><div>'+esc(p.options[i].role)+(p.options[i].role2?'<small>'+esc(p.options[i].role2)+'</small>':'')+'</div></div></div>').join('')+'</div>';
const contextNote=(f,o)=>{
 if(!f.prior_picks.length)return 'First pick — which direction would you take?';
 if(o.manaFacts.exotic)return 'How does this fit the cards you already have?';
 const seen=new Set(f.prior_picks.flatMap(c=>[...(c.mana_cost||'').matchAll(/\{([WUBRG])\}/g)].map(m=>m[1])));
 const added=[...new Set(o.manaFacts.fixed)].filter(k=>!seen.has(k));
 if(added.length)return 'Adds '+added.map(k=>colors[k]).join(' and ')+' to your prior mana costs.';
 if(o.manaFacts.fixed.length)return 'Uses colors already present in your prior picks.';
 return 'How does this fit your draft?';
};
const focus=(f,p,logo,i)=>{
 const o=p.options[i],c=f.choices[i],note=o.evidence.length?
 o.evidence.map(e=>e.evidence.length<=125?e.evidence:('This card '+e.description+'. See card for conditions.')).join(' • '):
 'Printed '+o.type+'; compare its cost and rules text with the other options.';
 return stage(p,logo,'<div class="choice-pill" style="background:'+accent(o)+'">'+letters[i]+' / '+esc(colorLabel(o).toUpperCase())+'</div>'+
 '<h1 class="focus-heading">'+esc(o.role.toUpperCase())+'.</h1><div class="focus-row"><div class="focus-card motion" style="--accent:'+accent(o)+';--delay:0">'+image(c)+'</div>'+
 '<div class="focus-side"><div class="eyebrow">MANA COST</div><div class="mana">'+esc(o.mana||'—')+'</div><hr><h2>'+esc(c.name)+'</h2><p>'+esc(o.costNote)+'</p>'+
 (o.role2?'<p class="minor">'+esc(o.role2)+'</p>':'')+'</div></div><div class="analysis-box"><b>'+ (o.evidence.length?'WHAT IT DOES':'THE TRADE-OFF')+
 '</b><p>'+esc(note)+'</p></div>',contextNote(f,o),20+i*15);
};
const decision=(f,p,logo,n=null)=>stage(p,logo,title('YOUR PICK',n===null?p.question:'Lock in your pick.')+
 prior(f,p)+choices(f,p)+(n===null?'<div class="pick-prompt">'+(f.tier===3?'A, B or C?':'A or B?')+'</div>':
 '<div class="countdown"><span>REVEAL IN</span><strong>'+n+'</strong><div class="count-track"><i style="width:'+n/3*100+'%"></i></div></div>'),
 'Choose before the reveal.',68);
const results=(f,p,logo)=>stage(p,logo,title('THE COMMUNITY PICKED',f.players+' Pack One players.')+
 '<div class="results">'+f.choices.map((c,i)=>'<div class="result">'+image(c)+'<div class="result-content"><div class="result-name"><b style="background:'+accent(p.options[i])+'">'+letters[i]+'</b><span>'+esc(c.name)+'</span><strong>'+formatPercent(c.pct)+'%</strong></div><div class="vote-track"><i style="--pct:'+c.pct+'%;--delay:'+i*.14+';--accent:'+accent(p.options[i])+'"></i></div></div></div>').join('')+'</div>'+
 (otherVotePercent(f)>0?'<div class="other">'+formatPercent(otherVotePercent(f))+'% chose other cards.</div>':''),'Share of all '+f.players+' first picks on this decision.',81);
const trophy=(f,p,logo)=>{
 const i=f.choices.findIndex(c=>c.id===f.trophy.id),o=p.options[i];
 return stage(p,logo,title('THE TROPHY DRAFTER PICKED',f.trophy.name)+
 '<div class="trophy-row"><div class="trophy-card motion" style="--delay:0">'+image(f.trophy)+'</div><div><div class="eyebrow">PLAYER AGREEMENT</div><strong class="big-pct">'+formatPercent(f.trophy.pct)+'%</strong><p>'+esc(o.role)+(o.role2?' · '+esc(o.role2):'')+'</p></div></div>'+
 '<div class="analysis-box"><b>ONE REAL TROPHY DRAFT</b><p>The trophy drafter made this choice. Would you have taken the same card?</p></div>','A trophy pick is not the only valid pick.',93);
};
const ending=(p,logo)=>stage(p,logo,'<div class="end"><img src="'+logo+'" alt=""><h1>Eight picks.<br>Your call.</h1><p>Free daily Magic draft challenge</p><strong>PACKONE.PRO</strong></div>','Link in channel profile',100);
export function motionScenes(f,p,logo){
 const shots=[{kind:'hook',seconds:5,animate:.8,body:stage(p,logo,title('THE DRAFT DILEMMA',p.headline,p.question)+prior(f,p)+
  '<div class="eyebrow">YOUR OPTIONS</div>'+choices(f,p), (f.tier===3?'A, B or C?':'A or B?')+' / '+f.players+' real player picks',5)}];
 for(let i=0;i<f.tier;i++)shots.push({kind:'option',seconds:4,animate:.55,body:focus(f,p,logo,i)});
 shots.push({kind:'choose',seconds:2,animate:.45,body:decision(f,p,logo)});
 for(const n of [3,2,1])shots.push({kind:'countdown',seconds:1,animate:0,body:decision(f,p,logo,n)});
 shots.push({kind:'results',seconds:5,animate:1.4,body:results(f,p,logo)},{kind:'trophy',seconds:4,animate:.6,body:trophy(f,p,logo)},{kind:'cta',seconds:3,animate:.4,body:ending(p,logo)});
 return shots;
}
export function motionGraphic(f,p,logo){
 return stage(p,logo,title('THE DRAFT DILEMMA',p.headline,p.question)+prior(f,p)+
 '<div class="eyebrow">CHOOSE A CARD</div>'+choices(f,p), 'What are you taking, and why? / Results later today.',100);
}
const css=fonts=>`
@font-face{font-family:Barlow;src:url(data:font/woff2;base64,${fonts.display}) format("woff2");font-weight:700}
@font-face{font-family:Source;src:url(data:font/woff2;base64,${fonts.body}) format("woff2");font-weight:700}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;background:#f4f6f8;color:#102c43;font:700 35px/1.32 Source,Arial,sans-serif}
main{position:relative;width:1080px;height:1920px;padding:128px 156px 355px 56px;display:flex;flex-direction:column;gap:17px;border-top:14px solid #1e4d7a;overflow:hidden}
main:before{content:"";position:absolute;left:0;top:106px;bottom:355px;width:16px;background:#1e4d7a}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:12px;border-bottom:2px solid #b9c9d4}
.brand{display:flex;gap:13px;align-items:center;white-space:nowrap;font:700 43px Barlow,Arial;color:#1e4d7a}.brand img{width:50px;height:50px}
header>span{text-align:right;font-size:30px;color:#526c80}
.topline{height:7px;background:#d9e2ea;flex:none}.topline i{display:block;height:100%;background:#1e4d7a}
section{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:17px}section>*{flex-shrink:0}
.eyebrow{font:700 31px Source,Arial;letter-spacing:.4px;color:#4f687c}.question{color:#1e4d7a;font-size:43px;line-height:1.32}
h1{font:700 78px/1.14 Barlow,Arial;margin:0;overflow-wrap:anywhere}h2{font:700 46px/1.14 Barlow,Arial;margin:0;overflow-wrap:anywhere}
.prior{margin-top:10px}.prior .eyebrow{font-size:27px;margin-bottom:10px}
.prior-first{font-size:29px;color:#536c80;background:#e5edf3;padding:18px;border-radius:12px}
.prior-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.prior-card{display:flex;align-items:center;gap:9px;padding:8px;background:#e3ecf3;border-radius:12px;min-width:0;line-height:1.25;font-size:26px}
.prior-card img{width:64px;flex:none;border-radius:5px}.prior-card div{min-width:0;overflow-wrap:anywhere}.prior-card small{display:block;margin-top:5px;font-size:20px;color:#546e80}
.prior-grid.single{grid-template-columns:minmax(0,1fr);max-width:520px}.prior-grid.pair{grid-template-columns:repeat(2,minmax(0,1fr))}
.prior-grid.compact{grid-template-columns:repeat(4,minmax(0,1fr))}.prior-grid.compact .prior-card{font-size:22px}.prior-grid.compact img{width:49px}
.prior-grid.many{grid-template-columns:repeat(5,minmax(0,1fr))}.prior-grid.many .prior-card{font-size:17px;padding:5px;gap:5px}.prior-grid.many img{width:39px}.prior-grid.many small{font-size:15px}
.choices{display:flex;align-items:flex-start;justify-content:center;gap:14px}
.choice{flex:1;min-width:0;max-width:278px}.choices.two .choice{max-width:360px}
.choice>img{width:100%;display:block;border:4px solid var(--accent);border-radius:12px}
.option-label{display:flex;align-items:flex-start;gap:9px;margin-top:10px;color:var(--accent);font-size:31px;line-height:1.30;overflow-wrap:anywhere}
.option-label b,.result-name b{background:var(--accent,#1e4d7a);color:white;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;width:43px;height:43px;font:700 37px Barlow,Arial;flex:none}
.option-label small{display:block;color:#536c80;font-size:23px;line-height:1.30;margin-top:6px}
.choice-pill{align-self:flex-start;border-radius:9px;color:white;padding:7px 14px;font-size:28px;text-transform:uppercase}
.focus-heading{font-size:78px}.focus-row{display:flex;align-items:center;gap:35px;margin:12px 0}.focus-card{width:445px;flex:none}.focus-card img{width:100%;display:block;border:5px solid var(--accent);border-radius:15px}
.focus-side{flex:1;min-width:0}.focus-side p{font-size:34px;margin:18px 0;color:#203c52;overflow-wrap:anywhere}.focus-side .minor{font-size:27px;color:#506d83}.mana{font:700 55px/1.05 Barlow,Arial;color:#1e4d7a;overflow-wrap:anywhere}
hr{border:0;border-top:2px solid #becbd5;margin:24px 0}
.analysis-box{background:#dcecf5;padding:20px 22px;border-radius:15px;font-size:32px;line-height:1.30;overflow-wrap:anywhere}.analysis-box b{font-size:27px;color:#1e4d7a}.analysis-box p{margin:8px 0 0}
.pick-prompt{text-align:center;font:700 62px Barlow,Arial;color:#1e4d7a}.countdown{display:flex;gap:20px;align-items:center;color:#1e4d7a}.countdown strong{font:700 70px Barlow,Arial}.countdown span{font-size:28px}
.count-track,.vote-track{background:#dce5ed;border-radius:10px;overflow:hidden;height:20px;flex:1}.count-track i{display:block;height:100%;background:#1e4d7a}
.results{display:flex;flex-direction:column;gap:19px}.result{display:flex;gap:20px;align-items:center;background:#e4edf3;padding:17px;border-radius:16px}
.result img{width:118px;border-radius:9px;flex:none}.result-content{flex:1;min-width:0}.result-name{display:flex;gap:12px;align-items:center;font-size:31px;line-height:1.14;margin-bottom:16px}.result-name span{flex:1;min-width:0;overflow-wrap:anywhere}
.result-name strong{font:700 66px Barlow,Arial;white-space:nowrap;color:#1e4d7a}
.vote-track i{display:block;height:100%;width:var(--pct);background:var(--accent);transform-origin:left center;transform:scaleX(clamp(0,(var(--entry) - var(--delay))/max(.01,1 - var(--delay)),1))}
.other{font-size:31px;color:#526b80}.trophy-row{display:flex;align-items:center;gap:35px}.trophy-card{width:445px;flex:none}.trophy-card img{width:100%;display:block;border:6px solid #a98746;border-radius:15px}
.trophy-row>div+div{min-width:0;flex:1}.trophy-row p{font-size:35px;overflow-wrap:anywhere}.big-pct{font:700 112px Barlow,Arial;color:#1e4d7a}
.end{display:flex;flex-direction:column;align-items:center;text-align:center;gap:32px}.end img{width:126px;height:126px}.end h1{font-size:118px}.end p{font-size:48px;margin:0}.end strong{font:700 82px Barlow,Arial;color:#1e4d7a}
footer{border-top:2px solid #b9c9d4;padding-top:13px;color:#203d54;font-size:30px;line-height:1.30;flex:none;min-height:50px}
.motion{--local:clamp(0,(var(--entry) - var(--delay))/max(.01,1 - var(--delay)),1);transform:translateY(calc((1 - var(--local))*30px));opacity:calc(.15 + .85*var(--local))}
main.post{width:1200px;height:1500px;padding:58px 58px 47px;gap:13px}main.post:before{top:58px;bottom:47px}
main.post section{gap:18px}main.post .choice{max-width:342px}main.post .choices.two .choice{max-width:460px}main.post .prior-card{font-size:29px}main.post .prior-grid.compact .prior-card{font-size:24px}main.post .prior-grid.many .prior-card{font-size:20px}main.post h1{font-size:86px}main.post footer{font-size:32px}
/* Choose the least compact layout which actually fits the safe section. */
main[data-density="1"] section{gap:12px}
main[data-density="1"] h1{font-size:70px}
main.post[data-density="1"] h1{font-size:76px}
main[data-density="1"] .question{font-size:37px}
main[data-density="1"] .choices.two .choice{max-width:320px}
main.post[data-density="1"] .choices.two .choice{max-width:395px}
main[data-density="1"] .choice{max-width:255px}
main.post[data-density="1"] .choice{max-width:305px}
main[data-density="1"] .focus-card,main[data-density="1"] .trophy-card{width:405px}
main[data-density="1"] .analysis-box{font-size:29px;padding:15px 19px}
main[data-density="1"] .option-label{font-size:28px}
main[data-density="1"] .prior-card{font-size:23px}
main[data-density="1"] .prior-card img{width:52px}
main[data-density="1"] .prior-grid.many .prior-card{font-size:17px}
main[data-density="1"] .prior-grid.many img{width:39px}
main[data-density="2"] section{gap:9px}
main[data-density="2"] h1{font-size:62px}
main.post[data-density="2"] h1{font-size:68px}
main[data-density="2"] .question{font-size:33px}
main[data-density="2"] .eyebrow{font-size:26px}
main[data-density="2"] .choices.two .choice{max-width:292px}
main.post[data-density="2"] .choices.two .choice{max-width:345px}
main[data-density="2"] .choice{max-width:230px}
main.post[data-density="2"] .choice{max-width:275px}
main[data-density="2"] .focus-card,main[data-density="2"] .trophy-card{width:365px}
main[data-density="2"] .focus-row,main[data-density="2"] .trophy-row{gap:24px}
main[data-density="2"] .focus-side h2{font-size:38px}
main[data-density="2"] .focus-side p{font-size:29px}
main[data-density="2"] .analysis-box{font-size:27px;padding:13px 16px}
main[data-density="2"] .option-label{font-size:26px}
main[data-density="2"] .prior-card{font-size:21px;padding:6px}
main[data-density="2"] .prior-card img{width:45px}
main[data-density="2"] .prior-grid.many .prior-card{font-size:17px}
main[data-density="2"] .prior-grid.many img{width:36px}
main[data-density="2"] .result{padding:12px;gap:14px}
main[data-density="2"] .result-name{font-size:27px}
main[data-density="2"] .result img{width:100px}
main[data-density="2"] .result-name strong{font-size:58px}
`;
const page=(fonts,body,post)=>'<!doctype html><html><head><meta charset="utf-8"><style>'+css(fonts)+'</style></head><body><main style="--entry:1" class="'+(post?'post':'')+'">'+body+'</main></body></html>';
const fixed=s=>s.toFixed(9);
export async function renderOne({f,plan,fonts,logo,browser,out,previewOnly=true}){
 await mkdir(out,{recursive:true});
 const temp=out+'/frames';await mkdir(temp,{recursive:true});
 const tab=await browser.newPage({deviceScaleFactor:1});
 const shots=motionScenes(f,plan,logo),manifest=['ffconcat version 1.0'],cues=[];
 let index=0,at=0,last='';
 const layouts=[];
 async function load(body,post=false,label='unknown'){
  await tab.setViewportSize(post?{width:1200,height:1500}:{width:1080,height:1920});
  await tab.setContent(page(fonts,body,post),{waitUntil:'domcontentloaded',timeout:30000});
  await tab.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>40),null,{timeout:45000});
  await tab.evaluate(()=>document.fonts.ready);
  // Reject if actual content is outside the safe layout, not only the canvas.
  const layout=await tab.evaluate(()=>{
   const main=document.querySelector('main');
   function validate(){
   const sec=document.querySelector('section').getBoundingClientRect();
   for(const e of document.querySelectorAll('section > *, .prior-card,.choice,.result,.focus-row,.trophy-row')){
    const r=e.getBoundingClientRect();
    if(r.left<sec.left-2||r.right>sec.right+2||r.top<sec.top-2||r.bottom>sec.bottom+2)return (e.className||e.tagName)+' outside '+JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom),safeTop:Math.round(sec.top),safeBottom:Math.round(sec.bottom)});
    // Glyph ink can extend past a line box without being clipped. Keep
    // strict safe-area bounds and inspect actual text rectangles below.
    const style=getComputedStyle(e);
    if(e.scrollWidth>e.clientWidth+3||
       (['hidden','clip','scroll','auto'].includes(style.overflowY)&&e.scrollHeight>e.clientHeight+3))
      return 'clipped '+(e.className||e.tagName)+' '+e.scrollWidth+'/'+e.clientWidth+' '+e.scrollHeight+'/'+e.clientHeight;
   }
   // Inspect actual text ranges inside the safe section, including text
   // whose ink extends beyond an otherwise visible line box.
   const walk=document.createTreeWalker(document.querySelector('section'),NodeFilter.SHOW_TEXT);
   let node;
   while((node=walk.nextNode())){
    if(!node.textContent.trim())continue;
    const range=document.createRange();range.selectNodeContents(node);
    for(const r of range.getClientRects())
     if(r.left<sec.left-2||r.right>sec.right+2||r.top<sec.top-2||r.bottom>sec.bottom+2)
      return 'text outside safe section: '+node.textContent.slice(0,60);
   }
   const foot=document.querySelector('footer').getBoundingClientRect();
   if(foot.bottom>innerHeight-20)return 'footer';
   return null;
   }
   let error;
   for(let density=0;density<=2;density++){
    main.dataset.density=String(density);
    error=validate();
    if(!error)return {density,error:null};
   }
   return {density:2,error};
  });
  if(layout.error)throw Error('Unsafe motion layout: '+f.day+' '+label+' '+layout.error);
  layouts.push({scene:label,density:layout.density});
 }
 async function snap(name,progress=1,duration=null){
  await tab.evaluate(v=>document.querySelector('main').style.setProperty('--entry',String(v)),progress);
  await tab.screenshot({path:name,type:'jpeg',quality:86,animations:'disabled'});
  if(duration!==null){
   // All file names are generated locally, no paths derived from player data.
   last=name.split('/').at(-1);
   manifest.push("file '"+last+"'","option framerate 30","duration "+fixed(duration));
  }
 }
 try{
  await load(motionGraphic(f,plan,logo),true,'bluesky');await snap(out+'/bluesky.jpg');
  const graphicBytes=(await readFile(out+'/bluesky.jpg')).length;
  if(graphicBytes>1_000_000)throw Error('Bluesky graphic exceeds 1MB');
  for(const [s,shot] of shots.entries()){
   await load(shot.body,false,shot.kind+'-'+s);cues.push({kind:shot.kind,at});
   const n=Math.round(shot.animate*15);
   for(let i=0;i<n;i++){
    const raw=(i+1)/n,progress=1-(1-raw)**3;
    await snap(temp+'/f'+String(index++).padStart(4,'0')+'.jpg',progress,1/15);
   }
   const hold=shot.seconds-n/15;
   await snap(temp+'/f'+String(index++).padStart(4,'0')+'.jpg',1,hold);
   // Each final hold is separately inspectable without opening the MP4.
   await snap(out+'/frame-'+String(s).padStart(2,'0')+'-'+shot.kind+'.jpg');
   at+=shot.seconds;
  }
  manifest.push("file '"+last+"'","option framerate 30");
  await writeFile(temp+'/timeline.ffconcat',manifest.join('\n')+'\n');
  const sound=buildMotionSoundtrack(at,cues);
  await writeFile(temp+'/music.wav',sound.wav);
  const mp4=out+'/short.mp4';
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',temp+'/timeline.ffconcat','-i',temp+'/music.wav',
   '-map','0:v','-map','1:a','-vf','fps=30,setsar=1,format=yuv420p','-t',String(at),'-c:v','libx264','-threads','2','-preset','fast','-crf','22',
   '-c:a','aac','-b:a','96k','-ar','44100','-movflags','+faststart',mp4],{timeout:180000});
  const probe=JSON.parse((await run('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height,r_frame_rate:format=duration','-of','json',mp4])).stdout);
  const v=probe.streams.find(s=>s.codec_type==='video');
  if(v?.width!==1080||v?.height!==1920||v?.codec_name!=='h264'||v.r_frame_rate!=='30/1'||Math.abs(Number(probe.format.duration)-at)>.1||
   !probe.streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'))throw Error('Motion MP4 failed validation');
  await writeFile(out+'/editorial.json',JSON.stringify(plan,null,2)+'\n');
  await writeFile(out+'/POSTS.md',['# '+plan.where,'**Morning post**','',plan.morning,'','**Image alt text**','',plan.alt,'','**Afternoon reply**','',plan.reply,'','**YouTube title**','',plan.youtube.title,'','**Description**','',plan.youtube.description,''].join('\n'));
  await writeFile(out+'/render.json',JSON.stringify({day:f.day,puzzle_id:f.puzzle_id,template:plan.version,seconds:at,
   width:1080,height:1920,frames_per_second:30,choices:f.tier,real_card_art:true,preview_only:previewOnly,
   sha256:{image:createHash('sha256').update(await readFile(out+'/bluesky.jpg')).digest('hex'),video:createHash('sha256').update(await readFile(mp4)).digest('hex'),plan:createHash('sha256').update(JSON.stringify(plan)).digest('hex')},
   question_image:{width:1200,height:1500,bytes:graphicBytes,shows_results:false},audio:sound.stats,coverage:plan.coverage,cues,layouts},null,2)+'\n');
  return {day:f.day,pick:f.pick_number,tier:f.tier,players:f.players,kind:plan.kind,headline:plan.headline,coverage:plan.coverage,seconds:at,graphic_bytes:graphicBytes};
 }finally{await tab.close();await rm(temp,{recursive:true,force:true});}
}
export async function renderMotionAssets(f,plan,out,{previewOnly=true}={}){
 const fonts={display:(await readFile('assets/fonts/barlow-condensed-700.woff2')).toString('base64'),body:(await readFile('assets/fonts/source-sans-3-700.woff2')).toString('base64')};
 const logo='data:image/svg+xml;base64,'+(await readFile('mobile/assets/images/brand-mark.svg')).toString('base64');
 const {chromium}=await import('playwright'),browser=await chromium.launch({headless:true});
 try{return await renderOne({f,plan,fonts,logo,browser,out:resolve(out),previewOnly});}finally{await browser.close();}
}
export async function renderMotionReview({fixture='tests/fixtures/social-debate-seven-real.json',out='artifacts/social-motion-review',indices=null}={}){
 if(process.env.GITHUB_EVENT_NAME!=='pull_request'&&process.env.SOCIAL_MOTION_LOCAL_REVIEW!=='true')
  throw Error('Motion renderer is review-only; no scheduled or public publisher invocation');
 const {examples}=JSON.parse(await readFile(fixture,'utf8'));
 if(!Array.isArray(examples)||!examples.length)throw Error('No historical review examples');
 const selected=indices?indices.map(i=>examples[i]):examples;
 if(selected.some(f=>!f)||new Set(selected.map(f=>f.puzzle_id)).size!==selected.length)throw Error('Invalid or duplicate review fixtures');
 const oracle=await fetchOracleMetadata(selected.flatMap(f=>f.choices));
 const fonts={display:(await readFile('assets/fonts/barlow-condensed-700.woff2')).toString('base64'),body:(await readFile('assets/fonts/source-sans-3-700.woff2')).toString('base64')};
 const logo='data:image/svg+xml;base64,'+(await readFile('mobile/assets/images/brand-mark.svg')).toString('base64');
 const {chromium}=await import('playwright'),browser=await chromium.launch({headless:true});
 const summary=[];
 try{
  for(const f of selected){
   const plan=editorialPlan(f,oracle);
   const result=await renderOne({f,plan,fonts,logo,browser,out:resolve(out,f.day)});
   summary.push(result);console.log(JSON.stringify(result));
  }
 }finally{await browser.close();}
 await mkdir(out,{recursive:true});
 await writeFile(out+'/summary.json',JSON.stringify(summary,null,2)+'\n');
 return summary;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const indices=process.argv[2]?process.argv[2].split(',').map(Number):null;
 renderMotionReview({indices}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
