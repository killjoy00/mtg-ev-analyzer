import fs from 'node:fs';
import {createHash} from 'node:crypto';
const HOST='api-preview.packone.pro';
export function assertPreviewOwner(settings,{runId,attempt,branch,sha}) {
  const binding=name=>settings?.result?.bindings?.find(value=>value.type==='plain_text'&&value.name===name)?.text;
  if(binding('MODE')!=='preview'||binding('NEON_BRANCH_ID')!==branch||binding('RELEASE_COMMIT')!==sha||
    binding('CI_PREVIEW_RUN')!==String(runId)||binding('CI_PREVIEW_ATTEMPT')!==String(attempt))throw Error('Preview cleanup owner changed; refusing to detach another run');
}
export function dnsFingerprint(record) {
  return createHash('sha256').update(JSON.stringify([record.id,record.name,record.type,record.content,record.proxied,record.created_on,record.modified_on])).digest('hex');
}
export function resourceReceipt({branch,sha,runId,attempt,expires,phase,domainId=null,records=[]}) {
  if(!/^br-[a-z0-9-]+$/.test(branch)||['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch)||
    !/^[a-f0-9]{40}$/.test(sha)||!/^[1-9][0-9]*$/.test(String(runId))||!/^[1-9][0-9]*$/.test(String(attempt))||
    !Number.isFinite(Date.parse(expires)))throw Error('Invalid CI resource ownership');
  return {version:1,branch,sha,run_id:String(runId),attempt:String(attempt),expires_at:expires,phase,hostname:HOST,domain_id:domainId,
    dns:records.map(record=>({id:record.id,fingerprint:dnsFingerprint(record)}))};
}
export function writeResourceReceipt(receipt,file='artifacts/ci-resources/preview.json') {
  fs.mkdirSync('artifacts/ci-resources',{recursive:true});fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');
}
export async function cleanupOwnedDns({records,readRecords,remove,assertOwner}) {
  if(records.length>1||records.some(record=>record.name!==HOST||!/^[a-f0-9]{32}$/.test(record.id)))throw Error('Unexpected preview DNS inventory; refusing cleanup');
  for(const record of records) {
    await assertOwner();
    const current=await readRecords();
    if(!current.length)continue;
    if(current.length!==1||dnsFingerprint(current[0])!==dnsFingerprint(record))throw Error('Preview DNS changed during cleanup; refusing deletion');
    let failure;
    try {await remove(record.id);} catch(error) {failure=error;}
    const remaining=await readRecords();
    if(!remaining.length)continue; // timeout/5xx may still have removed it
    if(failure)throw failure;
    throw Error('Preview DNS remains after cleanup');
  }
  if((await readRecords()).length)throw Error('Preview DNS absence could not be verified');
}
