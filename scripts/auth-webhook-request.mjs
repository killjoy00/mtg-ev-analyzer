import fs from 'node:fs';

export function parseAuthWebhookRequest(value) {
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid Auth webhook request.');
  const allowed=new Set(['operation','reason','commit']);
  if(Object.keys(value).some(key=>!allowed.has(key)))throw Error('Invalid Auth webhook request.');
  if(!['idle','check-secret','deploy-qa','deploy-qa-fail','deploy-qa-retry','delete-qa'].includes(value.operation))throw Error('Invalid Auth webhook request.');
  if(typeof value.reason!=='string'||!value.reason.trim())throw Error('Invalid Auth webhook request.');
  const needsCommit=['deploy-qa','deploy-qa-fail','deploy-qa-retry'].includes(value.operation);
  if(needsCommit&&!/^[a-f0-9]{40}$/.test(value.commit||''))throw Error('Invalid Auth webhook request.');
  if(!needsCommit&&value.commit!==undefined)throw Error('Invalid Auth webhook request.');
  return {operation:value.operation,commit:needsCommit?value.commit:''};
}

if(process.argv[1]&&process.argv[1].endsWith('auth-webhook-request.mjs')) {
  try {
    const parsed=parseAuthWebhookRequest(JSON.parse(fs.readFileSync('.github/auth-webhook-request.json','utf8')));
    fs.appendFileSync(process.env.GITHUB_OUTPUT,'operation='+parsed.operation+'\n');
    fs.appendFileSync(process.env.GITHUB_OUTPUT,'commit='+parsed.commit+'\n');
  } catch {
    console.error('Invalid Auth webhook request.');
    process.exitCode=1;
  }
}
