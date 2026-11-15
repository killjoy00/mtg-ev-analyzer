import { ArticleScreen, type ArticleSection } from '@/src/components/ArticleScreen';

// Same wording as the published methodology page (methodology/index.html).
const sections: ArticleSection[] = [
  {
    title: 'Real packs and earlier picks.',
    body: [
      "Each pick comes from a real draft in the public 17Lands data. You're seeing the pack that player saw, along with their earlier picks. Because every pick comes from a different draft, your answer doesn't change the cards in the next one.",
    ],
  },
  {
    title: 'Which Premier drafts count?',
    body: [
      "A 7-0, 7-1, or 7-2 finish counts as a trophy. I only use drafts from experienced players who’ve played at least 100 previous games and meet my performance requirements for that set. For older sets without win-rate data, I use rank instead.",
    ],
  },
  {
    title: 'What goes into the model?',
    body: [
      'The model learns from picks made by experienced 17Lands drafters, not just trophy winners. It considers which cards were available, where the pick happened, and what the drafter had already taken. I also leave each pick’s own draft out of the model that scores it.',
    ],
  },
  {
    title: 'When a new set gets added',
    body: [
      'I add new sets once I’ve checked the draft records, card images, and scoring data. Once a Daily is published, its eight picks stay the same for everyone that day.',
    ],
  },
  {
    title: 'Why Cube starts at Pick 2',
    body: [
      "The public 17Lands Cube data doesn't include complete opening packs, so I don’t use Pick 1. Cube runs use Picks 2–9 instead, with the drafter’s first pick shown for context. I don’t make up missing cards.",
    ],
  },
  {
    title: 'Traditional drafts are in the mix, too.',
    body: [
      "Some 3-0 Traditional drafts show up in Pack One, as long as the draft record and cards pass my checks. They add more real picks to play, but aren’t used to train the scoring model. That still comes from Premier draft data.",
    ],
  },
  {
    title: 'Where the data comes from, and its limits.',
    body: [
      'Public 17Lands datasets are licensed under CC BY 4.0. I turn them into the picks, stats and model you see here. Card details and images come from Scryfall. The data is a sample of recorded drafts, not every draft ever played, and model support isn’t proof of the best pick. See the Terms for full attribution and source-license information.',
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
