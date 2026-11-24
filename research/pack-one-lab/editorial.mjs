// Descriptive triage and research briefs; not an autonomous article/publishing decision.
const specs = {
  "early-fixing": {
    "series": "Draft Theory",
    "title": "When Do Trophy Drafters Take Fixing Lands?",
    "picks": [
      1,
      5
    ],
    "labels": [
      "fixing land",
      "other card"
    ],
    "focus": 0,
    "theme": "fixing",
    "hook": "A dual land and a solid playable spell are in the pack. Is it too early to spend a pick on mana?",
    "limit": "Fixing here means a known multicolor-producing land, not other forms of fixing; offered alternatives vary by pick.",
    "discussion": "What makes you take a fixing land over a spell in Pack 1?"
  },
  "color-pivot": {
    "series": "Draft Theory",
    "title": "How Often Do Trophy Drafters Try a New Color?",
    "picks": [
      3,
      6
    ],
    "labels": [
      "same-color spell",
      "new-color spell",
      "other card"
    ],
    "focus": 1,
    "theme": "colors",
    "hook": "Your early spells all point toward black. The next pack offers a black playable and a blue spell. Are you willing to take the blue card?",
    "limit": "At least two prior colored spells share one color and both mono-color alternatives are offered. A new color is not proof of abandoning a lane or a correct pivot.",
    "discussion": "How many picks of the same color make you reluctant to take a card in a new color?"
  },
  "colorless-flex": {
    "series": "Draft Theory",
    "title": "How Early Do Trophy Drafters Take Generic-Mana Cards?",
    "picks": [
      1,
      5
    ],
    "labels": [
      "generic-mana spell",
      "colored spell",
      "other card"
    ],
    "focus": 0,
    "theme": "flexibility",
    "hook": "A spell with a generic mana cost is competing with a colored spell. How much do you value not having to choose a color yet?",
    "limit": "Generic printed mana cost is not proof of flexibility; synergies, abilities and alternate modes are not evaluated.",
    "discussion": "When does flexibility outweigh raw power for you?"
  },
  "rarity-choice": {
    "series": "Draft Theory",
    "title": "When Do Trophy Drafters Take a Common Over a Rare?",
    "picks": [
      1,
      5
    ],
    "labels": [
      "common spell",
      "rare/mythic spell",
      "other card"
    ],
    "focus": 0,
    "theme": "rarity",
    "hook": "The rare is still in the pack, but so is a common you like. How much should that rarity symbol matter?",
    "limit": "Rarity does not measure strength; alternative cards and card counts vary by pick.",
    "discussion": "Which commons in this format would you take over most rares?"
  },
  "first-pick-abandon": {
    "series": "Format Deep Dive",
    "title": "How Often Does the First Pick Miss the Starting Deck?",
    "picks": [
      1
    ],
    "labels": [
      "first-pick card name observed",
      "first-pick card name absent"
    ],
    "focus": 1,
    "theme": "colors",
    "hook": "You open a card you love, take it first, and spend the rest of the draft looking for a home for it. Does it actually end up in the deck?",
    "limit": "Name inclusion in the first match/first game is not copy-level inclusion or a final-deck guarantee.",
    "discussion": "What has made you willing to leave a powerful first pick in the sideboard?"
  }
};
const pins = {
  "draft": "f9497000be929d3f8cef87be643dc0b010e406a966ece7d0fc05e5e8e0c4b43d",
  "game": "a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc",
  "metadata": "5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7"
};

function count(x,min=0){if(!Number.isSafeInteger(x)||x<min)throw Error("lab-editorial-count");return x;}

