// Selection features for one verified puzzle, and the latest-set Daily rule
// that uses them. Features are computed once, when a puzzle is imported
// (scripts/score-puzzle-selection.mjs), from checked-in inputs only: the
// puzzle's model supports, the set's card strength table and the trophy
// decklist. They never change grading. The rule was chosen in the blinded owner
// review (docs/PUZZLE-REVIEW.md); docs/LATEST-DAILY-SELECTION.md describes it.
export const SELECTION_FEATURE_VERSION='stakes-v1';
export const LATEST_DAILY_RULE='latest-stakes-v1';

export const STAKES_RULE=Object.freeze({
  // An option is credible with at least 35% of the leader's model support;
  // the top three credible options count.
  credible_support_ratio:0.35,
  max_credible_options:3,
  // From this pick the trophy pick must have made the trophy deck's main deck.
  deck_gate_from_pick:4,
  // From this pick a land trophy pick is never served.
  no_land_answer_from_pick:5,
  // Contested rounds draw from the top quarter by stakes, at least three.
  top_share:0.25,
  min_top_pool:3,
});

export const isLandCard=card=>/\bLand\b/.test(card?.type_line||'');

// strength: {version, sha256, cards: Map(name -> points)} or null.
// mainDeck: Map(name -> main-deck copies) or null when no decklist exists.
export function puzzleSelectionFeatures(puzzle,{strength=null,mainDeck=null}={},rule=STAKES_RULE) {
  const ranked=[...puzzle.candidates].sort((a,b)=>b.model_probability-a.model_probability);
  const top=ranked[0].model_probability;
  const credible=ranked.filter(c=>c.model_probability>=rule.credible_support_ratio*top).slice(0,rule.max_credible_options);
  const known=strength?credible.map(c=>strength.cards.get(c.name)).filter(Number.isFinite):[];
  const target=puzzle.candidates.find(c=>c.id===puzzle.historical_pick_id);
  if(!target)throw Error(`Puzzle ${puzzle.puzzle_id} has no trophy pick among its candidates.`);
  return {
    puzzle_id:puzzle.puzzle_id,
    feature_version:SELECTION_FEATURE_VERSION,
    strength_version:strength?.version??null,
    strength_sha256:strength?.sha256??null,
    stakes_points:known.length?Math.max(...known):null,
    credible_count:credible.length,
    trophy_in_main_deck:mainDeck?(mainDeck.get(target.name)||0)>0:null,
    trophy_is_land:isLandCard(target),
  };
}

// Contested pools keep the top quarter by stakes, at least three puzzles.
export const stakesTopPoolSize=(count,rule=STAKES_RULE)=>
  Math.min(count,Math.max(rule.min_top_pool,Math.ceil(rule.top_share*count)));
