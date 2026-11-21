import repairs from './corpus/card-metadata-repairs.json' with {type:'json'};
import faceMetadata from './corpus/card-face-metadata.json' with {type:'json'};
import {normalizedDisplayFaces} from './card-faces.mjs';
import {safeCardImageUrl} from './card-image-policy.mjs';
const byName=new Map(repairs.cards.map(c=>[c.name,c]));
// The 27 Stardates reprints with alternate Star Trek titles (SDS 1-30; three
// others retain their original names). Display labels ONLY: canonical card
// names remain in 17Lands data, scoring, selection, trophy decks and strength.
// Source: https://magic.wizards.com/en/news/feature/star-trek-release-notes
export const TRK_STARDATES_DISPLAY_NAMES=Object.freeze({
 "Mikaeus, the Lunarch": "Benny Russell, Dreamer",
 "Kenrith, the Returned King": "General Picard, Earth Warlord",
 "Sisay, Weatherlight Captain": "Kirk, Alluring Upstart",
 "Thada Adel, Acquisitor": "Carol Marcus, Scientist Sleuth",
 "Empress Galina": "Empress Sato, Terran Tyrant",
 "Arcum Dagsson": "Scotty, Transwarp Transporter",
 "Bruvac the Grandiloquent": "Spock, Completely Logical",
 "Drivnod, Carnage Dominus": "Intendant Kira Nerys",
 "Sheoldred, the Apocalypse": "Khan, Engineered Evil",
 "Torbran, Thane of Red Fell": "Michael Burnham, Enforcer",
 "Loot, Exuberant Explorer": "Hikaru Sulu, Peerless Pilot",
 "Rishkar, Peema Renegade": "Keenser, Scotty's Spotter",
 "Bristly Bill, Spine Sower": "Leonard McCoy, Country Doctor",
 "Sen Triplets": "Borg Queen, Hateful Legacy",
 "Tatyova, Benthic Druid": "Chekov, Young Wayfinder",
 "Isshin, Two Heavens as One": "Janeway, Cracked Mirror",
 "Ertai Resurrected": "Nero, Last of the Empire",
 "Jhoira, Weatherlight Captain": "Nyota Uhura, Endless Insight",
 "Captain Sisay": "Pike, Unrelenting Mentor",
 "Riku of Many Paths": "Spock, Cross-Time Captain",
 "Prosper, Tome-Bound": "Spock, Mirror Malefactor",
 "Stella Lee, Wild Card": "Spock, Strangely Human",
 "Mogis, God of Slaughter": "Worf, Regent of Terok Nor",
 "Minamo, School at Water's Edge": "Academy on the Bay",
 "Talon Gates of Madara": "Starbase Yorktown",
 "Phyrexian Tower": "Starfleet HQ, Under Assault",
 "Shizo, Death's Storehouse": "Terran Throne Room",
});
export function cardDisplayName(name,setId) {
 return setId==='trk'&&Object.hasOwn(TRK_STARDATES_DISPLAY_NAMES,name)
  ?TRK_STARDATES_DISPLAY_NAMES[name]:name;
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
 const c=effectiveCardMetadata(original);
 const result=Object.fromEntries(['id','name','image_url','mana_cost','rarity','type_line'].filter(k=>c[k]).map(k=>[k,c[k]]));
 if(result.name)result.name=cardDisplayName(result.name,setId);
 const faces=normalizedDisplayFaces(c.display_faces);
 if(faces.length)result.display_faces=faces;
 return result;
}
