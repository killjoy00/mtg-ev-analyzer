// A bounded process-local aggregate cache, never a puzzle-serving cache.
// Each caller verifies the database revision; the TTL alone is not freshness.
export function revisionSummary({ttl=60000,now=Date.now}={}) {
 let cached=null,pending=null;
 const revision=async query=>{
   const value=(await query('SELECT revision::text revision FROM draft_run_serving_revision WHERE singleton')).rows[0]?.revision;
   if(!/^[0-9]+$/.test(String(value??'')))throw Error('Summary revision unavailable');
   return String(value);
 };
 return async function summary(query,load,{deep=false}={}) {
   if(deep)return load();
   const before=await revision(query);
   if(cached?.revision===before&&now()-cached.at<ttl)return structuredClone(cached.value);
   // Collapse concurrent diagnostic scans within this process. Separate Neon
   // instances have separate caches; this is not a global database lease.
   if(!pending)pending=(async()=>{
     const value=await load();
     const after=await revision(query);
     if(before!==after)throw Object.assign(Error('Corpus summary changed. Please retry.'),{status:503,retryAfter:2,diagnosticReason:'corpus_unavailable'});
     cached={revision:after,at:now(),value:structuredClone(value)};
     return cached;
   })().finally(()=>{pending=null;});
   const result=await pending;
   if(result.revision!==before)throw Object.assign(Error('Corpus summary changed. Please retry.'),{status:503,retryAfter:2,diagnosticReason:'corpus_unavailable'});
   return structuredClone(result.value);
 };
}
