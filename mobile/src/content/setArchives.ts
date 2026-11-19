export type SetArchiveCard = {
  name: string;
  imageUrl: string;
};

export type CloseDecision = {
  first: string;
  second: string;
  firstSupport: string;
  secondSupport: string;
  gap: string;
};

export type SetArchive = {
  setId: 'msh' | 'ecl' | 'tmt' | 'sos';
  replaySeats: number;
  trainingDrafts: number;
  trainingPicks: number;
  experiencedCohortDrafts: number;
  winRateCutoff: string;
  averageTopSupport: string;
  withinTenPoints: string;
  historicalTopMatch: string;
  averageGap: string;
  thirtyPointGap: string;
  topCards: SetArchiveCard[];
  closeDecisions: CloseDecision[];
};

export const SET_ARCHIVES: Record<SetArchive['setId'], SetArchive> = {
  msh: {
    setId: 'msh',
    replaySeats: 300,
    trainingDrafts: 5000,
    trainingPicks: 209999,
    experiencedCohortDrafts: 40480,
    winRateCutoff: '60%',
    averageTopSupport: '48.8%',
    withinTenPoints: '24%',
    historicalTopMatch: '68%',
    averageGap: '27.9%',
    thirtyPointGap: '42%',
    topCards: [
      { name: 'Hero in Training', imageUrl: 'https://cards.scryfall.io/normal/front/1/0/105a937b-289c-47b5-96a4-654c697bbb7d.jpg?1783902973' },
      { name: 'Web Up', imageUrl: 'https://cards.scryfall.io/normal/front/9/a/9a1b057b-229c-4f65-ba4e-12dd342238de.jpg?1783902964' },
      { name: 'The Vision', imageUrl: 'https://cards.scryfall.io/normal/front/2/9/2961cf20-33c8-4e66-9d0f-6daca8ea7880.jpg?1783902887' },
      { name: 'Cosmic Cube', imageUrl: 'https://cards.scryfall.io/normal/front/d/1/d1cf1ead-fe91-4328-89ab-6d0bc9ff6cbe.jpg?1783902891' },
      { name: 'The Mighty Thor, Jane Foster', imageUrl: 'https://cards.scryfall.io/normal/front/0/8/082cc8cc-bbea-4ca7-a0e8-da1f865d6626.jpg?1783902900' },
    ],
    closeDecisions: [
      { first: 'Cosmic Cube', second: 'The Mighty Thor, Jane Foster', firstSupport: '37.7%', secondSupport: '37.6%', gap: '0.1%' },
      { first: 'Jennifer Walters', second: 'The Wondrous Wasp', firstSupport: '29.8%', secondSupport: '29.7%', gap: '0.1%' },
      { first: 'Ironheart, Clever Champion', second: 'Cruel Alliance', firstSupport: '29.9%', secondSupport: '29.7%', gap: '0.2%' },
    ],
  },
  ecl: {
    setId: 'ecl',
    replaySeats: 300,
    trainingDrafts: 5000,
    trainingPicks: 190000,
    experiencedCohortDrafts: 63585,
    winRateCutoff: '60%',
    averageTopSupport: '38.2%',
    withinTenPoints: '42%',
    historicalTopMatch: '53%',
    averageGap: '16.4%',
    thirtyPointGap: '18%',
    topCards: [
      { name: 'Rimekin Recluse', imageUrl: 'https://cards.scryfall.io/normal/front/b/a/ba6b5368-3262-4002-bf1e-fce62f7f7901.jpg?1783904483' },
      { name: 'Moon-Vigil Adherents', imageUrl: 'https://cards.scryfall.io/normal/front/6/0/60621c37-62e1-4261-ae76-3946b4a0cfa3.jpg?1783904429' },
      { name: "Morcant's Eyes", imageUrl: 'https://cards.scryfall.io/normal/front/a/7/a730b254-ff7c-4f89-a559-b44ad7fd6c6c.jpg?1783904431' },
      { name: 'Eclipsed Kithkin', imageUrl: 'https://cards.scryfall.io/normal/front/2/9/29e1cfa4-0ad8-4228-9f7e-cbab114d1d5f.jpg?1783904412' },
      { name: 'Pyrrhic Strike', imageUrl: 'https://cards.scryfall.io/normal/front/c/c/cce5b16d-07fb-4e64-8ec9-b8b29ba86cff.jpg?1783904500' },
    ],
    closeDecisions: [
      { first: 'Assert Perfection', second: 'Noggle Robber', firstSupport: '24.6%', secondSupport: '24.6%', gap: '0.0%' },
      { first: 'Glamer Gifter', second: 'Assert Perfection', firstSupport: '19.6%', secondSupport: '19.5%', gap: '0.1%' },
      { first: 'Omni-Changeling', second: 'Champion of the Path', firstSupport: '22.2%', secondSupport: '22.2%', gap: '0.1%' },
    ],
  },
  tmt: {
    setId: 'tmt',
    replaySeats: 300,
    trainingDrafts: 3126,
    trainingPicks: 128166,
    experiencedCohortDrafts: 15510,
    winRateCutoff: '62%',
    averageTopSupport: '37.8%',
    withinTenPoints: '42%',
    historicalTopMatch: '55%',
    averageGap: '16.1%',
    thirtyPointGap: '13%',
    topCards: [
      { name: 'Everything Pizza', imageUrl: 'https://cards.scryfall.io/normal/front/d/f/df2cdaa5-9ea0-4aa5-89d3-9edf40fa2a39.jpg?1783904068' },
      { name: 'Lita, Little Orphan Amphibian', imageUrl: 'https://cards.scryfall.io/normal/front/9/f/9fbaabb5-e981-4cbf-888c-46449412711f.jpg?1783904123' },
      { name: 'Frog Butler', imageUrl: 'https://cards.scryfall.io/normal/front/d/1/d1a72d09-9cfc-463a-a9ec-3359003d54da.jpg?1783904089' },
      { name: 'Metalhead', imageUrl: 'https://cards.scryfall.io/normal/front/3/c/3c2d8b09-8694-45ab-be01-f8dc17378cf0.jpg?1783904114' },
      { name: 'Mighty Mutanimals', imageUrl: 'https://cards.scryfall.io/normal/front/5/d/5dd5369c-174c-450b-b776-553866787f8f.jpg?1783904123' },
    ],
    closeDecisions: [
      { first: 'Saved by the Shell', second: 'Stomped by the Foot', firstSupport: '18.1%', secondSupport: '18.0%', gap: '0.1%' },
      { first: 'Koya, Death from Above', second: 'Baxter Stockman', firstSupport: '25.2%', secondSupport: '25.0%', gap: '0.2%' },
      { first: 'Koya, Death from Above', second: 'Michelangelo, Weirdness to 11', firstSupport: '23.9%', secondSupport: '23.7%', gap: '0.2%' },
    ],
  },
  sos: {
    setId: 'sos',
    replaySeats: 300,
    trainingDrafts: 5000,
    trainingPicks: 210000,
    experiencedCohortDrafts: 70209,
    winRateCutoff: '60%',
    averageTopSupport: '49.7%',
    withinTenPoints: '26%',
    historicalTopMatch: '70%',
    averageGap: '28.8%',
    thirtyPointGap: '45%',
    topCards: [
      { name: "Conciliator's Duelist", imageUrl: 'https://cards.scryfall.io/normal/front/e/2/e225929b-6197-4550-969e-3c4a97206a68.jpg?1783903647' },
      { name: 'Snarl Song', imageUrl: 'https://cards.scryfall.io/normal/front/f/c/fc4c7fa2-aebb-4636-9afd-f1010c923316.jpg?1783903655' },
      { name: 'Traumatic Critique', imageUrl: 'https://cards.scryfall.io/normal/front/2/a/2a812fa7-4599-4e25-97db-20ffc6bc0b26.jpg?1783903626' },
      { name: 'Postmortem Professor', imageUrl: 'https://cards.scryfall.io/normal/front/1/7/174f5d7e-5d36-4d13-96bf-9b12cd644716.jpg?1783903677' },
      { name: 'Practiced Offense', imageUrl: 'https://cards.scryfall.io/normal/front/7/9/79c7cf94-c0a1-432d-90d7-7f0599c2e7a8.jpg?1783903699' },
    ],
    closeDecisions: [
      { first: 'Dreamroot Cascade', second: 'Paradox Surveyor', firstSupport: '23.2%', secondSupport: '23.2%', gap: '0.0%' },
      { first: 'Charging Strifeknight', second: 'Stirring Honormancer', firstSupport: '28.5%', secondSupport: '28.5%', gap: '0.0%' },
      { first: 'Additive Evolution', second: 'Inkshape Demonstrator', firstSupport: '24.8%', secondSupport: '24.8%', gap: '0.1%' },
    ],
  },
};

export function setArchive(setId: string) {
  return SET_ARCHIVES[setId as SetArchive['setId']] ?? null;
}
