// Offline evaluation behind docs/DIFFICULTY-REVIEW-2026-11.md.
//
//   node research/difficulty-review-2026-11/evaluate.mjs PRIVATE_EXPORT_DIR
//
// PRIVATE_EXPORT_DIR holds the read-only exports described in README.md
// (per-puzzle aggregates only: no player, account or session identifiers).
// The directory is never committed. The script prints aggregate tables and
// writes nothing. It scores every puzzle with the shipped feature code
// (puzzle-selection.mjs), so the numbers describe the rule as released.
import fs from 'node:fs';
import path from 'node:path';
import {puzzleSelectionFeatures,isClearEasy,STAKES_RULE} from '../../puzzle-selection.mjs';
import {rateDraftRunPuzzle} from '../../draft-run-difficulty.mjs';
import {loadStrengthTable} from '../../scripts/score-puzzle-selection.mjs';

const dir=process.argv[2];
if(!dir)throw Error('Usage: node research/difficulty-review-2026-11/evaluate.mjs PRIVATE_EXPORT_DIR');
// Each export is a JSON array of objects, or of {j:"<json text>"} rows.
const load=name=>{
  const file=path.join(dir,name);
  if(!fs.existsSync(file))return null;
  return JSON.parse(fs.readFileSync(file,'utf8')).map(row=>typeof row?.j==='string'?JSON.parse(row.j):row);
};
const strengths=new Map();
const strength=set=>{if(!strengths.has(set))strengths.set(set,loadStrengthTable(set));return strengths.get(set);};
// Export rows carry candidates as [id,name,rarity,mana_cost,type_line,model_probability]
// and prior picks as [name,rarity,mana_cost,type_line].
function scored(row) {
  const puzzle={puzzle_id:row.id,historical_pick_id:row.hist,
    candidates:row.c.map(([id,name,,mana_cost,type_line,model_probability])=>({id,name,mana_cost,type_line,model_probability})),
    prior_picks:(row.pp||[]).map(([name,,mana_cost])=>({name,mana_cost}))};
  const rating=rateDraftRunPuzzle(puzzle),features=puzzleSelectionFeatures(puzzle,{strength:strength(row.set)});
  const total=puzzle.candidates.reduce((sum,c)=>sum+c.model_probability,0);
  const shares=puzzle.candidates.map(c=>c.model_probability/total);
  return {row,puzzle,rating,features,band:rating.band,
    leader:rating.targetSupportRatio>=1,
    trophyShare:puzzle.candidates.find(c=>c.id===row.hist).model_probability/total,
    entropy:-shares.reduce((sum,q)=>sum+(q>0?q*Math.log(q):0),0),
    clear:rating.band==='easy'&&isClearEasy({pick_number:row.pick,target_support_ratio:rating.targetSupportRatio,...features})};
}
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const pct=value=>(100*value).toFixed(1).padStart(5)+'%';
// Deterministic bootstrap (linear congruential generator).
let state=20261116;
const random=()=>{state=(state*1664525+1013904223)>>>0;return state/2**32;};
const resample=items=>items.map(()=>items[Math.floor(random()*items.length)]);
const interval=(draws)=>{draws.sort((a,b)=>a-b);return `[${(100*draws[Math.floor(.025*draws.length)]).toFixed(1)}, ${(100*draws[Math.floor(.975*draws.length)]).toFixed(1)}]`;};
const REGULAR=row=>row.set!=='powered-cube';

