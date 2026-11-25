// Aggregate game outcomes from the same public archive, not trophy pick rates.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const COPY_VERSION='copy-outcomes-v1';
const SHA=/^[a-f0-9]{64}$/;
const int=n=>Number.isSafeInteger(n)&&n>=0;
const fail=()=>{throw Error('lab-copy-outcomes-invalid');};
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(x=>k.includes(x));
const counts=['1','2','3','4+','2+'];
const groups=['WU','WB','WR','WG','UB','UR','UG','BR','BG','RG'].flatMap(p=>['lt50','50to59','60plus'].map(s=>p+'|'+s));
function cell(c,r){
  if(!Array.isArray(c)||c.length!==3||c.some(n=>!int(n))||c[0]>c[1]||c[0]>r.wins||c[1]>r.games||c[2]>r.drafts||c[2]>c[1]||c[1]<150||c[2]<30)fail();
  return c;
}
export function validateCopyOutcomes(r,meta){
  if(!keys(r,['schema_version','definition','set_id','event_type','source_sha256','source','raw_games','games','wins','drafts','invalid_games','duplicate_games','known_stratum_games','minimum_games','minimum_drafts','cards'])||
    r.schema_version!==1||r.definition!==COPY_VERSION||r.set_id!==meta.set_id||r.event_type!=='PremierDraft'||!SHA.test(meta.game_sha256||'')||
    r.source_sha256!==meta.game_sha256||r.source!=='17Lands public game data (CC BY 4.0)'||r.minimum_games!==150||r.minimum_drafts!==30||
    ['raw_games','games','wins','drafts','invalid_games','duplicate_games','known_stratum_games'].some(k=>!int(r[k]))||
    !r.games||!r.drafts||r.raw_games>2000000||r.raw_games!==r.games+r.invalid_games+r.duplicate_games||r.wins>r.games||r.drafts>r.games||r.known_stratum_games>r.games||
    !r.cards||typeof r.cards!=='object'||Array.isArray(r.cards)||Object.keys(r.cards).length>1000)fail();
  for(const [name,v] of Object.entries(r.cards)){
    if(!name||name.length>160||/[\u0000-\u001f<>]/.test(name)||!keys(v,['all','strata'])||!keys(v.all,counts)||!keys(v.strata,groups))fail();
    const a=cell(v.all['1'],r),b=cell(v.all['2+'],r);
    if(a[0]+b[0]>r.wins||a[1]+b[1]>r.games)fail();
    const exact=['2','3','4+'].filter(k=>Object.hasOwn(v.all,k)).map(k=>cell(v.all[k],r));
    if(exact.reduce((n,c)=>n+c[0],0)>b[0]||exact.reduce((n,c)=>n+c[1],0)>b[1]||exact.some(c=>c[2]>b[2]))fail();
    for(const k of ['1','2+']){
      let w=0,n=0;
      for(const s of Object.values(v.strata)){
        if(!keys(s,['1','2+']))fail();
        const c=cell(s[k],r);if(c[2]>v.all[k][2])fail();w+=c[0];n+=c[1];
      }
      if(w>v.all[k][0]||n>v.all[k][1]||n>r.known_stratum_games)fail();
    }
  }
  return r;
}
export async function readCopyOutcomes(meta,query){
  if(query){
    const row=(await query('SELECT report,artifact_sha256 FROM pack1_lab_copy_outcomes WHERE set_id=$1 AND game_sha256=$2 AND definition=$3',[meta.set_id,meta.game_sha256,COPY_VERSION])).rows[0];
    if(row){
      if(!SHA.test(row.artifact_sha256||''))fail();
      return {report:validateCopyOutcomes(typeof row.report==='string'?JSON.parse(row.report):row.report,meta),artifact_sha256:row.artifact_sha256};
    }
  }
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.set_id||''))return null;
  let bytes;
  try{bytes=await readFile(new URL('../../corpus/lab-outcomes/'+meta.set_id+'.json',import.meta.url));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(bytes.length>16*1024*1024)fail();
  const report=JSON.parse(bytes.toString('utf8'));
  if(report.source_sha256!==meta.game_sha256)return null;
  return {report:validateCopyOutcomes(report,meta),artifact_sha256:createHash('sha256').update(bytes).digest('hex')};
}
const labels={'1':'one copy','2':'exactly two copies','3':'exactly three copies','4+':'four or more copies','2+':'two or more copies'};
const metric=(id,label,c)=>({id,label,numerator:c[0],denominator:c[1],percent:Math.round(1000*c[0]/c[1])/10});
const describe=c=>({wins:c[0],games:c[1],distinct_drafts:c[2]});
const direction=(a,b)=>{const d=b[0]/b[1]-a[0]/a[1];return d>=.02?'higher':d<=-.02?'lower':'similar';};
export function attachCopyOutcomes(packet,meta,context){
  if(packet.research_context?.family!=='repeat-card-context')return packet;
  const name=packet.research_context.cards[0]?.name;
  const missing=reason=>({...packet,research_context:{...packet.research_context,copy_outcomes:{status:'unavailable',card:name,reason}},
    reference:packet.reference+' Copy-count outcomes unavailable: do not infer a win-rate advantage.'});
  if(!context)return missing('no matching outcome table');
  if(!SHA.test(context.artifact_sha256||''))fail();
  const r=validateCopyOutcomes(context.report,meta),v=Object.hasOwn(r.cards,name)?r.cards[name]:null;
  if(!v)return missing('insufficient copy-count support');
  // Choose by sample support, never by observed win-rate difference.
  const [group,g]=Object.entries(v.strata).sort(([a,x],[b,y])=>Math.min(y['1'][2],y['2+'][2])-Math.min(x['1'][2],x['2+'][2])||
    Math.min(y['1'][1],y['2+'][1])-Math.min(x['1'][1],x['2+'][1])||(a<b?-1:1))[0]||[];
  const metrics=['1','2+','2','3','4+'].filter(k=>v.all[k]).map(k=>metric(k==='1'?'copy-one':k==='2+'?'copy-multiple':'copy-exact-'+k.replace('+','plus'),name+' — '+labels[k]+', game win rate',v.all[k]));
  if(g)metrics.push(metric('copy-matched-one',group+' — one copy, game win rate',g['1']),metric('copy-matched-multiple',group+' — two or more copies, game win rate',g['2+']));
  const copy_outcomes={status:'measured',card:name,unit:'recorded game containing the card in the maindeck regardless of drawing it',
    population:'All valid recorded PremierDraft games, not only trophy drafts',overall:Object.fromEntries(Object.entries(v.all).map(([k,c])=>[k,describe(c)])),
    overall_direction:direction(v.all['1'],v.all['2+']),matched_group:g?{key:group,one:describe(g['1']),multiple:describe(g['2+']),direction:direction(g['1'],g['2+']),minimum_prior_games:100}:null,
    metric_ids:metrics.map(m=>m.id),source_sha256:r.source_sha256,artifact_sha256:context.artifact_sha256,
    interpretation:'Within two percentage points is similar; descriptive, not a significance test. Repeated games may share a draft. Color and skill groups do not remove all confounding.'};
  return {...packet,metrics:[...packet.metrics,...metrics],research_context:{...packet.research_context,copy_outcomes},
    triage_score:(packet.triage_score||0)+15+(g?8:0),
    provenance:{...packet.provenance,hashes:{...packet.provenance.hashes,copy_outcomes:context.artifact_sha256}},
    limitations:[...packet.limitations,'Copy-count game win rates include all valid game outcomes, not only trophies, and are not game-in-hand rates. Deck quality and player selection remain confounders.'],
    reference:packet.reference+' Use the copy-count results to assess the first finding; explain whether the comparable group supports or challenges it. Draw a tentative implication, not a causal recommendation.'};
}
