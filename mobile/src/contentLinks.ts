const PACK_ONE_ORIGIN = 'https://packone.pro';

export const canonicalContentLinks = Object.freeze({
  learn: '/learn/',
  firstPick: '/learn/first-pick-discipline/',
  consensus: '/learn/reading-consensus/',
  stayingOpen: '/learn/staying-open/',
  deckFit: '/learn/card-strength-vs-fit/',
  about: '/about/',
  contact: '/contact/',
  privacy: '/privacy/',
  terms: '/terms/',
});

export type CanonicalContentKey = keyof typeof canonicalContentLinks;

export function canonicalContentUrl(key: CanonicalContentKey) {
  return `${PACK_ONE_ORIGIN}${canonicalContentLinks[key]}`;
}
