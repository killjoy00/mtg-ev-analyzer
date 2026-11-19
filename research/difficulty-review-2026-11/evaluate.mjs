// Offline evaluation behind docs/DIFFICULTY-REVIEW-2026-11.md.
//
//   node research/difficulty-review-2026-11/evaluate.mjs PRIVATE_EXPORT_DIR
//
// PRIVATE_EXPORT_DIR holds the read-only exports described in README.md. They
// carry no player, account or session identifier: practice answers use an
// anonymous per-export index so intervals can resample whole players. The
// directory is never committed. The script prints aggregate tables and writes
// nothing. It scores every puzzle with the shipped feature code
// (puzzle-selection.mjs), so the numbers describe the rule as released.
import fs from 'node:fs';
import path from 'node:path';
import {puzzleSelectionFeatures,isClearEasy,EASY_RULE,STAKES_RULE} from '../../puzzle-selection.mjs';
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
  const inputs={pick_number:row.pick,target_support_ratio:rating.targetSupportRatio,...features};
  const easy=rating.band==='easy';
  return {row,puzzle,rating,features,band:rating.band,
    trophyShare:puzzle.candidates.find(c=>c.id===row.hist).model_probability/total,
    entropy:-shares.reduce((sum,q)=>sum+(q>0?q*Math.log(q):0),0),
    clear:easy&&isClearEasy(inputs),
    // The rule as first written down, before the practice export was read.
    preregistered:easy&&isClearEasy(inputs,{...EASY_RULE,colour_fit_from_pick:2}),
    clearAt:margin=>easy&&isClearEasy(inputs,{...EASY_RULE,min_strength_margin:margin})};
}
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const pct=value=>(100*value).toFixed(1).padStart(5)+'%';
const points=value=>(100*value).toFixed(1);
// Deterministic bootstrap (linear congruential generator).
let state=20261116;
const random=()=>{state=(state*1664525+1013904223)>>>0;return state/2**32;};
const interval=draws=>{draws=draws.filter(Number.isFinite).sort((a,b)=>a-b);return `[${points(draws[Math.floor(.025*draws.length)])}, ${points(draws[Math.floor(.975*draws.length)])}]`;};
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
  const line=(label,group)=>console.log(' '+label.padEnd(18),String(group.length).padStart(3),'puzzles | under 50',group.length?pct(mean(group.map(p=>p.under50))):'    -','| trophy match',group.length?pct(mean(group.map(p=>p.match))):'    -',
    '| majority under 50:',group.filter(p=>p.under50>=.5).length,'| 90%+ match:',group.filter(p=>p.match>=.9).length);
  console.log('\nSERVED EASY PUZZLES, REGULAR SETS (the sample the rule was shaped on; per-puzzle means)');
  for(const [label,keep] of [['all sets',()=>true],['FRA',p=>p.row.set==='fra'],['other sets',p=>p.row.set!=='fra']]) {
    console.log(label);
    const group=easy.filter(keep);
    line('current',group);line('rule keeps',group.filter(p=>p.clear));line('rule drops',group.filter(p=>!p.clear));
  }
  // The forward check: Easy puzzles by the rule that scheduled them. The
  // -v2 rows are empty until Dailies have been generated with the rule.
  console.log('\nSERVED EASY PUZZLES BY SELECTION RULE (latest and mixed; the forward check reads the -v2 rows)');
  for(const rule of [null,'latest-stakes-v1','mixed-stakes-v1','latest-stakes-v2','mixed-stakes-v2'])
    line(rule||'band draw',easy.filter(p=>(p.row.rule||null)===rule&&['latest','mixed'].includes(p.row.env)));
}

