// Selection features for one verified puzzle, and the Daily stakes and
// clear-Easy rules shared by Latest Set and Main Daily. Features are computed
// once, when a puzzle is imported (scripts/score-puzzle-selection.mjs), from
// checked-in inputs only: the puzzle's model supports, mana costs and prior
// picks, the set's card strength table and the trophy decklist. They never
// change grading. The stakes rule was chosen in the blinded owner review
// (docs/PUZZLE-REVIEW.md); the clear-Easy rule in the November 2026 difficulty
// review. docs/LATEST-DAILY-SELECTION.md describes both.
export const SELECTION_FEATURE_VERSION='stakes-v1';
export const LATEST_DAILY_RULE='latest-stakes-v1';
export const MIXED_DAILY_RULE='mixed-stakes-v1';
// The same stakes rule plus the clear-Easy rule below. A schedule records these
// when every serving puzzle of its planned sets carries the clear-Easy features
// (migration 0075); until then it records the v1 rule and draws Easy as before.
export const LATEST_DAILY_CLEAR_EASY_RULE='latest-stakes-v2';
export const MIXED_DAILY_CLEAR_EASY_RULE='mixed-stakes-v2';

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

// The clear-Easy rule (docs/DIFFICULTY-REVIEW-2026-11.md). An Easy round serves
// a decision only when three independent signals agree on one card: the trophy
// drafter took it, the model clearly prefers it (the easy band already requires
// twice the runner-up's support), and no other rated card in the pack is
// stronger. Once two picks have been made, the card must also not ask the
// player to leave every colour drafted so far. Qualifying decisions are drawn
// uniformly: ranking them by strength would serve the same few bombs.
export const EASY_RULE=Object.freeze({
  // The trophy pick is the model's leading card.
  min_trophy_support_ratio:1,
  // Trophy strength minus the strongest other rated card, in points.
  min_strength_margin:0,
  // From this pick a coloured trophy pick shares a colour with the prior picks.
  colour_fit_from_pick:3,
});

export const isLandCard=card=>/\bLand\b/.test(card?.type_line||'');
// Colours a card's printed mana cost asks for. Lands and colourless cards have none.
export const costColours=card=>new Set(String(card?.mana_cost||'').match(/[WUBRG]/g)||[]);
// True when the card is coloured, the prior picks are too, and they share no
// colour. A first pick, a colourless card or colourless prior picks are never
// off-colour.
export function isOffColour(card,priorPicks=[]) {
  const wanted=costColours(card);
  if(!wanted.size)return false;
  const drafted=new Set((priorPicks||[]).flatMap(pick=>[...costColours(pick)]));
  return drafted.size>0&&![...wanted].some(colour=>drafted.has(colour));
}

// strength: {version, sha256, cards: Map(name -> points)} or null.
// mainDeck: Map(name -> main-deck copies) or null when no decklist exists.
export function puzzleSelectionFeatures(puzzle,{strength=null,mainDeck=null}={},rule=STAKES_RULE) {
  const ranked=[...puzzle.candidates].sort((a,b)=>b.model_probability-a.model_probability);
  const top=ranked[0].model_probability;
  const credible=ranked.filter(c=>c.model_probability>=rule.credible_support_ratio*top).slice(0,rule.max_credible_options);
  const known=strength?credible.map(c=>strength.cards.get(c.name)).filter(Number.isFinite):[];
  const target=puzzle.candidates.find(c=>c.id===puzzle.historical_pick_id);
  if(!target)throw Error(`Puzzle ${puzzle.puzzle_id} has no trophy pick among its candidates.`);
  const targetStrength=strength?strength.cards.get(target.name):undefined;
  const others=strength?puzzle.candidates.filter(c=>c!==target).map(c=>strength.cards.get(c.name)).filter(Number.isFinite):[];
  return {
    puzzle_id:puzzle.puzzle_id,
    feature_version:SELECTION_FEATURE_VERSION,
    strength_version:strength?.version??null,
    strength_sha256:strength?.sha256??null,
    stakes_points:known.length?Math.max(...known):null,
    credible_count:credible.length,
    trophy_in_main_deck:mainDeck?(mainDeck.get(target.name)||0)>0:null,
    trophy_is_land:isLandCard(target),
    // Null without a table, an unrated trophy pick or no other rated card.
    trophy_strength_margin:Number.isFinite(targetStrength)&&others.length?targetStrength-Math.max(...others):null,
    trophy_off_colour:isOffColour(target,puzzle.prior_picks),
  };
}

// The clear-Easy rule for one easy-band puzzle, from its stored rating and
// features. The selector applies the same conditions in SQL.
export function isClearEasy({pick_number,target_support_ratio,trophy_strength_margin,trophy_off_colour},rule=EASY_RULE) {
  return Number(target_support_ratio)>=rule.min_trophy_support_ratio
    && trophy_strength_margin!=null&&Number(trophy_strength_margin)>=rule.min_strength_margin
    && (Number(pick_number)<rule.colour_fit_from_pick||trophy_off_colour===false);
}

// Contested pools keep the top quarter by stakes, at least three puzzles.
export const stakesTopPoolSize=(count,rule=STAKES_RULE)=>
  Math.min(count,Math.max(rule.min_top_pool,Math.ceil(rule.top_share*count)));
