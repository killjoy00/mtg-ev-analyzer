import repairs from './corpus/card-metadata-repairs.json' with {type:'json'};
import faceMetadata from './corpus/card-face-metadata.json' with {type:'json'};
import {normalizedDisplayFaces} from './card-faces.mjs';
import {safeCardImageUrl} from './card-image-policy.mjs';
const byName=new Map(repairs.cards.map(c=>[c.name,c]));
// Display-only fallback for legacy rows. Existing fields, stored identities,
// evidence, images, probabilities and recorded scores remain unchanged.
export function effectiveCardMetadata(card) {
 const repair=byName.get(card.name);
 const missing={};
 for(const field of repair?['type_line','rarity','mana_cost']:[]) {
  if(card[field]==null||field!=='mana_cost'&&!card[field])missing[field]=repair[field];
 }
 const embedded=normalizedDisplayFaces(card.display_faces);
 if(embedded.length)missing.display_faces=embedded;
 else {
  const url=safeCardImageUrl(card.image_url);
  const id=url?new URL(url).pathname.match(/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.(?:jpg|png|webp)$/)?.[1]:null;
  const record=id?faceMetadata.printings[id]:null;
  if(record?.names.includes(card.name)) {
   const faces=normalizedDisplayFaces(record.display_faces);
   if(faces.length)missing.display_faces=faces;
  }
 }
 return Object.keys(missing).length?{...card,...missing}:card;
}

export function publicCardDisplay(original) {
 const c=effectiveCardMetadata(original);
 const result=Object.fromEntries(['id','name','image_url','mana_cost','rarity','type_line'].filter(k=>c[k]).map(k=>[k,c[k]]));
 const faces=normalizedDisplayFaces(c.display_faces);
 if(faces.length)result.display_faces=faces;
 return result;
}
