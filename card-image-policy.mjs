// One audited source of truth for images saved in Pack One puzzles.
// Scryfall's image_uris.normal is the only publisher written by the
// card-image maintenance pipeline (scripts/fetch_card_metadata.py).
// Do not turn this into a generic HTTPS image proxy.
export const CARD_IMAGE_HOSTS=Object.freeze(['cards.scryfall.io']);
export function safeCardImageUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||!CARD_IMAGE_HOSTS.includes(url.hostname)||
       url.username||url.password||url.port)return null;
    return url.href;
  }catch{return null;}
}
