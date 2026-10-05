import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCampaignEntries} from '../campaign-links.mjs';
import {renderCreatorChallengePage,validateCreatorPageEntries} from '../creator-challenge-pages.mjs';

async function exists(file) {
  try {await access(file);return true;} catch {return false;}
}

export async function checkCreatorChallenges({root=process.cwd()}={}) {
  const creator=validateCreatorPageEntries(JSON.parse(await readFile(path.join(root,'creator-challenges.json'),'utf8')));
  const campaigns=validateCampaignEntries(JSON.parse(await readFile(path.join(root,'campaign-links.json'),'utf8')));
  const ordinary=new Set(campaigns.map(entry=>entry.slug));
  const problems=[];
  for(const entry of creator) {
    if(ordinary.has(entry.slug))problems.push(`creator slug collides with ordinary campaign: ${entry.slug}`);
    const route=path.join(root,'go',entry.slug,'index.html');
    const current=await readFile(route,'utf8').catch(()=>null);
    const expected=renderCreatorChallengePage(entry);
    if(current===null)problems.push(`missing creator page: go/${entry.slug}/index.html`);
    else if(current!==expected)problems.push(`stale creator page: go/${entry.slug}/index.html`);
    const card=path.join(root,'go',entry.slug,'creator-card.png');
    const hasCard=await exists(card);
    if(entry.status==='published'&&!hasCard)problems.push(`missing creator social card: go/${entry.slug}/creator-card.png`);
    if(entry.status==='retired'&&hasCard)problems.push(`retired creator route retains social card: go/${entry.slug}/creator-card.png`);
  }
  if(problems.length)throw new Error(problems.join('\n'));
  return {entries:creator.length,published:creator.filter(entry=>entry.status==='published').length,retired:creator.filter(entry=>entry.status==='retired').length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  checkCreatorChallenges().then(result=>{
    console.log(`Creator challenge routes are fresh (${result.entries}; ${result.published} published, ${result.retired} retired).`);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
