import {isDeepStrictEqual} from 'node:util';

const DISPLAY_FIELDS=new Set(['image_url','mana_cost','rarity','type_line']);

function scrubCard(card) {
  return Object.fromEntries(Object.entries(card||{}).filter(([key])=>!DISPLAY_FIELDS.has(key)));
}

export function gameplayPuzzle(puzzle) {
  return {
    ...puzzle,
    candidates:(puzzle?.candidates||[]).map(scrubCard),
    prior_picks:(puzzle?.prior_picks||[]).map(scrubCard),
  };
}

export function sameGameplayPuzzle(left,right) {
  return isDeepStrictEqual(gameplayPuzzle(left),gameplayPuzzle(right));
}
