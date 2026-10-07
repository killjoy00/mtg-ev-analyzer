// One-time, read-only extraction of already retained private-preview logs.
// No gameplay, provisioning, production telemetry or issue routing occurs.
import fs from 'node:fs';
import {previewAccount,queryPreviewEvents} from './launch-distributed-telemetry.mjs';
import {parseGatewayEvent} from './launch-alert.mjs';
import {quantiles} from './launch-distributed-core.mjs';

const release='23b9f42542a9c59ca04c623d8fabadecf1b3f847';
const windows=[
  {name:'nat-37670078187',from:'2026-10-07T19:00:00Z',to:'2026-10-07T19:03:00Z'},
  {name:'distributed-37670078690',from:'2026-10-07T19:14:00Z',to:'2026-10-07T19:16:00Z'},
];
const directory='artifacts/capacity-evidence';fs.mkdirSync(directory,{recursive:true});
const account=await previewAccount(),token=process.env.CLOUDFLARE_EDGE_TOKEN;
for(const window of windows) {
  const diagnostics=new Map();
  const fetcher=async(url,options)=>{
    const response=await fetch(url,options);
    if(response.ok) {
      const data=await response.clone().json();
      for(const row of data?.result?.events?.events||[]) {
        const event=parseGatewayEvent(row);if(!event||event.release!==release)continue;
        let source=row.source;
        if(typeof source==='string')try {source=JSON.parse(source);}catch {source=null;}
        if(!source||typeof source!=='object')try {source=JSON.parse(row.$metadata?.message);}catch {source=null;}
        const number=value=>Number.isFinite(value)&&value>=0?value:null;
        diagnostics.set(event.id,{route:event.route,status:event.status,duration_ms:event.duration_ms,
          quota_ms:event.quota_ms,upstream_ms:event.upstream_ms,
          upstream_calls:number(source?.upstream_calls),upstream_status:number(source?.upstream_status),
          error:['timeout','invalid_body','gateway_failure'].includes(source?.error)?source.error:null});
      }
    }
    return response;
  };
  const events=(await queryPreviewEvents(fetcher,token,account,Date.parse(window.from),Date.parse(window.to))).filter(e=>e.release===release);
  const rows=[...diagnostics.values()],routes={};
  for(const route of new Set(events.map(e=>e.route))) {
    const samples=rows.filter(e=>e.route===route);
    routes[route]={samples:samples.length,duration_ms:quantiles(samples.map(e=>e.duration_ms)),
      quota_ms:quantiles(samples.map(e=>e.quota_ms)),upstream_ms:quantiles(samples.map(e=>e.upstream_ms))};
  }
  const report={window,release,event_count:events.length,routes,
    errors:rows.filter(e=>e.status>=500||e.status===429),
    slow_starts:rows.filter(e=>e.route==='draft_start').sort((a,b)=>b.duration_ms-a.duration_ms).slice(0,25)};
  fs.writeFileSync(`${directory}/${window.name}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!events.length)process.exitCode=1;
}
