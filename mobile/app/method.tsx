import { ArticleScreen, type ArticleSection } from '@/src/components/ArticleScreen';

// Same wording as the published methodology page (methodology/index.html).
const sections: ArticleSection[] = [
  {
    title: 'Real packs and earlier picks.',
    body: [
      "Each pick comes from a real draft in the public 17Lands data. You're seeing the pack that player saw, along with their earlier picks. Because every question comes from a different draft, your answer doesn't change the cards in the next one.",
    ],
  },
  {
    title: 'Which Premier drafts count?',
    body: [
      "A 7-0, 7-1, or 7-2 finish counts as a trophy. We only use drafts from experienced players who've played at least 100 previous games and meet our performance requirements for that set. For older sets without win-rate data, we use rank instead.",
    ],
  },
  {
    title: 'What goes into the model?',
    body: [
      'The model learns from picks made by experienced 17Lands drafters, not just trophy winners. It considers which cards were available, where the pick happened, and what the drafter had already taken. We also leave out the specific draft being used for the puzzle when evaluating its picks.',
    ],
  },
  {
    title: 'When a new set gets added',
    body: [
      'We add new sets once we’ve checked the draft records, card images, and scoring data. Once a Daily is published, its eight picks stay the same for everyone that day.',
    ],
  },
  {
    title: 'Why Cube starts at Pick 2',
    body: [
      "The public 17Lands Cube data doesn't include complete opening packs, so we don't use Pick 1. Instead, the Cube puzzles come from Picks 2–9, with the drafter's first pick shown for context. We don't make up missing cards.",
    ],
  },
  {
    title: 'Traditional drafts are in the mix, too.',
    body: [
      "Some 3-0 Traditional drafts show up in Pack One, as long as the draft record and cards pass our checks. They give us more real picks to play, but aren't used to train the scoring model. That still comes from Premier draft data.",
    ],
  },
  {
    title: 'Provenance and limits.',
    body: [
      'Public 17Lands datasets are licensed under CC BY 4.0. Pack One adapts them into puzzles, statistics and model evidence. Metadata and images come from Scryfall. Archives are recorded samples, not every draft played, and model support is not proof of the best pick. See the Terms for full attribution and source-license information.',
    ],
  },
];

export default function MethodScreen() {
  return (
    <ArticleScreen
      kicker="Model notes"
      title="Methodology"
      deck="Where the picks come from, who drafted them, and what goes into your score."
      sections={sections}
    />
  );
}
