// Fast tests may replace fetch with deterministic fakes. Any unstubbed call
// fails immediately rather than reaching a hosted API or waiting on a timeout.
import http from 'node:http';
import https from 'node:https';
const blocked=()=>{throw Error('Fast tests prohibit remote network access; provide a deterministic fixture.');};
const local=host=>['127.0.0.1','localhost','[::1]','::1'].includes(host);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,...args)=>{
  if(!local(new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname))return blocked();
  return originalFetch(input,...args);
};
for(const transport of [http,https]) {
  for(const name of ['request','get']) {
    const original=transport[name].bind(transport);
    transport[name]=(...args)=>{
      const input=args[0],host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';
      if(!local(host))return blocked();
      return original(...args);
    };
  }
}
