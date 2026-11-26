// Only the approved public presentation is sent to the paired desktop.
import {createHash} from 'node:crypto';
import {STORE_LINKS,WEEKLY_HASH} from './weekly-patreon-contract.mjs';
const fail=()=>{throw Error('lab-publication-invalid');};
const footer='17Lands public datasets: https://www.17lands.com/public_datasets\nData license: https://creativecommons.org/licenses/by/4.0/\n\nPlay Pack One: '+STORE_LINKS.web+'\nDownload on the App Store: '+STORE_LINKS.ios+'\nGet it on Google Play: '+STORE_LINKS.android;
export function labWeek(week){
 if(typeof week!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(week))fail();
 const d=new Date(week+'T12:00:00Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==week||d.getUTCDay()!==1)fail();
 return week;
}
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u0008\u000b-\u001f]/.test(v);
function artwork(a){
 if(!a||a.version!=='pack-one-lab-blue-v1')fail();
 const check=v=>typeof v==='string'&&v.length<100000&&v.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')&&v.endsWith('</svg>')&&!/<(?:script|foreignObject|iframe|image|use|style)\b|\b(?:href|on[a-z]+)\s*=|<!DOCTYPE|<!ENTITY/i.test(v);
 if(!check(a.cover_svg)||!check(a.chart_svg)||!text(a.chart_alt,1500))fail();
 const out={version:a.version,cover_svg:a.cover_svg,chart_svg:a.chart_svg,chart_alt:a.chart_alt};
 if(a.outcome_chart_svg!==undefined||a.outcome_chart_alt!==undefined){
  if(!check(a.outcome_chart_svg)||!text(a.outcome_chart_alt,1500))fail();
  out.outcome_chart_svg=a.outcome_chart_svg;out.outcome_chart_alt=a.outcome_chart_alt;
 }
 return out;
}
function checkedPost(p){
 if(!p||!text(p.title,125)||!/^Pack One Lab \| [^\r\n]{1,110}$/.test(p.title)||!text(p.body,3999)||!p.body.endsWith('\n\n'+footer))fail();
 return {title:p.title,body:p.body,artwork:artwork(p.artwork)};
}
export function labPost(article){
 if(article?.schema_version!==2||!text(article.title,110)||!text(article.body,3999)||!text(article.source,2000)||!Array.isArray(article.blocks))fail();
 const blocks=article.blocks;
 if(blocks.filter(b=>b.type==='chart').length!==1||blocks.filter(b=>b.type==='outcome-chart').length!==(article.artwork?.outcome_chart_svg?1:0)||
    blocks.some(b=>!['chart','outcome-chart','paragraph','heading','facts','note'].includes(b.type)))fail();
 if(blocks.filter(b=>!['chart','outcome-chart'].includes(b.type)).map(b=>b.text).join('\n\n')!==article.body)fail();
 return checkedPost({title:'Pack One Lab | '+article.title,body:article.body+'\n\n'+article.source+'\n\n'+footer,artwork:article.artwork});
}
export function labPresentationHash(post){return createHash('sha256').update(JSON.stringify(checkedPost(post))).digest('hex');}
export function validateLabPrepared(v){
 labWeek(v?.week);
 if(!Number.isSafeInteger(v.revision)||v.revision<1||!WEEKLY_HASH.test(v.article_hash||'')||typeof v.ticket!=='string'||
    !WEEKLY_HASH.test(v.presentation_sha256||'')||labPresentationHash(v)!==v.presentation_sha256)fail();
 return v;
}