// 2. Practice holdout: one row per first-encounter answer, with an anonymous
// player index, joined to the easy-band practice puzzles.
const practice=load('practice_easy.json'),practiceAnswers=load('practice_answers.json');
if(practice&&practiceAnswers) {
  const puzzles=new Map(practice.map(scored).filter(p=>p.band==='easy').map(p=>[p.row.id,p]));
  const rows=practiceAnswers.filter(a=>puzzles.has(a.id)).map(a=>({...puzzles.get(a.id),player:a.p,under:a.s<50?1:0,match:a.m?1:0,high:a.s>=75?1:0}));
  const players=new Map();
  for(const row of rows){if(!players.has(row.player))players.set(row.player,[]);players.get(row.player).push(row);}
  const groups=[...players.values()],sizes=groups.map(g=>g.length).sort((a,b)=>b-a);
  const rate=(group,key)=>group.length?group.reduce((sum,p)=>sum+p[key],0)/group.length:NaN;
  // Resample whole players: one player's answers are not independent.
  const bootstrap=statistic=>{const draws=[];for(let i=0;i<5000;i++)draws.push(statistic(groups.flatMap(()=>groups[Math.floor(random()*groups.length)])));return interval(draws);};
  console.log(`\nPRACTICE HOLDOUT: ${new Set(rows.map(p=>p.row.id)).size} easy puzzles, ${rows.length} first-encounter answers, ${groups.length} players, ${new Set(rows.map(p=>p.row.set)).size} sets`);
  console.log(` answers per player: median ${sizes[Math.floor(sizes.length/2)]}, largest ${sizes[0]}, five most active ${sizes.slice(0,5).reduce((a,b)=>a+b,0)} (${pct(sizes.slice(0,5).reduce((a,b)=>a+b,0)/rows.length).trim()})`);
  const report=(label,keep)=>{
    const kept=rows.filter(keep),dropped=rows.filter(p=>!keep(p));
    console.log(`${label}: keeps ${kept.length} answers (${pct(kept.length/rows.length).trim()}); intervals resample players`);
    for(const [key,name] of [['under','under 50'],['match','trophy match'],['high','75+ credit']])
      console.log(' '+name.padEnd(13),'current',pct(rate(rows,key)),'| rule',pct(rate(kept,key)),'| dropped',pct(rate(dropped,key)),
        '| rule - dropped',points(rate(kept,key)-rate(dropped,key)),bootstrap(s=>rate(s.filter(keep),key)-rate(s.filter(p=>!keep(p)),key)),
        '| rule - current',points(rate(kept,key)-rate(rows,key)),bootstrap(s=>rate(s.filter(keep),key)-rate(s,key)));
    // Each player against themselves, then with the heaviest players removed.
    const both=groups.filter(g=>g.some(keep)&&g.some(p=>!keep(p)));
    const within=both.map(g=>rate(g.filter(keep),'under')-rate(g.filter(p=>!keep(p)),'under'));
    const centre=mean(within),error=Math.sqrt(within.reduce((sum,d)=>sum+(d-centre)**2,0)/(within.length-1)/within.length);
    console.log(` within-player under-50 difference: ${both.length} players with both kinds, mean ${points(centre)} [${points(centre-1.96*error)}, ${points(centre+1.96*error)}]; lower for ${within.filter(d=>d<0).length}, equal for ${within.filter(d=>d===0).length}, higher for ${within.filter(d=>d>0).length}`);
    const heavy=new Set([...players.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,5).map(([player])=>player)),rest=rows.filter(p=>!heavy.has(p.player));
    console.log(` without the five most active players: current ${pct(rate(rest,'under')).trim()}, rule ${pct(rate(rest.filter(keep),'under')).trim()}, dropped ${pct(rate(rest.filter(p=>!keep(p)),'under')).trim()}`);
  };
  report('PRE-REGISTERED RULE (colour fit from P1P2)',p=>p.preregistered);
  report('SHIPPED RULE (colour fit from P1P3; exploratory on this export)',p=>p.clear);
  console.log('SHIPPED RULE BY SET (40+ answers): answers | kept, under 50 | dropped, under 50 | difference');
  const differences=[];
  for(const set of [...new Set(rows.map(p=>p.row.set))].sort()) {
    const group=rows.filter(p=>p.row.set===set),kept=group.filter(p=>p.clear),dropped=group.filter(p=>!p.clear);
    if(kept.length>=10&&dropped.length>=10)differences.push(rate(kept,'under')-rate(dropped,'under'));
    if(group.length>=40)console.log(' '+set.padEnd(5),String(group.length).padStart(4),'|',String(kept.length).padStart(3),pct(rate(kept,'under')),'|',String(dropped.length).padStart(3),pct(rate(dropped,'under')),'|',points(rate(kept,'under')-rate(dropped,'under')).padStart(6));
  }
  differences.sort((a,b)=>a-b);
  const quantile=q=>points(differences[Math.floor(q*(differences.length-1))]);
  console.log(` sets with 10+ answers in each arm: ${differences.length}; rule arm lower in ${differences.filter(d=>d<0).length}; difference min ${quantile(0)}, quartiles ${quantile(.25)} / ${quantile(.5)} / ${quantile(.75)}, max ${quantile(1)}`);
  // Sensitivity to the strength cutoff. The shipped value is 0; nothing here
  // is used to choose it.
  console.log('STRENGTH-MARGIN SENSITIVITY (leader and colour fit unchanged): cutoff | kept share | under 50 kept | dropped | kept - dropped');
  for(const cutoff of [-2,-1,-0.5,-0.25,-0.1,0,0.1,0.25,0.5,1]) {
    const keep=p=>p.clearAt(cutoff),kept=rows.filter(keep),dropped=rows.filter(p=>!keep(p));
    console.log(' '+String(cutoff).padStart(5),'|',pct(kept.length/rows.length),'|',pct(rate(kept,'under')),'|',pct(rate(dropped,'under')),'|',points(rate(kept,'under')-rate(dropped,'under')).padStart(6),bootstrap(s=>rate(s.filter(keep),'under')-rate(s.filter(p=>!keep(p)),'under')));
  }
  const near=rows.filter(p=>!p.clear&&p.clearAt(-0.25)).length;
  console.log(` answers rejected only by a deficit under 0.25 points: ${near} (${pct(near/rows.length).trim()}); answers with no strength margin: ${rows.filter(p=>p.features.trophy_strength_margin==null).length}`);
}

