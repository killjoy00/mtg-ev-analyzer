export function rarityBucket(rarity) {
  const value = String(rarity || '').toLowerCase();
  if (value === 'mythic' || value === 'rare') return 0;
  if (value === 'uncommon') return 1;
  if (value === 'common') return 2;
  return 3;
}

export function sortPackByRarity(candidates = []) {
  return candidates
    .map((card, index) => ({ card, index }))
    .sort((a, b) => rarityBucket(a.card?.rarity) - rarityBucket(b.card?.rarity) || a.index - b.index)
    .map(({ card }) => card);
}
