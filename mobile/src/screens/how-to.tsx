import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/src/components/Text';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';

// Same wording as the published guide (how-it-works/index.html).
const sections: ArticleSection[] = [
  {
    title: '1. Choose a Daily.',
    body: [
      'Pick one of three Dailies. Draft Run mixes regular sets, mostly newer ones. Latest Set uses just the newest release. Powered Cube uses Cube drafts. Each game has eight picks, and everyone gets the same ones each day.',
      'If this is your first visit, start with Daily Draft Run. It is the broadest version of Pack One and does not require an account.',
    ],
  },
  {
    title: '2. Read the draft before you pick.',
    body: [
      'Each pick puts you in a different trophy drafter’s seat. You see the pack they had and the cards they’d already taken. Think through the same things you would in your own draft: card strength, colors, curve, and what the deck needs. Your picks don’t carry over to the next pack, since each one comes from a separate draft.',
    ],
  },
  {
    title: '3. Make your choice before the reveal.',
    body: [
      "Pick the card you'd take and lock it in. You don't get to see the trophy drafter's pick until after you've made your choice.",
      "You can't reroll a Daily. If you stop halfway through, come back before the daily reset and you'll pick up where you left off.",
    ],
  },
  {
    title: '4. Compare your pick with what happened.',
    body: [
      'After you lock in, Pack One reveals the trophy drafter’s actual choice and the model-supported alternatives. Matching the trophy drafter earns 100 points. Other choices can still receive partial credit when the model finds strong support for them, with alternatives capped below an exact trophy match.',
      "A trophy doesn't mean every pick was perfect. The model isn't always right either. If you disagree with either one, look at the other options and decide whether you'd still make the same pick.",
    ],
  },
  {
    title: '5. Finish all eight decisions.',
    body: [
      "Your final score is the average of your eight picks. You'll also see how many times you matched the trophy drafter. Since everyone gets the same Daily picks, you can compare scores with friends.",
      'The three Dailies refresh each day on the Pack One Pacific calendar. If you leave a Daily in progress, returning to it resumes the saved attempt.',
    ],
  },
  {
    title: '6. Share, compare, or keep practicing.',
    body: [
      'You can play and share all three Dailies without an account. Make a free account if you want to join the leaderboard or play unlimited regular Draft Runs. If you already finished a Daily as a guest, you can still sign in before midnight Pacific and add your score. Elite gives you Powered Cube practice and lets you choose your sets.',
      'Want more detail? You can read about scoring, where the picks come from, and which sets are in the game below.',
    ],
  },
];

const links = [
  {
    kicker: 'POINTS',
    title: 'Scoring',
    body: 'See exactly how trophy matches, model-supported alternatives, and the eight-pick average become your final score.',
    route: '/scoring' as const,
  },
  {
    kicker: 'BEHIND THE MODEL',
    title: 'Method',
    body: 'See how Pack One selects trophy decisions, qualifies draft evidence, and builds the model used for partial credit.',
    route: '/method' as const,
  },
  {
    kicker: 'COVERAGE',
    title: 'Sets',
    body: 'Browse the sets currently supported by Pack One and see the available Draft Run coverage.',
    route: '/sets' as const,
  },
  {
    kicker: 'ABOUT',
    title: 'About Pack One',
    body: 'Why Pack One exists, its data sources, and project credits.',
    route: '/about' as const,
  },
];

function PlayDaily() {
  return <Pressable accessibilityRole="button" accessibilityLabel="Play Daily Draft Run" onPress={() => router.push({ pathname: '/draft-run', params: { environment: 'mixed' } })} style={articleStyles.callout}>
    <Text style={articleStyles.linkAction}>Play Daily Draft Run →</Text>
    <Text style={articleStyles.calloutBody}>No account required.</Text>
  </Pressable>;
}

export default function HowToScreen() {
  return (
    <ArticleScreen
      kicker="Game guide"
      title="How to Play Pack One"
      deck="Eight picks from real trophy drafts. Choose a card, lock it in, then see what the drafter took and what you scored."
      intro={<View style={articleStyles.linkGrid}>
        {[
          ['01 · Choose a Daily', 'Start with Draft Run, Powered Cube, or the Latest Set.'],
          ['02 · Make your pick', 'Read the pack and earlier pool, then lock in your choice.'],
          ['03 · See the trophy pick', 'Find out what the drafter took and what you scored.'],
        ].map(([title, body]) => <View key={title} style={articleStyles.callout}>
          <Text style={articleStyles.calloutTitle}>{title}</Text><Text style={articleStyles.calloutBody}>{body}</Text>
        </View>)}
        <PlayDaily />
      </View>}
      sections={sections}
      footer={(
        <View style={articleStyles.linkGrid}>
          <PlayDaily />
          {links.map((link) => (
            <Pressable
              key={link.title}
              accessibilityRole="button"
              onPress={() => router.push(link.route)}
              style={articleStyles.linkCard}
            >
              <Text style={articleStyles.linkKicker}>{link.kicker}</Text>
              <Text style={articleStyles.linkTitle}>{link.title}</Text>
              <Text style={articleStyles.linkBody}>{link.body}</Text>
              <Text style={articleStyles.linkAction}>View {link.title.toLowerCase()} →</Text>
            </Pressable>
          ))}
        </View>
      )}
    />
  );
}
