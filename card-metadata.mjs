import repairs from './corpus/card-metadata-repairs.json' with {type:'json'};
const byName=new Map(repairs.cards.map(c=>[c.name,c]));
// Display-only fallback for legacy rows. Existing fields, stored identities,
// evidence, images, probabilities and recorded scores remain unchanged.
export function effectiveCardMetadata(card) {
 const repair=byName.get(card.name);
 if(!repair)return card;
 const missing={};
 for(const field of ['type_line','rarity','mana_cost']) {
  if(card[field]==null||field!=='mana_cost'&&!card[field])missing[field]=repair[field];
 }
 return Object.keys(missing).length?{...card,...missing}:card;
}
