import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { LEARNING_GUIDES } from '@/src/content/learning';
import { colors, spacing } from '@/src/theme';

const core = [
  { kicker: 'START HERE', title: 'How to Play', body: 'Learn the basic loop: choose a Daily, read the draft context, make your pick, and compare with the trophy drafter.', route: '/how-to' as const },
  { kicker: 'POINTS', title: 'Scoring', body: 'See why an exact trophy match earns 100 and how model support gives partial credit to strong alternatives.', route: '/scoring' as const },
  { kicker: 'BEHIND THE MODEL', title: 'Method', body: 'See how Pack One selects trophy decisions, qualifies evidence, and builds the model used for comparison.', route: '/method' as const },
  { kicker: 'COVERAGE', title: 'Sets', body: 'Browse current Live set coverage and see which environments and decision depths are available.', route: '/sets' as const },
];

export default function LearnScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>LEARN</Text>
          <Text style={styles.title}>Go deeper on Pack One.</Text>
          <Text style={styles.deck}>
            Start with the rules, then dig into scoring, the method behind the comparisons, current set coverage, and drafting guides built around the same make-the-pick-first philosophy.
          </Text>
        </View>

        <View style={styles.grid}>
          {core.map((item) => (
            <Pressable
              key={item.title}
              accessibilityRole="button"
              onPress={() => router.push(item.route)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Text style={styles.cardKicker}>{item.kicker}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody}>{item.body}</Text>
              <Text style={styles.action}>Open {item.title.toLowerCase()} →</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.kicker}>DRAFTING GUIDES</Text>
          <Text style={styles.sectionTitle}>Use the reveal to study your decisions.</Text>
          <Text style={styles.cardBody}>These guides focus on reasoning habits that transfer from one set to the next.</Text>
        </View>

        <View style={styles.grid}>
          {LEARNING_GUIDES.map((guide) => (
            <Pressable
              key={guide.slug}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/guide', params: { slug: guide.slug } })}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Text style={styles.cardTitle}>{guide.title}</Text>
              <Text style={styles.cardBody}>{guide.deck}</Text>
              <Text style={styles.action}>Read guide →</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.cta}>
          <Text style={styles.kicker}>PUT IT INTO PRACTICE</Text>
          <Text style={styles.sectionTitle}>Make the decision before you read the answer.</Text>
          <Text style={styles.cardBody}>
            Pack One is most useful when you commit first, then use the trophy pick and model support as comparison points, not as an instruction sheet.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/draft-run')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Play today&apos;s Daily</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 920 },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -0.9 },
  deck: { color: colors.muted, fontSize: 17, lineHeight: 25, maxWidth: 720 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: { minWidth: 280, flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm },
  pressed: { opacity: 0.76 },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: '800' },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  action: { color: colors.accentDark, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  sectionHeading: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { color: colors.ink, fontSize: 24, lineHeight: 29, fontWeight: '800' },
  cta: { backgroundColor: colors.accentSoft, borderLeftWidth: 3, borderLeftColor: colors.accent, padding: spacing.lg, gap: spacing.sm },
  primaryButton: { minHeight: 48, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, alignSelf: 'flex-start' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
