import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCampaignEntries} from '../campaign-links.mjs';
import {renderCreatorChallengePage,validateCreatorPageEntries} from '../creator-challenge-pages.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function prepareCreatorChallengePublish({root=process.cwd(),action='publish',entry}={}) {
  if(!['publish','retire'].includes(action))throw Error('Creator challenge publication action must be publish or retire.');
  const registryPath=path.join(root,'creator-challenges.json');
  const campaigns=validateCampaignEntries(JSON.parse(await readFile(path.join(root,'campaign-links.json'),'utf8')));
  let registry=validateCreatorPageEntries(JSON.parse(await readFile(registryPath,'utf8')));
  const incoming=validateCreatorPageEntries([action==='retire'?{id:entry.id,slug:entry.slug,status:'retired'}:{...entry,status:'published'}])[0];
  if(campaigns.some(candidate=>candidate.slug===incoming.slug))
    throw Error(`Creator challenge slug "${incoming.slug}" collides with an ordinary campaign link.`);
  const idMatch=registry.find(candidate=>candidate.id===incoming.id);
  if(idMatch&&idMatch.slug!==incoming.slug)throw Error('Creator challenge source association is immutable after publication.');
  const slugMatch=registry.find(candidate=>candidate.slug===incoming.slug);
  if(slugMatch&&slugMatch.id!==incoming.id)throw Error('Creator challenge slug is already reserved by a different challenge.');
  if(slugMatch?.status==='retired'&&action==='publish')throw Error('Retired creator challenge slugs cannot be recycled.');
  if(action==='publish'&&slugMatch&&!same(slugMatch,incoming))
    throw Error('Published creator challenge metadata does not match the existing immutable route.');
  if(slugMatch)registry=registry.map(candidate=>candidate.slug===incoming.slug?incoming:candidate);
  else registry=[...registry,incoming].sort((a,b)=>a.slug.localeCompare(b.slug));
  await writeFile(registryPath,JSON.stringify(registry,null,2)+'\n','utf8');
  const routeDir=path.join(root,'go',incoming.slug);
  await mkdir(routeDir,{recursive:true});
  await writeFile(path.join(routeDir,'index.html'),renderCreatorChallengePage(incoming),'utf8');
  if(action==='retire')await rm(path.join(routeDir,'creator-card.png'),{force:true});
  return {entry:incoming,created:!slugMatch,retired:action==='retire'};
}

function entryFromEnv(env) {
  return {
    id:String(env.CREATOR_CHALLENGE_ID||''),
    slug:String(env.CAMPAIGN_SLUG||''),
    creator_name:String(env.CREATOR_NAME||''),
    headline:String(env.CREATOR_HEADLINE||''),
    score:Number(env.CREATOR_SCORE),
    environment:String(env.CREATOR_ENVIRONMENT||''),
    source_type:String(env.CREATOR_SOURCE_TYPE||''),
    source_day:String(env.CREATOR_SOURCE_DAY||'')||null,
    source:String(env.CAMPAIGN_SOURCE||''),
    campaign:String(env.CAMPAIGN_NAME||''),
    ...(String(env.CAMPAIGN_MEDIUM||'')?{medium:String(env.CAMPAIGN_MEDIUM)}:{}),
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const action=String(process.env.CREATOR_ACTION||'publish');
  prepareCreatorChallengePublish({action,entry:entryFromEnv(process.env)}).then(result=>{
    console.log(result.retired?`Prepared retired creator route ${result.entry.slug}.`:`Prepared creator challenge ${result.entry.slug}.`);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
