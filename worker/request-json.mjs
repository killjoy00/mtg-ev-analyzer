const error=(message,status)=>Object.assign(new Error(message),{status});
export async function readJson(request,maximumBytes=131072) {
  if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw error('JSON body required.',415);
  if(Number(request.headers.get('content-length'))>maximumBytes)throw error('Request too large.',413);
  const reader=request.body?.getReader();
  if(!reader)throw error('JSON object required.',400);
  const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>maximumBytes){await reader.cancel();throw error('Request too large.',413);}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } catch(e) {
    if(e.status)throw e;
    throw error('Invalid JSON.',400);
  } finally {reader.releaseLock();}
  let value;try{value=JSON.parse(text);}catch{throw error('Invalid JSON.',400);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw error('JSON object required.',400);
  return value;
}
