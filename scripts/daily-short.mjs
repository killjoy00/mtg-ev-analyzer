// Shared, side-effect-free contract for the real-browser Daily Short.
export const SITE_URL='https://packone.pro/';
export const DAILY_URL='https://packone.pro/?game=draft-run&daily=1';
export const PACIFIC='America/Los_Angeles';
export const INTRO_SECONDS=1.5;
export const PACK_SECONDS=6.5;
export const OUTRO_SECONDS=2.0;
export const SHORT_SECONDS=10;
export const TEMPLATE_VERSION='branded-real-pack-v1';
export const FRAMES_PER_SECOND=30;
export const TOTAL_FRAMES=SHORT_SECONDS*FRAMES_PER_SECOND;
if(INTRO_SECONDS+PACK_SECONDS+OUTRO_SECONDS!==SHORT_SECONDS)
  throw Error('Daily branded Short timing does not total 10 seconds.');

// Defined here so the recorder and its contract tests cannot drift apart.
export function videoFilter(packStart) {
  if(!Number.isFinite(packStart)||packStart<0)throw Error('Invalid real-pack video start.');
  const segment=(stream,trim,alias)=>
    `[${stream}:v]trim=${trim},setpts=PTS-STARTPTS,fps=${FRAMES_PER_SECOND},scale=1080:1920:flags=lanczos,setsar=1[${alias}]`;
  return [
    segment(0,`duration=${INTRO_SECONDS}`,'intro'),
    segment(1,`start=${packStart.toFixed(3)}:duration=${PACK_SECONDS}`,'pack'),
    segment(2,`duration=${OUTRO_SECONDS}`,'outro'),
    '[intro][pack][outro]concat=n=3:v=1:a=0,format=yuv420p[out]',
  ].join(';');
}

export function pacificDay(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:PACIFIC,year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function checkedDay(day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day))||
     new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)
    throw Error('Invalid Pacific Daily date.');
  return day;
}
export function intendedDay({now=new Date(),event='workflow_dispatch',scheduledAt=null}={}) {
  const today=pacificDay(now);
  return event==='schedule' && (!scheduledAt||pacificDay(scheduledAt)!==today)?null:today;
}
export function validateOpeningRun(run,day) {
  checkedDay(day);
  if(run?.day!==day||run?.environment!=='mixed'||run?.run_length!==8||
     !Array.isArray(run?.answers)||run.answers.length!==0||run?.complete||
     typeof run?.current?.puzzle_id!=='string'||run.current.puzzle_id.length<10||
     !Array.isArray(run?.current?.candidates)||run.current.candidates.length<10)
    throw Error('Live main Daily is missing, stale, already played, or has no complete first pack.');
  return {day,environment:'mixed',puzzle_id:run.current.puzzle_id,
    set_id:run.current.set_id,cards:run.current.candidates.length};
}
export function clipTailStart(duration,seconds) {
  if(!Number.isFinite(duration)||!Number.isFinite(seconds)||seconds<=0||duration<seconds+0.15)
    throw Error('Screen recording is shorter than the required clip.');
  // Keep a little buffer for the browser video's last frame and close latency.
  return Math.max(0,duration-seconds-0.08);
}
export function videoFilename(day) {return `packone-daily-${checkedDay(day)}-10s.mp4`;}
export function shortMetadata(day) {
  checkedDay(day);
  const date=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
    .format(new Date(day+'T12:00:00Z'));
  return {
    snippet:{
      title:`Today's MTG Draft Pick | Pack One ${date} #Shorts`,
      description:`Today's first pack is live. What's your pick?\n\nPlay the full Daily Draft Run: ${DAILY_URL}&utm_source=youtube&utm_medium=short&utm_campaign=daily_post\n\n#MTG #MagicTheGathering #MTGDraft #Shorts`,
      categoryId:'20',tags:['Magic The Gathering','MTG Draft','Pack One','Daily Draft'],
    },
    status:{privacyStatus:'public',selfDeclaredMadeForKids:false},
  };
}
export function youtubeReceiptMarker(day) {return `packone-daily-youtube:${checkedDay(day)}\n`;}