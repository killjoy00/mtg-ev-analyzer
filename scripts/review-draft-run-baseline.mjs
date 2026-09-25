// Reproduce the product review's frozen-baseline scoring audit. No network or
// production writes. These unweighted puzzle statistics are not run averages.
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {gradeDraftRunPick,validateDraftRunPuzzle,interestingDraftRunPuzzle} from '../draft-run.mjs';
import {eligibleRunPuzzle,regularRunSet} from '../draft-run-policy.mjs';
import {rateDraftRunPuzzle} from '../draft-run-difficulty.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=path.join(root,'corpus/draft-run');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json.gz')&&f!=='source-matches.json.gz').sort();
const groups={mixed:[],cube:[]};
let puzzles=0,cards=0,invalid=0,mismatches=0;
for(const file of files) {
  const data=JSON.parse(gunzipSync(fs.readFileSync(path.join(dir,file))));
  for(const p of data) {
    puzzles++;
    if(!validateDraftRunPuzzle(p)){invalid++;continue;}
    const leader=Math.max(...p.candidates.map(c=>Number(c.model_probability)));
    const scores=p.candidates.map(c=>{
      const expected=c.id===p.historical_pick_id?100:Math.round(95*(Number(c.model_probability)/leader));
      cards++;if(gradeDraftRunPick(p,c.id).score!==expected)mismatches++;
      return expected;
    });
    if(!interestingDraftRunPuzzle(p)||!eligibleRunPuzzle(p))continue;
    const environment=p.set_id==='powered-cube'?'cube':regularRunSet(p.set_id)?'mixed':null;
    if(!environment)continue;
    const top=p.candidates.find(c=>Number(c.model_probability)===leader);
    groups[environment].push({
      band:rateDraftRunPuzzle(p).band,
      random:scores.reduce((a,b)=>a+b,0)/scores.length,
      model:top.id===p.historical_pick_id?100:95,
      disagreement:Number(p.candidates.find(c=>c.id===p.historical_pick_id).model_probability)/leader<0.2,
    });
  }
}
const mean=(rows,key)=>rows.reduce((s,r)=>s+Number(r[key]),0)/rows.length;
const rounded=n=>Number(n.toFixed(4));
const summary=rows=>({puzzles:rows.length,random_card_mean:rounded(mean(rows,'random')),
  model_leader_mean:rounded(mean(rows,'model')),model_target_disagreement_rate:rounded(mean(rows,'disagreement')),
  bands:Object.fromEntries(['easy','medium','hard'].map(b=>{const r=rows.filter(x=>x.band===b);return[b,{puzzles:r.length,random_card_mean:rounded(mean(r,'random'))}];}))});
console.log(JSON.stringify({scope:'Checked-in frozen v6 baseline, not the expanded production corpus or a weighted run sample',
  method:'Each eligible puzzle has equal weight; cards within a puzzle are uniform. Exact support ties use candidate input order. Model agreement is not measured human skill.',
  files:files.length,puzzles,cards_checked:cards,invalid_puzzles:invalid,formula_mismatches:mismatches,
  groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summary(v)]))},null,2));
if(invalid||mismatches)process.exitCode=1;
