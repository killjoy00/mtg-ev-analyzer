// Bounded public aggregate retrieval. No login, raw draft files, player
// records, credential, scrape, or retry. Unknown response shapes fail closed.
// The resulting source is unreviewed until the owner approves the frozen guide.
import {validSeasonSource} from '../weekly-patreon-contract.mjs';
export function seasonColorSource(gate){
 if(!/^[a-z0-9-]{1,120}$/.test(gate.setId))throw Error('season-source-set');
 const u=new URL('https://www.17lands.com/color_ratings/data');
 for(const [k,v] of Object.entries({expansion:gate.setId.toUpperCase(),event_type:'PremierDraft',start_date:gate.start,end_date:gate.end,combine_splash:'false'}))u.searchParams.set(k,v);
 return validSeasonSource(u.href).href;
}
const validCount=n=>Number.isSafeInteger(n)&&n>=0;
const pair=(v,n)=>typeof v==='string'&&v.length===n&&/^[WUBRG]+$/.test(v)&&new Set(v).size===n;
export function parseSeasonColorRows(raw,gate,{colorCount=2}={}){
 if(!Array.isArray(raw)||raw.length>256||![2,3].includes(colorCount))return null;
 const rows=raw.filter(r=>r?.is_summary===false&&pair(r.short_name,colorCount)&&typeof r.color_name==='string'&&(()=>{const suffix=r.color_name.match(/ \(([WUBRG]{2,3})\)$/);return !!suffix&&[...suffix[1]].sort().join('')===[...r.short_name].sort().join('');})()).map(r=>({colors:r.short_name,wins:r.wins,games:r.games}));
 if(rows.length!==10||new Set(rows.map(r=>[...r.colors].sort().join(''))).size!==10||rows.some(r=>!validCount(r.wins)||!validCount(r.games)||r.wins>r.games))return null;
 const summaries=raw.filter(r=>r?.is_summary===true&&r.color_name===(colorCount===2?'Two-color':'Three-color'));
 if(summaries.length!==1)return null;
 const baseline=rows.reduce((a,r)=>({wins:a.wins+r.wins,games:a.games+r.games}),{wins:0,games:0});
 if(!baseline.games||summaries[0].wins!==baseline.wins||summaries[0].games!==baseline.games)return null;
 return {id:gate.setId,sourceStatus:'automated-unreviewed',results:{format:'PremierDraft',userGroup:'all',period:'DATE_RANGE',splashes:false,colorCount,retrievedAt:gate.milestone,startDate:gate.start,endDate:gate.end,sourceUrl:seasonColorSource(gate),rows,baseline}};
}
export async function fetchSeasonColorGuide(gate,{fetchImpl=fetch,colorCount=2}={}){
 try{
  const r=await fetchImpl(seasonColorSource(gate),{method:'GET',headers:{accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok||Number(r.headers.get('content-length')||0)>300000)return null;
  const text=await r.text();if(text.length>300000)return null;
  return parseSeasonColorRows(JSON.parse(text),gate,{colorCount});
 }catch{return null;}
}
