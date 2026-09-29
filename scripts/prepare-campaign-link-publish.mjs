import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCampaignEntries} from '../campaign-links.mjs';
import {generateCampaignLinks} from './generate-campaign-links.mjs';

const sameEntry=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function prepareCampaignLinkPublish({root=process.cwd(),entry}={}) {
  const incoming=validateCampaignEntries([entry])[0];
  const configPath=path.join(root,'campaign-links.json');
  const existing=validateCampaignEntries(JSON.parse(await readFile(configPath,'utf8')));
  const prior=existing.find(candidate=>candidate.slug===incoming.slug);
  if(prior&&!sameEntry(prior,incoming))
    throw new Error(`Campaign slug "${incoming.slug}" already exists with different attribution.`);
  const next=prior?existing:[...existing,incoming].sort((a,b)=>a.slug.localeCompare(b.slug));
  await writeFile(configPath,JSON.stringify(next,null,2)+'\n','utf8');
  await generateCampaignLinks({root});
  return {created:!prior,entry:incoming};
}

function entryFromEnv(env) {
  const entry={
    slug:String(env.CAMPAIGN_SLUG||''),
    destination:String(env.CAMPAIGN_DESTINATION||''),
    source:String(env.CAMPAIGN_SOURCE||''),
    campaign:String(env.CAMPAIGN_NAME||''),
  };
  if(String(env.CAMPAIGN_MEDIUM||''))entry.medium=String(env.CAMPAIGN_MEDIUM);
  return entry;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  prepareCampaignLinkPublish({entry:entryFromEnv(process.env)}).then(result=>{
    console.log(result.created
      ?`Prepared campaign link ${result.entry.slug}.`
      :`Campaign link ${result.entry.slug} is already published in source.`);
  }).catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}
