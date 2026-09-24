import { Text, View } from 'react-native';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';

const sections: ArticleSection[] = [
  {
    title: 'The trophy drafter is the answer key.',
    body: [
      'An exact match earns 100 points, always. The target is a real choice made by a qualified drafter in a draft that trophied. The model grades alternatives; it does not replace that target.',
    ],
  },
  {
    title: 'Excellent alternatives can earn 95.',
    body: [
      'Other choices earn up to 95 based on raw model support relative to the strongest available choice. Partial-credit calibration is separate from probability calibration. Displayed support is not a direct points conversion.',
    ],
    extra: (
      <View style={articleStyles.callout}>
        <Text style={articleStyles.calloutTitle}>Trophy drafter: Card B — 100.</Text>
        <Text style={articleStyles.calloutBody}>Model’s strongest alternative: Card A — 95.</Text>
        <Text style={articleStyles.calloutBody}>Card A can be an excellent alternative according to broader evidence. Card B is the choice that occurred in the successful trophy trajectory.</Text>
      </View>
    ),
  },
  {
    title: 'A partial-credit example.',
    body: [
      'With the current linear curve, an alternative supported half as strongly as the model leader earns 48 after rounding. An alternative at 90% of the leader’s raw support earns 86. These examples apply to alternatives only: an exact trophy match still earns 100, however much support the model assigns it.',
    ],
  },
  {
    title: 'Eight picks count equally.',
    body: [
      'The final score is the rounded average of eight decision scores. Difficulty and depth add no hidden bonuses or penalties. Trophy matches are also counted separately. Historical results retain their original version and length.',
    ],
  },
  {
    title: 'Fixed Dailies make scores comparable.',
    body: [
      'Everyone plays the same Daily with no rerolls. Durable leaderboard participation requires an authenticated account when starting. Guests still receive and can share their score.',
    ],
  },
  {
    title: 'Use disagreement to learn.',
    body: [
      'Model support estimates drafting preferences in context. It cannot prove every historical choice optimal. An unusual trophy pick may reflect a blind spot or considerations missing from the data. It still earns 100.',
    ],
  },
];

export default function ScoringScreen() {
  return (
    <ArticleScreen
      kicker="Scoring"
      title="How Pack One scoring works"
      deck="100 means you matched the trophy drafter. Model support gives partial credit for alternatives."
      sections={sections}
    />
  );
}
