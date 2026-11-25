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

export function assertPrivateRuntime(env=process.env) {
 if(env.GITHUB_ACTIONS||env.CI||env.GITHUB_RUN_ID||env.PACKONE_WEEKLY_PRIVATE_RUNTIME!=='true')
  throw Error('weekly-private-runtime-required');
 if(env.PACKONE_WEEKLY_PUBLICATION_ENABLED!=='true'||env.PACKONE_WEEKLY_NOTICE_VERIFIED!=='true')
  throw Error('weekly-publisher-disabled');
}

// Season-key wire protocol: the paired desktop may only render server-produced
// articles and never receives raw account IDs or writes arbitrary placements.
export const SEASON_KEY=/^pack-one-season:(results|guide):[a-z0-9-]{1,120}$/;
export const SEASON_KINDS=Object.freeze(['season-results','midseason-guide']);
export function validSeasonKey(value){
 if(typeof value!=='string'||!SEASON_KEY.test(value))throw Error('season-invalid-key');
 return value;
}
export function seasonTitle(kind,name){
 if(!SEASON_KINDS.includes(kind)||typeof name!=='string'||name.trim()!==name||name.length<1||name.length>120||/[\r\n]/.test(name))throw Error('season-invalid-title');
 return (kind==='season-results'?'Pack One Season Results & Awards':'Pack One Midseason Set Guide')+' | '+name;
}
export function validSeasonSource(source){
 const u=new URL(source);
 if(u.origin!=='https://www.17lands.com'||u.username||u.password||u.hash||!/^[a-zA-Z0-9-]{1,120}$/.test(u.searchParams.get('expansion')||''))throw Error('season-invalid-source');
 const p=u.searchParams,keys=[...p.keys()].sort().join(',');
 const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 if(u.pathname==='/deck_color_data'&&keys==='expansion,format,separate_splashes,time_period'&&p.get('format')==='PremierDraft'&&p.get('time_period')==='ALL_TIME'&&p.get('separate_splashes')==='true')return u;
 if(u.pathname==='/color_ratings/data'&&keys==='combine_splash,end_date,event_type,expansion,start_date'&&p.get('event_type')==='PremierDraft'&&p.get('combine_splash')==='false'&&date(p.get('start_date'))&&date(p.get('end_date'))&&p.get('start_date')<=p.get('end_date'))return u;
 throw Error('season-invalid-source');
}
export function seasonCaption(kind,name,start,end,source){
 const date=v=>{
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw Error('season-invalid-day');
  return v;
 };
 seasonTitle(kind,name);
 if(date(start)>date(end))throw Error('season-invalid-day');
 let body=(kind==='season-results'?'Final season results: ':'Midseason set guide: ')+name+' ('+start+' to '+end+').\n\nPlay Pack One: '+STORE_LINKS.web+'\nDownload on the App Store: '+STORE_LINKS.ios+'\nGet it on Google Play: '+STORE_LINKS.android;
 if(kind==='midseason-guide'){
  const u=validSeasonSource(source);
  if(u.pathname==='/color_ratings/data'&&(u.searchParams.get('start_date')!==start||u.searchParams.get('end_date')!==end))throw Error('season-invalid-source');
  body+='\n\n17Lands source: '+u.href;
 }
 return body;
}
export function validateSeasonPrepared(value){
 const a=value?.article;
 const key=validSeasonKey(value?.post_key);
 if(!a||!SEASON_KINDS.includes(a.kind)||key.split(':')[1]!== (a.kind==='season-results'?'results':'guide')||
    value.title!==seasonTitle(a.kind,a.seasonName)||value.body!==seasonCaption(a.kind,a.seasonName,a.start,a.end,a.outcomes?.sourceUrl)||
    typeof value.ticket!=='string'||!WEEKLY_HASH.test(value.evidence_sha256||''))throw Error('season-invalid-prepared');
 return value;
}
