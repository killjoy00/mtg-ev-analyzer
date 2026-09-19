import repairs from './corpus/card-metadata-repairs.json' with {type:'json'};
const byName=new Map(repairs.cards.map(c=>[c.name,c]));
// Display-only fallback for legacy rows. Stored identities, evidence, images,
// rarity, probabilities and recorded scores remain byte-for-byte unchanged.
export function effectiveCardMetadata(card) {
 if(card.type_line)return card;
 const repair=byName.get(card.name);
 return repair?{...card,type_line:repair.type_line}:card;
}
