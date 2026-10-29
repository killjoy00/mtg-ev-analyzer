// Query coverage, not a claim of complete provider log retention.
export async function collectVerifiedTelemetry({from,to,fetchPage,pageSize=2000,maxPages=12,maxRequests=48}){
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from>=to||to-from>35*60000||
    !Number.isInteger(pageSize)||pageSize<1||pageSize>2000||!Number.isInteger(maxPages)||maxPages<1||maxPages>32||
    !Number.isInteger(maxRequests)||maxRequests<1||maxRequests>64)throw Error('Invalid bounded telemetry window');
  const rows=new Map(),coverage=[];let requests=0;
  async function partition(begin,end){
    const local=new Map(),cursors=new Set();let offset=null;
    for(let i=0;i<maxPages;i++){
      if(++requests>maxRequests)throw Error('Telemetry query budget exceeded');
      const {events:page,level}=await fetchPage({from:begin,to:end,limit:pageSize,offset});
      if(!Array.isArray(page)||page.length>pageSize)throw Error('Malformed Cloudflare telemetry page');
      if(!Number.isInteger(level)||level<1)throw Error('Telemetry sampling coverage unavailable');
      if(level!==1){
        // Discard even earlier pages of this partition before retrying its
        // read-only query at smaller ranges. A short page can omit events.
        if(end-begin<=60000)throw Error('Telemetry sampling remains unresolved');
        const middle=begin+Math.floor((end-begin)/2);
        await partition(begin,middle);await partition(middle,end);return;
      }
      for(const row of page){
        const id=row?.$metadata?.id;
        if(typeof id!=='string'||!id||id.length>512)throw Error('Malformed telemetry event identifier');
        if(local.has(id)&&JSON.stringify(local.get(id))!==JSON.stringify(row))throw Error('Conflicting telemetry event identity');
        local.set(id,row);
      }
      if(page.length<pageSize){
        for(const [id,row] of local){
          if(rows.has(id)&&JSON.stringify(rows.get(id))!==JSON.stringify(row))throw Error('Conflicting telemetry event identity');
          rows.set(id,row);
        }
        if(rows.size>maxPages*pageSize)throw Error('Telemetry event bound exceeded');
        coverage.push({from:begin,to:end,pages:i+1,query_level:1});return;
      }
      const next=page.at(-1)?.$metadata?.id;
      if(!next||next===offset||cursors.has(next))throw Error('Telemetry pagination stalled');
      cursors.add(next);offset=next;
    }
    throw Error('Telemetry query exceeded bounded page count');
  }
  await partition(from,to);
  return {rows:[...rows.values()],requests,coverage};
}
