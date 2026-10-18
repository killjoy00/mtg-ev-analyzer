// All reminder dates are account-local. Daily game identity remains Pacific elsewhere.
const FREQUENCIES=new Set(['daily','weekly','custom']);
const TIME=/^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const YMD=/^\d{4}-\d{2}-\d{2}$/;
export function validateReminderSchedule(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid reminder schedule.');
  const frequency=String(value.frequency||'');
  if(!FREQUENCIES.has(frequency))throw Error('Choose a reminder frequency.');
  const localTime=String(value.localTime||'');
  if(!TIME.test(localTime))throw Error('Choose a valid local time.');
  const timeZone=String(value.timeZone||'');
  if(timeZone.length<2||timeZone.length>80||!/^[A-Za-z0-9_+\/-]+$/.test(timeZone))
    throw Error('Choose a valid timezone.');
  let canonical;
  try {canonical=new Intl.DateTimeFormat('en-US',{timeZone}).resolvedOptions().timeZone;} catch {throw Error('Choose a valid timezone.');}
  if(!canonical)throw Error('Choose a valid timezone.');
  const weekdays=value.weekdays;
  if(!Array.isArray(weekdays)||weekdays.length<1||weekdays.length>7||
    weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(weekdays).size!==weekdays.length)
    throw Error('Choose one or more weekdays.');
  if(frequency==='weekly'&&weekdays.length!==1)throw Error('Weekly reminders require exactly one weekday.');
  return {frequency,weekdays:[...weekdays].sort((a,b)=>a-b),localTime,timeZone:canonical};
}
function localParts(at,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {day:parts.year+'-'+parts.month+'-'+parts.day,minute:Number(parts.hour)*60+Number(parts.minute)};
}
function dayOffset(day,offset) {
  const at=Date.parse(day+'T12:00:00Z')+offset*86400000;
  return new Date(at).toISOString().slice(0,10);
}
function daySelected(day,schedule) {
  if(schedule.frequency==='daily')return true;
  return schedule.weekdays.includes(new Date(day+'T12:00:00Z').getUTCDay());
}
// Find the earliest matching UTC minute. The first repeated time wins at autumn
// fallback; a nonexistent wall time moves to the first valid minute after it.
export function resolveReminderWallTime(day,schedule) {
  if(!YMD.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z')))throw Error('Invalid local date.');
  const target=Number(schedule.localTime.slice(0,2))*60+Number(schedule.localTime.slice(3,5));
  const start=Date.parse(day+'T00:00:00Z')-14*3600000;
  const end=start+52*3600000;
  const step=15*60000;
  let previous=start-step;
  for(let at=start;at<=end;at+=step) {
    const part=localParts(at,schedule.timeZone);
    if(part.day===day&&part.minute>=target) {
      for(let minute=previous+60000;minute<=at;minute+=60000) {
        const check=localParts(minute,schedule.timeZone);
        if(check.day===day&&check.minute>=target)return new Date(minute).toISOString();
      }
      return new Date(at).toISOString();
    }
    previous=at;
  }
  return null; // e.g. an entire skipped civil day
}
export function nextReminderOccurrence(input,afterMs=Date.now()) {
  const schedule=validateReminderSchedule(input);
  if(!Number.isFinite(Number(afterMs)))throw Error('Invalid scheduler clock.');
  const today=localParts(new Date(Number(afterMs)),schedule.timeZone).day;
  for(let offset=0;offset<=8;offset++) {
    const day=dayOffset(today,offset);
    if(!daySelected(day,schedule))continue;
    const instant=resolveReminderWallTime(day,schedule);
    if(instant&&Date.parse(instant)>Number(afterMs))return {localDay:day,dueAt:instant};
  }
  throw Error('No future reminder occurrence found.');
}
export function localReminderDay(at,schedule) {
  return localParts(new Date(at),schedule.timeZone).day;
}
