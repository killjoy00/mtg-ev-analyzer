// Offline historical pilot. No model/API/database/publishing calls.
const provenance = {
  "path": "research/data/fra-context-audit.json",
  "blob": "d852fe2957e63049c0fb10b1bb774383de83c0c6",
  "method": "https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/CONTEXT-MODEL-AUDIT.md",
  "attribution": "17Lands Reality Fracture PremierDraft public draft/game archives, CC BY 4.0; Pack One aggregate audit (October 29, 2026).",
  "archive": "https://www.17lands.com/public_datasets",
  "hashes": {
    "draft": "f9497000be929d3f8cef87be643dc0b010e406a966ece7d0fc05e5e8e0c4b43d",
    "game": "a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc",
    "metadata": "5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7"
  }
};

function requireCount(n,min=0) {
  if(!Number.isSafeInteger(n)||n<min)throw Error("lab-invalid-count");
  return n;
}

function metric(id,label,n,d) {
  requireCount(n);requireCount(d,100);
  if(n>d)throw Error("lab-invalid-denominator");
  return {id,label,numerator:n,denominator:d,percent:Math.round(1000*n/d)/10};
}

function readArchive(a) {
  if(a?.set!=="fra"||Object.entries(provenance.hashes).some(([k,v])=>a.source_sha256?.[k]!==v))throw Error("lab-unrecognized-source");
  const drafts=requireCount(a.qualified_training_drafts,100);
  const cutoff=a.cohort_cutoff;
  if(typeof cutoff!=="number"||!Number.isFinite(cutoff)||cutoff<0.6||cutoff>1)throw Error("lab-invalid-cohort");
  const s=a.splash_sensitivity,c=a.copy_labels;
  const games=requireCount(s?.games,100),splash=requireCount(s?.games_with_splash);
  const covered=requireCount(c?.drafts_with_game_observations,100),repeated=requireCount(c?.repeated_card_draft_groups,100),played=requireCount(c?.repeated_groups_ever_played,100),fewer=requireCount(c?.groups_with_fewer_observed_deck_copies),picked=requireCount(c?.picks_in_those_groups),extra=requireCount(c?.copies_above_maximum_observed_deck_count);
  if(covered>drafts||fewer>played||played>repeated||splash>games||extra<fewer||picked<2*fewer||extra>picked-fewer)throw Error("lab-inconsistent-source");
  const base={schema_version:1,status:"draft-only",set:"Reality Fracture",cohort:{qualified_drafts:drafts,win_rate_cutoff:cutoff},provenance,assessment:"descriptive historical archive; not an independent causal test"};
  return [
    {...base,id:"splash-frequency",series:"Format Deep Dive",headline:"How Common Is Splashing in Reality Fracture?",unit:"recorded game",metrics:[metric("splash","With a recorded splash",splash,games),metric("no-splash","Without a recorded splash",games-splash,games)],limitations:["Repeated games from the same draft are not independent; this is game-weighted, not the share of unique decks or drafts.","The archive covers a qualified high-win-rate cohort in one format; no causal win-rate or pick-timing claim follows."]},
    {...base,id:"duplicate-copies",series:"Draft Theory",headline:"When Is Another Copy One Too Many?",unit:"draft/card-name group with repeated picks and at least one observed deck copy",cohort:{...base.cohort,drafts_with_game_observations:covered},metrics:[metric("fewer","Fewer observed deck copies than drafted",fewer,played),metric("all","No observed copy shortfall",played-fewer,played)],context:{all_repeated_groups:repeated,copies_above_maximum_observed_deck_count:extra},limitations:["Maximum observed deck counts across games do not prove an extra copy was never played; coverage may be incomplete.","A card-name group is not an individual pick or deck; groups within a draft are not independent.","No comparison of alternative picks or causal effect on wins is available."]}
  ];
}

function formatInt(n){return n.toLocaleString("en-US");}

