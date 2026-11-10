import { View } from 'react-native';
import { Text } from '@/src/components/Text';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';

// Same wording as the published scoring page (scoring/index.html).
const sections: ArticleSection[] = [
  {
    title: 'Match the trophy pick, get 100 points.',
    body: [
      'Match what the trophy drafter took and you get 100. That doesn’t mean it was the only good pick. The model can still give you partial credit for other choices.',
    ],
  },
  {
    title: 'How partial credit works.',
    body: [
      'Other picks can score up to 95. We compare the model’s support for your card with its top choice to calculate partial credit. Model support isn’t a win rate, and it isn’t the same as points.',
    ],
    extra: (
      <View style={articleStyles.callout}>
        <Text style={articleStyles.calloutTitle}>Trophy drafter: Card B: 100.</Text>
        <Text style={articleStyles.calloutBody}>Model’s strongest alternative: Card A: 95.</Text>
        <Text style={articleStyles.calloutBody}>The drafter took Card B, so it gets 100 points. The model likes Card A best, but because it wasn&apos;t the trophy pick, it gets 95.</Text>
      </View>
    ),
  },
  {
    title: 'A partial-credit example.',
    body: [
      'Say the model supports your card half as much as its favorite. Your pick gets 48 points. If your card has 90% as much support, it gets 86. Matching the trophy drafter still gets you 100, even if the model preferred something else.',
    ],
  },
  {
    title: 'Eight picks count equally.',
    body: [
      "Every pick counts the same toward your final score. Harder picks don't earn bonus points. We also show how many times you matched the trophy drafter.",
    ],
  },
  {
    title: 'Fixed Dailies make scores comparable.',
    body: [
      "Everyone gets the same Daily picks, with no rerolls. You can play and share without an account. If you want your score on the leaderboard, sign in before you start. Played as a guest? You can still add your first completed attempt by signing in before the Daily resets at midnight Pacific. After that, it's too late to add that day's score.",
    ],
  },
  {
    title: 'What if the model disagrees?',
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
