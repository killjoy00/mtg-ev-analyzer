// Release-rank half-life: a set's optional weight halves every four newer
// eligible releases. Corpus size never changes a set's weight.
export const DAILY_SELECTION_VERSION = 'eight-pick-v4';
export const RECENCY_HALF_LIFE = 4;
export const recencyWeight = rank => 2 ** (-rank / RECENCY_HALF_LIFE);
export function liveRegularSets(metadata, day) {
  return metadata.filter(s => s.status === 'Live' && s.regular_run === true && s.release_date && s.release_date <= day)
    .sort((a,b) => b.release_date.localeCompare(a.release_date) || a.set_id.localeCompare(b.set_id));
}
export function weightedSet(ids, random, weight = (_, i) => recencyWeight(i)) {
  if (!ids.length) throw Object.assign(Error('No Live eligible sets are available.'), {status:503});
  const weights = ids.map(weight);
  let ticket = random() * weights.reduce((a,b) => a+b, 0);
  for (let i=0; i<ids.length; i++) { ticket -= weights[i]; if (ticket < 0) return ids[i]; }
  return ids.at(-1);
}
export function dailySetPlan(metadata, day, random) {
  const ids = liveRegularSets(metadata, day).map(s => s.set_id);
  if (ids.length < 4) throw Object.assign(Error('The Daily requires four Live eligible releases.'), {status:503});
  const previous = ids.slice(1,4);
  return [ids[0], ids[0], ...Array.from({length:4}, () => weightedSet(previous,random)),
    ...Array.from({length:2}, () => weightedSet(ids,random))];
}
// Balance custom practice by selected set, never by archive size. Used by the
// future capability-gated entry point; not exposed by the Daily selector.
export function balancedSetPlan(ids, random) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw Error('Choose at least one set.');
  for(let i=unique.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}
  return Array.from({length:8}, (_,i) => unique[i % unique.length]);
}
