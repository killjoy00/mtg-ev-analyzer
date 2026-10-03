import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/src/components/Text';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';

const sections: ArticleSection[] = [
  {
    title: '1. Choose a Daily.',
    body: [
      'Pack One has three fixed Daily challenges. Daily Draft Run draws from current Live regular sets with an emphasis on recent releases. Daily Latest Set stays entirely inside the newest Live released set. Daily Powered Cube uses Powered Cube trophy drafts. Each Daily contains eight decisions, and everyone receives the same challenge for that Pacific date.',
      'If this is your first visit, start with Daily Draft Run. It is the broadest version of Pack One and does not require an account.',
    ],
  },
  {
    title: '2. Read the draft before you pick.',
    body: [
      'Every decision is a snapshot from a real draft that ended in a trophy. You see the pack that was available and the cards already drafted before that decision. Use that context the same way you would in an actual draft: card strength matters, but so do color commitments, signals, curve, synergy, and the shape of the pool.',
      'The eight decisions come from different source drafts. You are not building one continuous deck across the run, so reset your thinking when the next decision begins.',
    ],
  },
  {
    title: '3. Make your choice before the reveal.',
    body: [
      'Select the card you would take and lock the pick. Pack One does not show the historical answer first. The point is to commit to your own read, then compare it with evidence after the decision is made.',
      'Dailies do not allow rerolls. A started Daily resumes the same saved attempt rather than generating another version of that day’s challenge.',
    ],
  },
  {
    title: '4. Compare your pick with what happened.',
    body: [
      'After you lock in, Pack One reveals the trophy drafter’s actual choice and the model-supported alternatives. Matching the trophy drafter earns 100 points. Other choices can still receive partial credit when the model finds strong support for them, with alternatives capped below an exact trophy match.',
      'The reveal is a comparison, not a declaration that every historical trophy pick was uniquely correct. A disagreement is often the useful part: look at the alternatives, the earlier pool, and the relative support before moving on.',
    ],
  },
  {
    title: '5. Finish all eight decisions.',
    body: [
      'Your run score is the rounded average of all eight decision scores. The final result also shows how often you matched the trophy drafter. Because the Daily is fixed, friends playing the same environment can compare results on the same decisions instead of on different random packs.',
      'The three Dailies refresh each day on the Pack One Pacific calendar. If you leave a Daily in progress, returning to it resumes the saved attempt.',
    ],
  },
  {
    title: '6. Share, compare, or keep practicing.',
    body: [
      'Guests can play, score, and share all three Dailies. A free account adds a persistent identity and unlimited regular Draft Run practice. If an eligible account is linked before the Daily starts, the result ranks immediately; an eligible guest can also sign in or link the completed first attempt on the same Pacific date to validate it for the leaderboard. Additional account access can include Powered Cube practice and custom set selection in the Practice hub.',
      'If you want to understand why alternatives receive partial credit, how Pack One chooses source decisions, or which sets are currently represented, the pages below go deeper without changing the basic loop: make the decision first, then use the reveal as evidence.',
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
];

function PlayDaily() {
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/draft-run', params: { environment: 'mixed' } })} style={articleStyles.callout}>
    <Text style={articleStyles.linkAction}>Play Daily Draft Run →</Text>
    <Text style={articleStyles.calloutBody}>Free · No account required</Text>
  </Pressable>;
}

export default function HowToScreen() {
  return (
    <ArticleScreen
      kicker="Game guide"
      title="How to Play Pack One"
      deck="Eight real draft decisions. Make your pick, lock it in, then see what the trophy drafter chose and how strong your pick was."
      intro={<View style={articleStyles.linkGrid}>
        {[
          ['01 · Choose a Daily', 'Start with Draft Run, Powered Cube, or the Latest Set.'],
          ['02 · Make your pick', 'Read the pack and earlier pool, then lock in your choice.'],
          ['03 · Compare the reveal', 'See the trophy pick and the strongest model-supported alternatives.'],
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
