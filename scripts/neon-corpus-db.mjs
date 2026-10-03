import fs from 'node:fs';

export function corpusDatabase(connectionFile) {
  const connection=fs.readFileSync(connectionFile,'utf8').trim();
  const db=new URL(connection);
  if(!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname.endsWith('.neon.tech'))throw Error('A Neon database connection is required.');
  const endpoint=`https://api.${db.hostname.split('.').slice(1).join('.')}/sql`;
  return async function query(sql,params=[]) {
    for(let attempt=0;attempt<3;attempt++) {
      const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json','Neon-Connection-String':connection},body:JSON.stringify({query:sql,params}),signal:AbortSignal.timeout(120000)});
      if(response.ok)return response.json();
      if(![429,502,503,504].includes(response.status)||attempt===2) {
        const body=await response.text();
        let detail=body;
        try {
          const parsed=JSON.parse(body);
          detail=[parsed.code,parsed.message,parsed.detail].filter(Boolean).join(': ');
        } catch {}
        throw Error(`Corpus SQL request failed (${response.status})${detail?`: ${String(detail).slice(0,500)}`:''}.`);
      }
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
  };
}
