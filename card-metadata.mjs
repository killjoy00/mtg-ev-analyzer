import stardates from './corpus/stardates-printings.json' with {type:'json'};
import repairs from './corpus/card-metadata-repairs.json' with {type:'json'};
import faceMetadata from './corpus/card-face-metadata.json' with {type:'json'};
import {normalizedDisplayFaces} from './card-faces.mjs';
import {safeCardImageUrl} from './card-image-policy.mjs';
const byName=new Map(repairs.cards.map(c=>[c.name,c]));
// The launch inventory decides which of these exact SDS printings are served.
const stardatesByName=new Map();
const stardatesByImage=new Map();
for(const printing of stardates) {
  stardatesByName.set(printing.name,printing);
  stardatesByName.set(printing.printed_name,printing);
  stardatesByImage.set(printing.image_url.split('?')[0],printing);
}

export function cardDisplayName(name,setId) {
  return setId==='trk' ? stardatesByName.get(name)?.printed_name ?? name : name;
}

// Used on the raw corpus before any public presentation repairs.
export function matchesStardatesPrinting(card,setId) {
  if(setId!=='trk')return true;
  const expected=stardatesByName.get(card.name);
  const actual=stardatesByImage.get(typeof card.image_url==='string' ? card.image_url.split('?')[0] : null);
  return expected===actual && (!expected || !card.display_faces?.length);
}

export function displayCardPrinting(card,setId) {
  const printing=setId==='trk' && stardatesByName.get(card.name);
  if(!printing)return card;
  // All thirty reference printings have one face. A stale face array would
  // otherwise override image_url when either client opens the card viewer.
  const {display_faces,...rest}=card;
  return {...rest,name:printing.printed_name,image_url:printing.image_url};
}

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

export function publicCardDisplay(original,setId=null) {
 const c=displayCardPrinting(effectiveCardMetadata(original),setId);
 const result=Object.fromEntries(['id','name','image_url','mana_cost','rarity','type_line'].filter(k=>c[k]).map(k=>[k,c[k]]));
 const faces=normalizedDisplayFaces(c.display_faces);
 if(faces.length)result.display_faces=faces;
 return result;
}
