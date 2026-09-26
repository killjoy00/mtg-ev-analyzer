export type LearningGuide = {
  slug: string;
  title: string;
  deck: string;
  sections: { title: string; body: string[]; callout?: string }[];
};

export const LEARNING_GUIDES: LearningGuide[] = [
  {
    slug: 'first-pick-discipline',
    title: 'First-pick discipline: commit before the reveal',
    deck: 'A repeatable way to use opening packs to separate card strength, confidence, and hindsight.',
    sections: [
      {
        title: 'Make the ranking before you look for permission.',
        body: [
          'Opening packs are deceptively comfortable because there is no existing pool to constrain you. That makes them perfect for practicing a specific skill: turning a noisy set of plausible cards into an explicit order. The value comes from committing before the reveal, not from recognizing a good card after the model highlights it.',
          'Start by identifying the cards you believe are serious first-pick candidates. Then force yourself to rank three. The third slot matters: it reveals whether you have a real tier or are simply naming the obvious rare and the best removal spell.',
        ],
      },
      {
        title: 'Separate strength from confidence.',
        body: [
          'You can prefer Card A to Card B while still believing the decision is close. Record both ideas mentally. When Pack One reveals a narrow support margin, a disagreement may simply mean that two strong options are genuinely clustered. When the model shows a large gap, the disagreement deserves more investigation.',
        ],
      },
      {
        title: 'Review categories, not just card names.',
        body: [
          'After a miss, ask what caused it. Did you overvalue raw rate? Discount flexibility? Prefer synergy before having a reason to commit? Misread a color-intensive cost? The transferable lesson is usually a category of reasoning, not “remember that this specific card is better.”',
        ],
        callout: 'A useful routine: rank three, state your confidence, reveal, then write one sentence explaining the largest difference between your ranking and the model.',
      },
      {
        title: 'Use repetition without memorizing.',
        body: [
          'Unlimited packs are useful until you start recognizing the exact replay. At that point, switch sets or come back later. The goal is repeated decision structure, not learning an answer key.',
        ],
      },
    ],
  },
  {
    slug: 'reading-consensus',
    title: 'How to read consensus without treating it as truth',
    deck: 'Use the shape of model support to distinguish strong signals from legitimately close Limited decisions.',
    sections: [
      {
        title: 'The gap matters as much as the winner.',
        body: [
          'A leaderboard-style list of cards can tempt you to focus only on which card is first. Pack One is more informative when you look at how support is distributed. If the top two cards are nearly tied, the model is describing a cohort with meaningful disagreement. If the first card is far ahead, the cohort is much more concentrated.',
        ],
      },
      {
        title: 'Three kinds of disagreement',
        body: [
          'Candidate-set disagreement happens when your preferred card is outside the cluster the model considers strongest. Ordering disagreement happens when you and the model identify the same strong cards but rank them differently. Confidence disagreement happens when you think a pick is obvious but the model is split, or vice versa.',
          'Those three cases deserve different review. Candidate-set misses often point to valuation or contextual blind spots. Ordering differences are more likely to be subtle preferences. Confidence differences are invitations to inspect why one side believes the pack is more decisive.',
        ],
      },
      {
        title: 'Do not convert support into win rate.',
        body: [
          'Normalized support only compares the cards in front of you under this model. It does not say that selecting a 55% card produces a 55% match win rate, or that a 20% card is wrong 80% of the time. The numbers are a language for relative preference.',
        ],
        callout: 'Best use: treat consensus as a second opinion from a reproducible model of strong-player behavior. A second opinion is valuable precisely because you can disagree with it.',
      },
      {
        title: 'Look for patterns across sessions.',
        body: [
          'One disagreement can be noise. Ten similar disagreements can be a tendency. If your misses repeatedly involve multicolor cards, expensive interaction, narrow synergy pieces, or flexible lands, that pattern is more useful than any single grade.',
        ],
      },
    ],
  },
  {
    slug: 'staying-open',
    title: 'Staying open is not the same as avoiding commitment',
    deck: 'A first-pack framework for flexibility: when optionality has value, and when it becomes an excuse not to take the best card.',
    sections: [
      {
        title: 'Optionality has a price.',
        body: [
          'Limited players often say they want to stay open, but openness is not free. Taking a flexible card over a substantially stronger committed card means paying real card quality for future options. Sometimes that trade is correct. The useful question is how much quality you are giving up and what information you expect to gain.',
        ],
      },
      {
        title: 'Early picks can carry different kinds of flexibility.',
        body: [
          'A strong monocolor card keeps more futures available than a similarly strong gold card. A colorless card may be even easier to use, but that does not automatically make it the best pick. Flexibility is one attribute in the decision, not a replacement for power.',
        ],
      },
      {
        title: 'Use the replay pool as context, not prophecy.',
        body: [
          'In Draft Run, Pack One shows the historical pool entering each decision. That context helps the model reflect what experienced drafters tended to do with similar holdings. Each question comes from a separate trophy draft, and your earlier answers do not rewrite its pool, so use the feature to study contextual preference rather than to simulate a branching draft.',
        ],
        callout: 'A practical test: if you are choosing the more flexible card, say what future you are preserving and what strength you are sacrificing. If you cannot name either, “staying open” may just be a story you are telling after the fact.',
      },
      {
        title: 'Commit when the evidence earns it.',
        body: [
          'Good drafting is not maximal flexibility. It is flexible enough to react to information and decisive enough to capitalize when the signal is real. Review your Pack One misses for both errors: committing too early and refusing to commit when the payoff is already visible.',
        ],
      },
    ],
  },
  {
    slug: 'card-strength-vs-fit',
    title: 'Card strength vs. deck fit: know what changed',
    deck: 'A practical way to separate raw card quality from the contextual reasons your current draft should change the pick.',
    sections: [
      {
        title: 'Start with the pick you would make in a vacuum.',
        body: [
          'Before you use your pool as an explanation, identify the strongest cards in the pack on baseline power. You are not pretending context does not matter. You are giving yourself a reference point. If Card A is clearly stronger than Card B before context, your draft should need a real reason to reverse that order.',
          'This is especially useful when a pick feels obvious because one card matches your colors. Matching your colors is information, but it is not the same thing as proving that the lower-power card has become the better pick.',
        ],
      },
      {
        title: 'Name the reason the context should move the ranking.',
        body: [
          '“It fits my deck” is too broad to teach you much. Be specific. Are you short on early plays? Does your mana make the stronger card unrealistic? Do you already have the payoffs that turn a synergy piece into a premium card? Is one role easy to replace later while the other is scarce?',
          'The more precise the reason, the easier it is to review after the reveal. You can disagree with the comparison and still learn whether your adjustment was grounded in something real.',
        ],
      },
      {
        title: 'Demand a bigger reason for a bigger downgrade.',
        body: [
          'Small contextual edges should usually break close ties. They should not automatically erase a large gap in card strength. When you move a clearly stronger card below a merely playable one, make yourself state what changed enough to justify that move.',
          'This habit helps with one of Limited’s most common traps: turning an early preference into a commitment and then using every later pick as evidence that the commitment was correct.',
        ],
        callout: 'A useful routine: rank the best three cards on baseline strength, write down the one or two contextual factors that matter, make the final ranking, then reveal. Review whether your adjustment was in the right direction and whether it was too large or too small.',
      },
      {
        title: 'Use the reveal to grade the adjustment, not memorize the answer.',
        body: [
          'When Pack One’s trophy pick or model support differs from yours, ask two separate questions. Did you estimate the baseline cards correctly? And did you apply the current draft context correctly? Those are different skills, and combining them into one “right or wrong” reaction makes both harder to improve.',
          'If your baseline ranking was sound but your contextual adjustment was too aggressive, that is a different lesson from missing the strongest card in the pack entirely.',
        ],
      },
      {
        title: 'Context matters most when you can explain it before the reveal.',
        body: [
          'After the answer appears, almost any pool can be turned into a story that supports it. The useful discipline is making the story first. State what your deck needs, how much that should matter, and which card moves because of it. Then let the reveal test the reasoning you actually used.',
        ],
      },
    ],
  },
];

export function learningGuide(slug: string) {
  return LEARNING_GUIDES.find((guide) => guide.slug === slug) ?? null;
}