// 3. Current unserved inventory: serving easy pools, P1P1-P1P5.
for(const file of fs.readdirSync(dir).filter(name=>/^pool_.*\.json$/.test(name)).sort()) {
  const rows=load(file).map(scored).filter(p=>p.band==='easy')
    .filter(p=>!(p.row.pick>=STAKES_RULE.no_land_answer_from_pick&&p.row.land)&&(p.row.pick<STAKES_RULE.deck_gate_from_pick||p.row.deck===true));
  const trophy=p=>p.features.trophy_card_id;
  console.log(`\nINVENTORY ${file}: easy pool -> clear-Easy pool, distinct answer cards; no strength margin: ${rows.filter(p=>p.features.trophy_strength_margin==null).length} of ${rows.length}`);
  for(const set of [...new Set(rows.map(p=>p.row.set))].sort())for(let pick=1;pick<=5;pick++) {
    const pool=rows.filter(p=>p.row.set===set&&p.row.pick===pick),clear=pool.filter(p=>p.clear);
    if(pool.length)console.log(` ${set} P1P${pick}: ${pool.length} -> ${clear.length} (${pct(clear.length/pool.length).trim()}), cards ${new Set(pool.map(trophy)).size} -> ${new Set(clear.map(trophy)).size}`);
  }
  // One Easy a day for a year from one set, under the Daily repeat windows
  // (28-day decision, 7-day source), averaged over 20 simulated years. With
  // rotation, an answer card rests for EASY_RULE.answer_repeat_days after it is
  // served, unless that would leave the clear pool empty. A day is unfilled
  // only if the whole easy pool is empty (a set whose archive starts at P1P2
  // has no P1P1 pool under any rule; the live selector then serves a medium
  // decision).
  const YEARS=20,WINDOW=EASY_RULE.answer_repeat_days;
  for(const set of [...new Set(rows.map(p=>p.row.set))].sort())for(const mode of ['current draw','clear-Easy, no rotation','clear-Easy with rotation']) {
    const total={unfilled:0,relaxed:0,fallback:0,distinct:0,top:0,week:0,margin:0,served:0};
    for(let year=0;year<YEARS;year++) {
      const decision=new Map(),source=new Map(),last=new Map(),cards=new Map();
      for(let day=0;day<365;day++) {
        const pick=1+Math.floor(random()*5);
        const open=p=>p.row.set===set&&p.row.pick===pick&&!(day-(decision.get(p.row.id)??-99)<28)&&!(day-(source.get(p.row.src)??-99)<7);
        const rested=p=>day-(last.get(trophy(p))??-999)>=WINDOW;
        let pool=rows.filter(open);
        if(mode!=='current draw') {
          const clear=pool.filter(p=>p.clear);
          let chosen=mode==='clear-Easy with rotation'?clear.filter(rested):clear;
          if(!chosen.length&&clear.length&&mode==='clear-Easy with rotation'){total.relaxed++;chosen=clear;}
          if(!chosen.length)total.fallback++;else pool=chosen;
        }
        if(!pool.length){total.unfilled++;continue;}
        const chosen=pool[Math.floor(random()*pool.length)],card=trophy(chosen);
        if(day-(last.get(card)??-999)<=7)total.week++;
        decision.set(chosen.row.id,day);source.set(chosen.row.src,day);last.set(card,day);cards.set(card,(cards.get(card)||0)+1);
        total.margin+=chosen.features.trophy_strength_margin??0;total.served++;
      }
      total.distinct+=cards.size;total.top+=Math.max(0,...cards.values());
    }
    const per=key=>(total[key]/YEARS).toFixed(0);
    console.log(` ${set} ${mode.padEnd(25)} per year: distinct answer cards ${per('distinct')}, most frequent answer ${per('top')} days, same answer within a week ${per('week')} days, rotation relaxed ${per('relaxed')}, left clear pool ${per('fallback')}, unfilled ${per('unfilled')}; mean strength margin ${(total.margin/total.served).toFixed(2)}`);
  }
}
