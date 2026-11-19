// Bounded, PII-free description of a rejected browser Origin header (#804).
// Only a class and, for a parseable origin, its lowercase hostname are ever
// emitted: never the full origin, port, path, query, userinfo, cookies,
// headers or client IP. IP-literal hostnames are redacted.

const MAX_HOST_LENGTH=253;
const IPV4=/^\d{1,3}(?:\.\d{1,3}){3}$/;

export function classifyRejectedOrigin(value) {
  const raw=String(value??'').trim();
  if(!raw)return {origin_class:'missing',origin_host:null};
  if(raw==='null')return {origin_class:'null_origin',origin_host:null};
  let url;
  try {url=new URL(raw);} catch {return {origin_class:'unparseable',origin_host:null};}
  const origin_class=url.protocol==='https:'?'unexpected_https':'unexpected_other';
  const host=url.hostname.toLowerCase();
  if(!host)return {origin_class,origin_host:null};
  if(IPV4.test(host)||host.startsWith('['))return {origin_class,origin_host:'ip-literal'};
  if(host.length>MAX_HOST_LENGTH||!/^[a-z0-9.-]+$/.test(host))return {origin_class,origin_host:null};
  return {origin_class,origin_host:host};
}
