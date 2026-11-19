// Read-only, fixed-zone inventory for the mobile/GitHub Actions setup path.
// Never return credentials, account identifiers, raw DNS targets or TXT values.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const ZONE='packone.pro';
const API='https://api.cloudflare.com/client/v4';
const HOSTS=new Set([ZONE,...['www','api','auth','data','*'].map(prefix=>`${prefix}.${ZONE}`)]);

export async function auditCloudflare({token,fetcher=fetch}={}) {
  token=token?.trim();
  if(!token)throw Error('Add the CLOUDFLARE_AUDIT_TOKEN repository Actions secret first.');
  async function read(path,params={}) {
    const url=new URL(API+path);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
    let response;
    try {
      response=await fetcher(url,{method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(30000)});
    } catch {throw Error('Cloudflare read transport failed; verify connectivity and retry.');}
    if(!response.ok)throw Error(`Cloudflare read failed (HTTP ${response.status}); check token permissions, expiry and zone scope.`);
    let body;
    try {body=await response.json();}catch{throw Error('Cloudflare returned an invalid JSON response.');}
    if(body.success!==true||!Array.isArray(body.result))throw Error('Cloudflare read failed or returned an unexpected result.');
    return body;
  }
  const zones=(await read('/zones',{name:ZONE,per_page:50})).result;
  if(zones.length!==1||zones[0].name!==ZONE||!/^[a-f0-9]{32}$/.test(zones[0].id))throw Error('Expected exactly one accessible packone.pro zone; check the token resource scope.');
  const zone=zones[0],records=[];
  for(const type of ['A','AAAA','CNAME']) {
    for(let page=1;;page++) {
      if(page>20)throw Error('DNS inventory exceeded its page limit; refusing an incomplete report.');
      const body=await read(`/zones/${zone.id}/dns_records`,{type,per_page:100,page});
      for(const record of body.result) {
        if(record.type!==type)throw Error('Cloudflare returned an unexpected DNS record type.');
        if(!HOSTS.has(record.name))continue;
        const target=String(record.content||'').toLowerCase().replace(/\.$/,'');
        const suffix=domain=>target===domain||target.endsWith('.'+domain);
        records.push({name:record.name,type,proxied:record.proxied===true,proxiable:record.proxiable===true,
          target_kind:type!=='CNAME'?'address':suffix('github.io')?'github-pages':suffix('neon.tech')?'neon':suffix('workers.dev')||suffix('pages.dev')||suffix('r2.dev')?'cloudflare':'other'});
      }
      const pages=body.result_info?.total_pages;
      if(pages!==undefined) {
        if(!Number.isInteger(pages)||pages<0||pages>20)throw Error('Invalid or excessive DNS pagination; refusing an incomplete report.');
        if(page>=pages)break;
      } else if(body.result.length<100)break;
    }
  }
  const routes=(await read(`/zones/${zone.id}/workers/routes`)).result.map(route=>({
    pattern:String(route.pattern||''),worker_attached:typeof route.script==='string'&&route.script.length>0,
  }));
  const report={zone:ZONE,status:zone.status,type:zone.type,paused:zone.paused===true,
    dns:records.sort((a,b)=>`${a.name}:${a.type}:${a.target_kind}`.localeCompare(`${b.name}:${b.type}:${b.target_kind}`)),
    worker_routes:routes.sort((a,b)=>a.pattern.localeCompare(b.pattern)),
    limits:['Only apex, www, api, auth, data and wildcard DNS hostnames are reported.',
      'Raw DNS targets, TXT records, account/zone IDs, script names and credentials are omitted.',
      'Worker custom domains, redirects, WAF/rate-limit rules, TLS settings and origin bypass have not been audited.',
      'This is an inventory, not proof that the site is protected or a deployment is safe.']};
  // Defense in depth against a token accidentally appearing in a remote string.
  return JSON.parse(JSON.stringify(report).replaceAll(token,'[redacted]'));
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  try {
    const report=await auditCloudflare({token:process.env.CLOUDFLARE_AUDIT_TOKEN});
    const json=JSON.stringify(report,null,2)+'\n';
    if(process.argv[2])fs.writeFileSync(process.argv[2],json,{mode:0o600});
    console.log(json);
  } catch(error) {
    // All errors from the reader are fixed text; do not print raw HTTP bodies.
    console.error(error.message);
    process.exitCode=1;
  }
}
