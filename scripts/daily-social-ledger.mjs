// Durable receipts for Discord's non-idempotent webhook API. The issue contains
// no URLs, credentials, tokens, account handles, or channel names.
import {createHash} from 'node:crypto';

export function discordReceiptKey(webhook) {
  return 'discord-'+createHash('sha256').update(webhook).digest('hex').slice(0,24);
}

export function createGithubReceiptLedger({token,repo,issueNumber,fetchImpl=fetch}) {
  if(!token||repo!=='killjoy00/mtg-ev-analyzer'||issueNumber!==1135)
    throw Error('Protected GitHub Daily receipt ledger is not configured.');
  const root='https://api.github.com/repos/'+repo;
  async function github(path,{method='GET',body}={}) {
    const response=await fetchImpl(root+path,{
      method,
      headers:{
        authorization:'Bearer '+token,
        accept:'application/vnd.github+json',
        ...(body?{'content-type':'application/json'}:{}),
      },
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(15_000),
    });
    if(!response.ok)throw Error('Daily receipt ledger returned HTTP '+response.status+'.');
    return response.status===204?null:response.json();
  }
  function entryBody(day,channel,status) {
    return 'packone-daily-receipt:'+day+':'+channel+'\nstatus: '+status+
      '\nNon-secret automated posting state; see issue description.';
  }
  async function existing(day,channel) {
    const marker='packone-daily-receipt:'+day+':'+channel+'\n';
    const since=encodeURIComponent(day+'T00:00:00Z');
    // Limit the search to receipts updated during this Pacific product day.
    for(let page=1;page<=20;page++) {
      const batch=await github('/issues/'+issueNumber+'/comments?since='+since+
        '&per_page=100&page='+page);
      const found=batch.find(c=>typeof c.body==='string'&&c.body.startsWith(marker));
      if(found)return found;
      if(batch.length<100)return null;
    }
    throw Error('Daily receipt ledger pagination exceeded its safety limit.');
  }
  return {
    async claim(day,channel) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^discord-[0-9a-f]{24}$/.test(channel))
        throw Error('Invalid Daily receipt identity.');
      const found=await existing(day,channel);
      if(found) {
        if(found.body.includes('\nstatus: posted\n'))return {alreadyPosted:true};
        // A webhook may have succeeded before the final receipt was written.
        // Do not risk a second delivery; require reconciliation.
        throw Error('An earlier Discord delivery is unconfirmed; manual reconciliation required.');
      }
      const item=await github('/issues/'+issueNumber+'/comments',{
        method:'POST',body:{body:entryBody(day,channel,'claimed')},
      });
      if(!Number.isSafeInteger(item?.id))throw Error('Daily claim was not acknowledged.');
      return {id:item.id,alreadyPosted:false};
    },
    async markPosted(day,channel,claim) {
      if(!Number.isSafeInteger(claim?.id)||claim.alreadyPosted)
        throw Error('Invalid Daily receipt claim.');
      await github('/issues/comments/'+claim.id,{
        method:'PATCH',body:{body:entryBody(day,channel,'posted')},
      });
    },
  };
}
