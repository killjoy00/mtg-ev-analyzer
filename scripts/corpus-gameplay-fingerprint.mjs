import {createHash} from 'node:crypto';

// Match the image-maintenance boundary, and only at card display fields.
// Puzzle/card identity, ordering, scores, evidence and provenance stay pinned.
const displayFields=new Set(['image_url','mana_cost','rarity','type_line','display_faces']);
const withoutDisplay=card=>Object.fromEntries(Object.entries(card).filter(([key])=>!displayFields.has(key)));
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

export function corpusGameplayFingerprint(rows) {
  const gameplay=rows.map(puzzle=>Object.fromEntries(Object.entries(puzzle).map(([key,value])=>[
    key, key==='candidates'||key==='prior_picks'?value.map(withoutDisplay):value,
  ])));
  return createHash('sha256').update(JSON.stringify(canonical(gameplay))).digest('hex');
}
