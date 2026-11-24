// Shared, server-safe publication contract. No database driver, filesystem,
// rendering runtime, provider token or player data.
export const STORE_LINKS=Object.freeze({
 ios:'https://apps.apple.com/app/id6814318676',
 android:'https://play.google.com/store/apps/details?id=pro.packone.app',
 web:'https://packone.pro/'
});
export const WEEKLY_PATH='/v1/weekly-publisher';
export const ADMIN_WEEKLY_PATH='/v1/admin/patreon-weekly';
export const WEEKLY_TOKEN=/^p1w_[A-Za-z0-9_-]{43}$/;
export const WEEKLY_HASH=/^[a-f0-9]{64}$/;
export const WEEKLY_CUTOFF=Date.parse('2026-11-30T15:33:00Z');
export function validWeekEnd(day){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('weekly-invalid-day');
 const d=new Date(day+'T12:00:00Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day||d.getUTCDay()!==0)throw Error('weekly-invalid-day');
 return day;
}
export function recapTitle(end){return 'Pack One Weekly | '+validWeekEnd(end);}
export function recapBody(end){
 return 'Week ending '+validWeekEnd(end)+'.\n\nPlay Pack One: '+STORE_LINKS.web+'\nDownload on the App Store: '+STORE_LINKS.ios+'\nGet it on Google Play: '+STORE_LINKS.android;
}
export function publicLocator(value){
 try{
  const u=new URL(value);
  if(u.origin==='https://www.patreon.com'&&!u.username&&!u.password&&/^\/posts\/\d+$/.test(u.pathname)&&!u.search&&!u.hash)return u.toString();
 }catch{}
 return null;
}
export function validPublication(found,run,now=new Date()){
 const url=publicLocator(found?.url),at=Date.parse(found?.publishedAt),admitted=Date.parse(run.admitted_at);
 if(!url||!Number.isFinite(at)||!Number.isFinite(admitted)||at<WEEKLY_CUTOFF||at>now.getTime()||at<admitted||found.title!==run.title)
  throw Error('weekly-public-readback-invalid');
 return {url,publishedAt:new Date(at).toISOString()};
}
export function uniquePlacements(rows){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('weekly-placements-invalid');
 const byId=new Map();
 for(const p of rows){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p?.authId||'')||typeof p.name!=='string'||!p.name||p.name.length>100||p.name==='Anonymous player')throw Error('weekly-placements-invalid');
  if(byId.has(p.authId)&&byId.get(p.authId)!==p.name)throw Error('weekly-placements-invalid');
  byId.set(p.authId,p.name);
 }
 return [...byId].sort(([a],[b])=>a.localeCompare(b)).map(([auth_id,name])=>({auth_id,name}));
}
