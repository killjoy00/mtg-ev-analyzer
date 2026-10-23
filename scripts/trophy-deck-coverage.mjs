// Every puzzle import must check trophy decklist coverage before it writes.
// Decklists are optional context, so missing decks never block an import; an
// unreadable catalog does. Reports carry counts only, never source identifiers.
import fs from 'node:fs';
import {trophyDeckCoverage} from '../worker/trophy-decks.mjs';

export async function checkTrophyDecks(set,sourcePuzzleCounts,label=set) {
  const coverage={label,...await trophyDeckCoverage(set,sourcePuzzleCounts)};
  // stderr keeps --validate-only JSON on stdout intact.
  console.error(JSON.stringify({trophy_decks:coverage}));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `- Trophy decklists, ${label}: ${coverage.puzzles_with_deck}/${coverage.puzzles} puzzles from ${coverage.sources_with_deck}/${coverage.sources} source drafts${coverage.catalog?'':' (no catalog for this set)'}\n`);
  return coverage;
}

export function sourcePuzzleCounts(puzzles) {
  const counts=new Map();
  for(const p of puzzles)counts.set(p.source_draft_hash,(counts.get(p.source_draft_hash)||0)+1);
  return counts;
}
