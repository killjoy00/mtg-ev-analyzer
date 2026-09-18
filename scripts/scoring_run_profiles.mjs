// Export evaluation run profiles using the product's policy helpers. Choices
// are sampled later from held-out cohorts, not from the production database.
import fs from 'node:fs';
import {seededRandom} from '../gameplay.mjs';
import {runPickWindows} from '../draft-run.mjs';
import {dailySetPlan} from '../daily-selection.mjs';
import snapshot from '../results/rebuild-2026-09-18/live-metadata.json' with {type:'json'};
import {runDifficultyBands,requiredSetRounds,chooseRunSet,
  regularRunSet} from '../draft-run-policy.mjs';

const input=JSON.parse(fs.readFileSync(0,'utf8'));
const random=seededRandom(input.seed);
const windows=runPickWindows(input.environment);
const groups=input.groups.filter(g=>input.environment==='powered-cube'
  ? g.set_id==='powered-cube' : regularRunSet(g.set_id));
// An explicitly restricted evaluation corpus, not a full production replay.
const metadata=(input.metadata||snapshot).filter(s=>groups.some(g=>g.set_id===s.set_id));
const profiles=[];
for(let i=0;i<input.runs;i++) {
  const bands=runDifficultyBands(random);
  const required=input.daily?dailySetPlan(metadata,input.day,random):[];
  // Same easy-to-medium fallback as run selection, within this sample.
  for(let j=0;j<bands.length;j++) if(bands[j]==='easy'&&!groups.some(g=>
    g.band==='easy'&&g.pick_number>=windows[j][0]&&g.pick_number<=windows[j][1])) bands[j]='medium';
  const reserved=requiredSetRounds(groups,bands,windows,random,required);
  const used=new Set();
  const profile=[];
  for(let j=0;j<windows.length;j++) {
    const [lo,hi]=windows[j];
    let available=[...new Set(groups.filter(g=>g.band===bands[j]&&g.pick_number>=lo&&g.pick_number<=hi).map(g=>g.set_id))];
    let set=reserved.get(j);
    if(!set) {
      available=available.filter(s=>!required.includes(s));
      const fresh=available.filter(s=>!used.has(s));
      if(fresh.length) available=fresh;
      else {
        const different=available.filter(s=>s!==profile.at(-1)?.[0]);
        if(different.length) available=different;
      }
      available.sort();
      set=chooseRunSet(available,random,input.daily,undefined,input.day);
    }
    if(!set) throw Error('Insufficient held-out coverage for this run profile');
    used.add(set);profile.push([set,lo,hi,bands[j]]);
  }
  profiles.push(profile);
}
process.stdout.write(JSON.stringify(profiles));
