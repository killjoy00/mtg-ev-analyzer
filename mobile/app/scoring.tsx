import { withAppTheme } from '@/src/appearance';
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
      'Other cards can earn up to 95 points. The model estimates how likely drafters are to take each card. The closer your card’s estimate is to the top pick’s, the more points you earn. The model predicts picks, not wins.',
    ],
    extra: (
      <View style={articleStyles.callout}>
        <Text style={articleStyles.calloutTitle}>Trophy drafter: Card B: 100.</Text>
        <Text style={articleStyles.calloutBody}>Model’s top pick: Card A: 95.</Text>
        <Text style={articleStyles.calloutBody}>The drafter took Card B, so it gets 100 points. The model rates Card A highest, but because it wasn&apos;t the trophy pick, it gets 95.</Text>
      </View>
    ),
  },
  {
    title: 'A partial-credit example.',
    body: [
      'Say your card is half as likely to be picked as the model’s top pick. Your pick gets 48 points. If your card is 90% as likely to be picked, it gets 86. Matching the trophy drafter still gets you 100, even if the model preferred something else.',
    ],
  },
  {
    title: 'Eight picks count equally.',
    body: [
      "Every pick counts the same toward your final score. Harder picks don't earn bonus points. You’ll also see how many times you matched the trophy drafter.",
    ],
  },
  {
    title: 'Everyone gets the same Daily picks.',
    body: [
      "Everyone gets the same Daily picks, with no rerolls. You can play and share without an account. If you want your score on the leaderboard, sign in before you start. Played as a guest? You can still add your first completed attempt by signing in before the Daily resets at midnight Pacific. After that, it's too late to add that day's score.",
    ],
  },
  {
    title: 'What if the model disagrees?',
    body: [
      'The model learns from real drafting choices, but it can miss things. The trophy drafter can make mistakes too. If you disagree, look at the pack and earlier picks and decide whether you’d still take the same card. Matching the trophy drafter earns 100 either way.',
    ],
  },
];

function ScoringScreen() {
  return (
    <ArticleScreen
      kicker="Scoring"
      title="How Pack One scoring works"
      deck="100 means you matched the trophy drafter. You can still earn points for picking a different card."
      sections={sections}
    />
  );
}

export default withAppTheme(ScoringScreen);