function renderDraft(p){
  const [a,b]=p.metrics;const pct=a.percent.toFixed(1)+"%";
  const sample=formatInt(a.denominator);
  const observation="**"+pct+"** ("+formatInt(a.numerator)+" of "+sample+")";
  let paragraphs,question;
  if(p.id==="splash-frequency"){
    paragraphs=[
      "You're several picks into Pack 1 with a promising black-red start. A powerful blue card comes around, alongside a dual land and a solid black common. Do you take the card that fits now, the fixing, or the card that might be worth stretching your mana for?",
      "We looked at "+formatInt(p.cohort.qualified_drafts)+" qualifying Reality Fracture Premier drafts from experienced, high-win-rate players in the 17Lands archives. The game records show how frequently the decks they played actually included a splash.",
      observation+" of recorded games featured a deck with a splash. The other "+b.percent.toFixed(1)+"% had no recorded splash. That's a substantial part of this sample, rather than an unusual edge case.",
      "The drafting question is how to price flexibility. A land that produces an extra color can give later picks more possibilities; a powerful off-color spell may become playable if the mana comes together. Conversely, taking fixing instead of a needed creature or stretching a mana base to cast a demanding spell can carry a real cost.",
      "Try separating those two decisions in your next draft. Is the off-color spell powerful enough to justify spending future picks on fixing? And would you still want that fixing if the spell never made the deck? Neither answer is automatic.",
      "This study only describes decks that were actually played. It does not tell us whether splashing wins more games, whether strong players prioritize fixing early, or whether an off-color card was a better pick than the alternatives. Those are separate questions."
    ];
    question="Do you pick fixing before you have a reason to splash, or wait until a card gives you that reason?";
  }else if(p.id==="duplicate-copies"){
    paragraphs=[
      "You're staring at another copy of a card you already have twice. It's a good common, and you took the first two happily. Is the third copy just as useful as the first, or is this where another role becomes more valuable?",
      "We looked at repeated picks of the same card within Reality Fracture drafts from experienced, high-win-rate players. For each draft and card name, we compared the number drafted with the highest number of copies observed together in a deck across recorded games.",
      "Restricting the analysis to repeated-card groups where at least one copy appeared in an observed deck, "+observation+" had fewer observed deck copies than were drafted. In the other "+b.percent.toFixed(1)+"%, there was no observed shortfall.",
      "That distinction matters: these aren't simply cards that missed the deck entirely. They are cards that were useful enough to show up at least once, but for which the recorded deck counts did not always include every drafted copy.",
      "The next time another copy comes around, look at what your first copies already cover. Does another copy advance your deck's plan, or would a different creature, interaction spell or fixing land address a need that is harder to fill? Some cards get better in multiples; others compete for the same slots.",
      "This isn't evidence that taking an extra copy was a mistake. The available packs, sideboard needs, archetype, later picks and incomplete game coverage all matter. We would need card-specific opportunity comparisons before identifying an ideal number of copies."
    ];
    question="Which kinds of cards do you happily take in multiples, and which do you stop drafting after the first or second copy?";
  }else throw Error("lab-unsupported-template");
  const source=p.provenance;
  return "# "+p.headline+"\n\nPack One Lab · "+p.series+"\n\n"+paragraphs.join("\n\n")+"\n\n**Discussion:** "+question+"\n\n---\n\nMethod: "+p.unit+". "+p.limitations.join(" ")+"\n\nData: "+source.attribution+" [Methodology]("+source.method+"). [Public dataset]("+source.archive+").\n\n[Practice drafting at Pack One](https://packone.pro/)\n";
}

function renderChart(p){
  const [a,b]=p.metrics;
  const bar=(m,y)=>'<text x="50" y="'+y+'" font-size="20" fill="#173557">'+m.label+'</text><rect x="50" y="'+(y+16)+'" width="700" height="28" rx="5" fill="#e4eaf0"/><rect x="50" y="'+(y+16)+'" width="'+(700*m.percent/100)+'" height="28" rx="5" fill="#377ab3"/><text x="750" y="'+y+'" text-anchor="end" font-size="20" fill="#173557">'+m.percent.toFixed(1)+'%</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="330" viewBox="0 0 800 330" role="img"><title>'+p.headline+'</title><rect width="800" height="330" fill="#f5f8fb"/><g font-family="Arial,sans-serif"><text x="50" y="38" font-size="17" font-weight="bold" fill="#377ab3">PACK ONE LAB · REALITY FRACTURE</text><text x="50" y="77" font-size="27" font-weight="bold" fill="#173557">'+p.headline+'</text>'+bar(a,123)+bar(b,213)+'<text x="50" y="303" font-size="15" fill="#173557">n = '+formatInt(a.denominator)+(p.id==="splash-frequency"?' recorded games':' qualifying draft/card groups')+' · 17Lands public data</text></g></svg>';
}

export {provenance,readArchive,renderDraft,renderChart};
