// Decides whether an `npm audit --json` report blocks the dependency gate.
// Any high/critical advisory blocks unless it is listed below with an unexpired
// date. List only advisories that have no patched release to move to, and
// remove the entry as soon as one exists.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const EXCEPTIONS=new Map([
  // node-forge <=1.4.0 RSA PKCS#1 v1.5 signature check, reached through
  // expo -> @expo/cli / @expo/code-signing-certificates. 1.4.0 is the newest
  // node-forge release and the advisory lists no patched version.
  ['GHSA-86w9-cpqp-85rv','2026-12-01'],
]);

const BLOCKING=new Set(['high','critical']);

export function auditGate(report,{today=new Date().toISOString().slice(0,10),exceptions=EXCEPTIONS}={}) {
  if(!report||typeof report!=='object'||report.error||typeof report.vulnerabilities!=='object')
    return {blocking:['audit report unavailable'],excepted:[]};
  const advisories=new Map();
  for(const vulnerability of Object.values(report.vulnerabilities)) {
    for(const via of vulnerability.via||[]) {
      if(typeof via!=='object'||!BLOCKING.has(via.severity))continue;
      const id=String(via.url||'').match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/)?.[0]||String(via.source||via.title);
      advisories.set(id,via.name||vulnerability.name);
    }
  }
  const blocking=[],excepted=[];
  for(const [id,name] of advisories) {
    const until=exceptions.get(id);
    if(until&&today<=until)excepted.push(`${id} (${name}, excepted until ${until})`);
    else blocking.push(`${id} (${name})`);
  }
  return {blocking,excepted};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let report=null;
  try{report=JSON.parse(readFileSync(process.argv[2],'utf8'));}catch{}
  const {blocking,excepted}=auditGate(report);
  for(const line of excepted)console.log('::warning::Excepted high/critical advisory: '+line);
  for(const line of blocking)console.log('::error::Blocking advisory: '+line);
  process.exitCode=blocking.length?1:0;
}
