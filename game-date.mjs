export const GAME_TIME_ZONE = 'America/Los_Angeles';
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export function gameDateKey(date = new Date()) {
  const parts=Object.fromEntries(formatter.formatToParts(date instanceof Date ? date : new Date(date)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function nextGameDateBoundary(date = new Date()) {
  const now=date instanceof Date?date:new Date(date);
  const day=gameDateKey(now);
  let low=now.getTime(),high=low+26*60*60*1000;
  while(gameDateKey(new Date(high))===day)high+=6*60*60*1000;
  while(high-low>1) {
    const middle=Math.floor((low+high)/2);
    if(gameDateKey(new Date(middle))===day)low=middle;else high=middle;
  }
  return new Date(high);
}
export function dailyResetCue(date = new Date()) {
  const now=date instanceof Date?date:new Date(date);
  const minutes=Math.max(1,Math.ceil((nextGameDateBoundary(now).getTime()-now.getTime())/60000));
  const hours=Math.floor(minutes/60),remainder=minutes%60;
  return `New Dailies in ${hours?`${hours}h${remainder?` ${remainder}m`:''}`:`${remainder}m`}`;
}