function candidates(report,{excludedIds=[]}={}){
  if(report?.schema_version!==1||report.status!=="draft-evidence-only"||Object.keys(pins).some(k=>report.source_sha256?.[k]!==pins[k])||report.sample_floor!==100||report.metadata_coverage_floor!==0.8)throw Error("lab-editorial-source");
  const cohort=report.cohort;
  const total=count(cohort?.complete_trajectories,1);
  if(count(cohort.qualified_drafts)<count(cohort.qualified_trophies)||cohort.qualified_trophies<total||count(cohort.first_game_decks)>total||!Number.isFinite(cohort.win_rate_cutoff)||cohort.win_rate_cutoff<0.6||cohort.win_rate_cutoff>1)throw Error("lab-editorial-cohort");
  if(!Array.isArray(report.results)||report.results.length!==Object.keys(specs).length||new Set(report.results.map(x=>x.id)).size!==Object.keys(specs).length)throw Error("lab-editorial-results");
  const findings=[],skips=[];
  for(const entry of report.results){
    const s=specs[entry.id];
    if(!s||!Array.isArray(entry.rows))throw Error("lab-editorial-template");
    const required=entry.id==="first-pick-abandon"?[1]:entry.id==="color-pivot"?[3,4,5,6,7,8]:[1,2,3,4,5,6,7,8];
    if(entry.rows.length!==required.length||new Set(entry.rows.map(x=>x.pick)).size!==required.length||required.some(p=>!entry.rows.some(x=>x.pick===p)))throw Error("lab-editorial-stages");
    const rows=entry.rows.map(row=>{
      const e=count(row.eligible_drafts,1),k=count(row.known_drafts),n=count(row.qualifying_drafts);
      if(e!==total||k>e||n>k||(entry.id==="first-pick-abandon"&&(k!==cohort.first_game_decks||n!==k)))throw Error("lab-editorial-denominator");
      const good=n>=100&&k/e>=0.8;
      if(row.qualified!==good||!Number.isFinite(row.coverage)||Math.abs(row.coverage-k/e)>0.000051)throw Error("lab-editorial-gate");
      if(!good){if("metrics" in row)throw Error("lab-editorial-suppression");return {pick:row.pick,qualified:false};}
      if(!Array.isArray(row.metrics)||row.metrics.length!==s.labels.length)throw Error("lab-editorial-metrics");
      const m=row.metrics.map((a,i)=>{
        if(a.label!==s.labels[i]||a.denominator!==n||count(a.numerator)>n||!Number.isFinite(a.percent)||Math.abs(a.percent-100*a.numerator/n)>0.0500001)throw Error("lab-editorial-metric");
        return {label:s.labels[i],numerator:a.numerator,denominator:n,percent:Math.round(1000*a.numerator/n)/10};
      });
      if(m.reduce((acc,a)=>acc+a.numerator,0)!==n)throw Error("lab-editorial-total");
      return {pick:row.pick,qualified:true,coverage:k/e,n,metrics:m};
    });
    if(entry.status!==(rows.some(x=>x.qualified)?"candidate-evidence":"skip"))throw Error("lab-editorial-status");
    const selected=s.picks.map(p=>rows.find(x=>x.pick===p));
    if(excludedIds.includes(entry.id)){skips.push({id:entry.id,reason:"already-covered"});continue;}
    if(selected.some(x=>!x?.qualified)){skips.push({id:entry.id,reason:"predefined-comparison-lacks-coverage"});continue;}
    const focus=selected.map(x=>x.metrics[s.focus].numerator/x.n);
    const signal=focus.length===2?Math.abs(focus[1]-focus[0]):Math.min(focus[0],1-focus[0]);
    if(signal<0.05){skips.push({id:entry.id,reason:"small-descriptive-signal"});continue;}
    const coverage=Math.min(...selected.map(x=>x.coverage)),sample=Math.min(...selected.map(x=>x.n));
    // Provisional descriptive triage, not a statistical-significance or quality score.
    const score=Math.round(100*(0.5*Math.min(signal/0.25,1)+0.3*Math.min(sample/1000,1)+0.2*coverage));
    findings.push({id:entry.id,series:s.series,headline:s.title,theme:s.theme,unit:"one qualifying trophy source draft per real pick",set:"Reality Fracture",picks:selected,focus:s.focus,triage_score:score,status:"unreviewed-evidence",source_sha256:{...pins},cohort:{complete_trajectories:total,win_rate_cutoff:cohort.win_rate_cutoff},limitations:s.limit+" Observed qualified trophy drafts only. Per-pick opportunities vary and may overlap in source drafts. This is a descriptive comparison, not a causal or statistical-significance claim."});
  }
  findings.sort((a,b)=>b.triage_score-a.triage_score||a.id.localeCompare(b.id,"en"));
  const distinct=[],themes=new Set();
  for(const f of findings){if(themes.has(f.theme)){skips.push({id:f.id,reason:"same-theme-lower-ranked"});continue;}themes.add(f.theme);distinct.push(f);}
  return {candidates:distinct.slice(0,3),skipped:[...skips,...distinct.slice(3).map(x=>({id:x.id,reason:"below-top-three"}))],status:distinct.length?"needs-editorial-review":"skip-week"};
}

function renderResearchBrief(f){
  const s=specs[f.id];
  if(!s||f.status!=="unreviewed-evidence")throw Error("lab-editorial-brief");
  const obs=f.picks.map(r=>({pick:r.pick,metrics:r.metrics.map(m=>({label:m.label,numerator:m.numerator,denominator:m.denominator,percent:m.percent}))}));
  const lines=obs.map(r=>"P1P"+r.pick+": "+r.metrics.map(m=>m.label+" — "+m.numerator.toLocaleString("en-US")+" of "+m.denominator.toLocaleString("en-US")+" ("+m.percent.toFixed(1)+"%)").join("; "));
  return {id:f.id,title:s.title,series:s.series,status:"research-brief-not-publishable",hypothetical_opening:s.hook,observations:lines,chart:obs,discussion:s.discussion,required_limits:f.limitations,source:"17Lands public data, Reality Fracture PremierDraft, CC BY 4.0 — https://www.17lands.com/public_datasets",method:"https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md",source_sha256:f.source_sha256,editorial_gate:"Independent data/claim and Magic editorial review required. Do not publish a brief."};
}

export {candidates,renderResearchBrief};
