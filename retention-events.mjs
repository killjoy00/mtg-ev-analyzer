import { sendEvents } from './growth-api.mjs';

const ALLOWED = new Set(['mode','set','seed','daily','challenge','outcome','score','grade','period','type','round','surface','method','context','kind','own','public','achievement','environments','total','percentile','source','account','run_id','target_score','opponent_score']);
let queue=[],timer=null;
let visitId;
try {visitId=sessionStorage.getItem('pack1-visit-id');if(!visitId){visitId=crypto.randomUUID();sessionStorage.setItem('pack1-visit-id',visitId);}} catch {visitId=crypto.randomUUID();}

export function sanitizedEventProps(input={}) {
  return Object.fromEntries(Object.entries(input).filter(([k,v])=>ALLOWED.has(k)&&['string','number','boolean'].includes(typeof v)&&!(typeof v==='number'&&!Number.isFinite(v))).map(([k,v])=>[k,typeof v==='string'?v.slice(0,100):v]));
}
export function trackEvent(name,props={}) {
  const params=new URLSearchParams(location.search);
  queue.push({name,props:{...sanitizedEventProps({set:params.get('set'),mode:params.get('game')==='draft-run'?'draft_run':params.get('mode'),...props}),session_id:visitId}});
  if(queue.length>=20)void flushEvents();else if(!timer)timer=setTimeout(()=>void flushEvents(),180);
}
export async function flushEvents() {
  clearTimeout(timer);timer=null;if(!queue.length)return;
  const events=queue.splice(0,20);await sendEvents(events);if(queue.length)void flushEvents();
}
if(typeof document!=='undefined') document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flushEvents();});
