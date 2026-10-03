import {runPickWindows} from '../draft-run.mjs';

// Some official archives begin after the opening pick. Their pinned baseline
// already declares first_pick=2. They contribute picks 2–8 to mixed runs;
// custom single-set eligibility still independently requires all picks 1–8.
// Never infer this bound from the candidate rows: that could hide missing data.
export function corpusHealthPicks(setId, baselineEntry) {
  const picks = [...new Set(runPickWindows(setId === 'powered-cube' ? 'powered-cube' : 'mixed').map(window => Number(window[0])))];
  const first = baselineEntry?.first_pick ?? 1;
  if (![1, 2].includes(first)) throw Error(setId + ': invalid pinned first pick');
  if (baselineEntry && (!Number.isInteger(baselineEntry.last_pick) || baselineEntry.last_pick < picks.at(-1))) {
    throw Error(setId + ': pinned baseline does not cover the final served pick');
  }
  return picks.filter(pick => pick >= first);
}
