const MAX_INVOCATION_ID=512;
const MAX_TRIGGER_ID=160;
const MAX_TRIGGER_NAME=256;

const denied=()=>{throw Object.assign(Error('Neon trigger identity denied'),{status:403});};

export function neonTriggerInvocationHeader(request) {
  return String(request.headers.get('x-neon-trigger-invocation-id')||'');
}

export function verifyNeonScheduleTrigger(request,body,{names}={}) {
  const header=neonTriggerInvocationHeader(request);
  if(!header)return null;
  if(request.method!=='POST'||header.length>MAX_INVOCATION_ID)denied();
  if(!body||typeof body!=='object'||Array.isArray(body)||body.version!==1)denied();
  const invocationId=String(body.invocation_id||'');
  const trigger=body.trigger,data=body.data;
  if(!invocationId||invocationId!==header||invocationId.length>MAX_INVOCATION_ID)denied();
  if(!trigger||typeof trigger!=='object'||Array.isArray(trigger)||trigger.type!=='schedule')denied();
  if(!data||typeof data!=='object'||Array.isArray(data))denied();
  const id=String(trigger.id||''),name=String(trigger.name||''),scheduledAt=String(data.scheduled_at||'');
  if(!id||id.length>MAX_TRIGGER_ID||!name||name.length>MAX_TRIGGER_NAME)denied();
  if(names&&(!names.has||!names.has(name)))denied();
  const when=new Date(scheduledAt);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(scheduledAt)||!Number.isFinite(when.getTime()))denied();
  return {invocationId,id,name,scheduledAt};
}

export function zonedDateTime(iso,timeZone) {
  const date=new Date(iso);
  if(!Number.isFinite(date.getTime()))throw Error('Invalid scheduled time.');
  const formatter=new Intl.DateTimeFormat('en-CA',{
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23',
  });
  const parts=Object.fromEntries(formatter.formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute)};
}
