import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';

const sections: ArticleSection[] = [
  {
    title: '1. Choose a Daily.',
    body: [
      'Pack One has three Daily modes. Daily Draft Run mixes decisions from supported regular Draft sets. Daily Latest Set stays entirely inside the newest Live released set. Daily Powered Cube uses Powered Cube drafts. Each Daily contains eight decisions and everyone receives the same challenge for that date.',
    ],
  },
  {
    title: '2. Read the draft before you pick.',
    body: [
      'Every round is a snapshot from a real draft that ended in a trophy. You see the pack that was available and the cards already drafted before that decision. Use that context the same way you would in an actual draft: card strength matters, but so do color commitments, signals, curve, synergy, and the shape of the pool.',
      'The eight rounds are independent decisions from different drafts. You are not building one continuous deck across the run, so reset your thinking when the next round begins.',
    ],
  },
  {
    title: '3. Make your choice before the reveal.',
    body: [
      'Select the card you would take and lock the pick. Pack One does not show the historical answer first. The point is to commit to your own read, then compare it with evidence after the decision is made.',
    ],
  },
  {
    title: '4. Compare your pick with what happened.',
    body: [
      'After you lock in, Pack One reveals the trophy drafter’s actual choice and the model-supported alternatives. Matching the trophy drafter earns 100 points. Other choices can still receive partial credit when the model finds strong support for them, with alternatives capped below an exact trophy match.',
      'The reveal is meant to show how close or divided the decision was, not to claim that every historical trophy pick was uniquely correct. A disagreement is often the useful part: look at the alternatives, the earlier pool, and the relative support before moving on.',
    ],
  },
  {
    title: '5. Finish all eight decisions.',
    body: [
      'Your run score is based on all eight picks. The final result also shows how often you matched the trophy drafter. Daily challenges are fixed, so friends playing the same Daily can compare results on the same decisions instead of on different random packs.',
      'The three Dailies refresh each day at midnight Pacific. If you leave a Daily in progress, Pack One can resume the saved attempt rather than giving you a new version of that day’s challenge.',
    ],
  },
  {
    title: '6. Play again or share the result.',
    body: [
      'You can play the Dailies without needing an account. Accounts add persistent identity and additional practice options, while Elite members can access expanded practice choices such as custom set selection and Powered Cube practice. When a run is shareable, the link keeps the challenge comparable so another player can make the same decisions.',
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

export default function HowToScreen() {
  return (
    <ArticleScreen
      kicker="Game guide"
      title="How to Play Pack One"
      deck="Eight real draft decisions. Pick the card you would take, lock it in, then see what a trophy drafter did."
      sections={sections}
      footer={(
        <View style={articleStyles.linkGrid}>
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