// 1. Served Dailies: per-puzzle first-encounter aggregates joined to payloads.
const answers=load('answers.json'),meta=load('meta.json');
if(answers&&meta) {
  const byId=new Map(answers.map(a=>[a.id,a])),seen=new Set(),panel=[];
  for(const row of meta) {
    const a=byId.get(row.id);
    if(!a||a.n<50||seen.has(row.id))continue;
    seen.add(row.id);
    panel.push({...scored(row),a,match:a.tm/a.n,under50:a.lt50/a.n,over75:a.n75/a.n,score:Number(a.ms),seconds:a.med/1000});
  }
  console.log(`SERVED DAILIES: ${panel.length} puzzles with 50+ first-encounter answers, ${panel.reduce((n,p)=>n+p.a.n,0)} answers`);
  console.log('band      puzzles  trophy match  75+ credit  under 50  mean score  median seconds (per puzzle)');
  for(const band of ['easy','medium','hard']) {
    const group=panel.filter(p=>p.band===band),n=group.reduce((sum,p)=>sum+p.a.n,0);
    const weighted=key=>group.reduce((sum,p)=>sum+p.a[key],0)/n;
    console.log(band.padEnd(9),String(group.length).padStart(7),pct(weighted('tm')).padStart(13),pct(weighted('n75')).padStart(11),pct(weighted('lt50')).padStart(9),
      (group.reduce((sum,p)=>sum+p.score*p.a.n,0)/n).toFixed(1).padStart(11),mean(group.map(p=>p.seconds)).toFixed(1).padStart(15));
  }
  // Leave one whole format out; predict each puzzle's outcome by least squares.
  const formats=['fra','powered-cube','msh','hob','sos'],held=panel.filter(p=>formats.includes(p.row.set));
  const fit=(rows,x,y)=>{
    const k=x(rows[0]).length,m=Array.from({length:k},()=>Array(k+1).fill(0));
    for(const row of rows){const v=x(row);for(let a=0;a<k;a++){m[a][k]+=v[a]*y(row);for(let b=0;b<k;b++)m[a][b]+=v[a]*v[b];}}
    for(let c=0;c<k;c++){
      m[c][c]+=1e-9;let pivot=c;
      for(let r=c+1;r<k;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
      [m[c],m[pivot]]=[m[pivot],m[c]];
      for(let r=0;r<k;r++)if(r!==c){const f=m[r][c]/m[c][c];for(let j=c;j<=k;j++)m[r][j]-=f*m[c][j];}
    }
    const w=m.map((r,i)=>r[k]/r[i]);
    return row=>x(row).reduce((sum,v,i)=>sum+v*w[i],0);
  };
  const predictors={
    'constant':()=>[1],
    'current band':p=>[1,+(p.band==='medium'),+(p.band==='hard')],
    'current rating':p=>[1,p.rating.rating/100],
    'model share of trophy pick':p=>[1,p.trophyShare],
    'trophy share + rating':p=>[1,p.trophyShare,p.rating.rating/100],
    'trophy share + rating + entropy':p=>[1,p.trophyShare,p.rating.rating/100,p.entropy],
  };
  const outcomes={'trophy match':p=>p.match,'under 50':p=>p.under50,'mean score':p=>p.score/100,'decision time':p=>p.seconds/30};
  console.log(`\nHELD-OUT FORMAT ERROR (mean squared error, ${held.length} puzzles; each format predicted from the other four)`);
  console.log(''.padEnd(34),Object.keys(outcomes).map(name=>name.padStart(14)).join(''));
  for(const [name,x] of Object.entries(predictors)) {
    const cells=Object.values(outcomes).map(y=>mean(formats.flatMap(format=>{
      const model=fit(held.filter(p=>p.row.set!==format),x,y);
      return held.filter(p=>p.row.set===format).map(p=>(model(p)-y(p))**2);
    })).toFixed(4).padStart(14));
    console.log(name.padEnd(34),cells.join(''));
  }
  const easy=panel.filter(p=>p.band==='easy'&&REGULAR(p.row));
  const line=(label,group)=>console.log(' '+label.padEnd(12),String(group.length).padStart(3),'puzzles | under 50',pct(mean(group.map(p=>p.under50))),'| trophy match',pct(mean(group.map(p=>p.match))),
    '| majority under 50:',group.filter(p=>p.under50>=.5).length,'| 90%+ match:',group.filter(p=>p.match>=.9).length);
  console.log('\nSERVED EASY PUZZLES, REGULAR SETS (the sample the rule was shaped on; per-puzzle means)');
  for(const [label,keep] of [['all sets',()=>true],['FRA',p=>p.row.set==='fra'],['other sets',p=>p.row.set!=='fra']]) {
    console.log(label);
    const group=easy.filter(keep);
    line('current',group);line('rule keeps',group.filter(p=>p.clear));line('rule drops',group.filter(p=>!p.clear));
  }
}

// 2. Practice holdout: easy-band practice answers, one row per puzzle.
const practice=load('practice_easy.json');
if(practice) {
  const rows=practice.map(scored).filter(p=>p.band==='easy');
  const rate=(group,key)=>group.reduce((sum,p)=>sum+p.row[key],0)/Math.max(1,group.reduce((sum,p)=>sum+p.row.n,0));
  const kept=rows.filter(p=>p.clear),dropped=rows.filter(p=>!p.clear);
  console.log(`\nPRACTICE HOLDOUT: ${rows.length} easy puzzles, ${rows.reduce((n,p)=>n+p.row.n,0)} first-encounter answers, ${new Set(rows.map(p=>p.row.set)).size} sets; rule keeps ${kept.length} (${pct(kept.length/rows.length).trim()})`);
  for(const [key,label] of [['lt50','under 50'],['tm','trophy match'],['n75','75+ credit']]) {
    const versusDropped=[],versusAll=[];
    for(let i=0;i<4000;i++) {
      versusDropped.push(rate(resample(kept),key)-rate(resample(dropped),key));
      const sample=resample(rows);versusAll.push(rate(sample.filter(p=>p.clear),key)-rate(sample,key));
    }
    console.log(' '+label.padEnd(13),'current',pct(rate(rows,key)),'| rule',pct(rate(kept,key)),'| dropped',pct(rate(dropped,key)),
      '| rule - dropped',(100*(rate(kept,key)-rate(dropped,key))).toFixed(1),interval(versusDropped),'| rule - current',(100*(rate(kept,key)-rate(rows,key))).toFixed(1),interval(versusAll));
  }
  let agree=0,compared=0;
  for(const set of new Set(rows.map(p=>p.row.set))) {
    const a=kept.filter(p=>p.row.set===set),b=dropped.filter(p=>p.row.set===set);
    if(a.reduce((n,p)=>n+p.row.n,0)<15||b.reduce((n,p)=>n+p.row.n,0)<15)continue;
    compared++;if(rate(a,'lt50')<rate(b,'lt50'))agree++;
  }
  console.log(` sets with 15+ answers in each arm where the rule arm has fewer under-50 answers: ${agree}/${compared}`);
  const others=rows.filter(p=>p.row.set!=='fra');
  console.log(' excluding FRA: rule',pct(rate(others.filter(p=>p.clear),'lt50')),'| dropped',pct(rate(others.filter(p=>!p.clear),'lt50')));
}

// 3. Current unserved inventory: serving easy pools, P1P1-P1P5.
for(const file of fs.readdirSync(dir).filter(name=>/^pool_.*\.json$/.test(name)).sort()) {
  const rows=load(file).map(scored).filter(p=>p.band==='easy')
    .filter(p=>!(p.row.pick>=STAKES_RULE.no_land_answer_from_pick&&p.row.land)&&(p.row.pick<STAKES_RULE.deck_gate_from_pick||p.row.deck===true));
  const trophy=p=>p.puzzle.candidates.find(c=>c.id===p.row.hist).name;
  console.log(`\nINVENTORY ${file}: easy pool -> clear-Easy pool, distinct answer cards`);
  for(const set of [...new Set(rows.map(p=>p.row.set))].sort())for(let pick=1;pick<=5;pick++) {
    const pool=rows.filter(p=>p.row.set===set&&p.row.pick===pick),clear=pool.filter(p=>p.clear);
    if(pool.length)console.log(` ${set} P1P${pick}: ${pool.length} -> ${clear.length} (${pct(clear.length/pool.length).trim()}), cards ${new Set(pool.map(trophy)).size} -> ${new Set(clear.map(trophy)).size}`);
  }
  // One Easy a day for a year from one set, under the Daily repeat windows
  // (28-day decision, 7-day source), averaged over 20 simulated years. A day
  // is unfilled only if both the clear pool and the whole easy pool are empty
  // (a set whose archive starts at P1P2 has no P1P1 pool under either rule;
  // the live selector then serves a medium decision).
  const YEARS=20;
  for(const set of [...new Set(rows.map(p=>p.row.set))].sort())for(const rule of [false,true]) {
    const total={unfilled:0,fallback:0,distinct:0,top:0,repeats:0};
    for(let year=0;year<YEARS;year++) {
      const decision=new Map(),source=new Map(),cards=new Map(),recent=[];
      for(let day=0;day<365;day++) {
        const pick=1+Math.floor(random()*5);
        const open=p=>p.row.set===set&&p.row.pick===pick&&!(day-(decision.get(p.row.id)??-99)<28)&&!(day-(source.get(p.row.src)??-99)<7);
        let pool=rows.filter(p=>open(p)&&(!rule||p.clear));
        if(!pool.length&&rule){total.fallback++;pool=rows.filter(open);}
        if(!pool.length){total.unfilled++;continue;}
        const chosen=pool[Math.floor(random()*pool.length)],card=trophy(chosen);
        decision.set(chosen.row.id,day);source.set(chosen.row.src,day);cards.set(card,(cards.get(card)||0)+1);
        if(recent.slice(-7).includes(card))total.repeats++;
        recent.push(card);
      }
      total.distinct+=cards.size;total.top+=Math.max(0,...cards.values());
    }
    const per=key=>(total[key]/YEARS).toFixed(0);
    console.log(` ${set} ${rule?'clear-Easy rule':'current draw   '} (per year): unfilled ${per('unfilled')}, fell back ${per('fallback')}, distinct answer cards ${per('distinct')}, most frequent answer ${per('top')} days, same answer within a week ${per('repeats')} days`);
  }
}
