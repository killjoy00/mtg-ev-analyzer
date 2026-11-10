import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import { useNavigationSession } from '@/src/navigation/session';
import HowToScreen from '@/src/screens/how-to';
import { canonicalContentUrl, type CanonicalContentKey } from '@/src/contentLinks';
import { colors, spacing } from '@/src/theme';

const nativeLinks = [
  { kicker: 'START HERE', title: 'How to Play', body: 'Learn the basic loop: choose a Daily, read the draft context, make your pick, and compare with the trophy drafter.', route: '/how-to' as const },
  { kicker: 'POINTS', title: 'Scoring', body: 'See why an exact trophy match earns 100 and how model support gives partial credit to strong alternatives.', route: '/scoring' as const },
  { kicker: 'BEHIND THE MODEL', title: 'Method', body: 'See how Pack One selects trophy decisions, qualifies evidence, and builds the model used for comparison.', route: '/method' as const },
  { kicker: 'COVERAGE', title: 'Sets', body: 'See which sets are in the game and how many real draft picks are available from each.', route: '/sets' as const },
  { kicker: 'ABOUT', title: 'About Pack One', body: 'Learn about the project, its data sources, and credits.', route: '/about' as const },
];

const externalLinks: { key: CanonicalContentKey; title: string; body: string }[] = [
  { key: 'firstPick', title: 'First-pick discipline: commit before the reveal', body: 'Pick your top three cards and decide how close they are before seeing the trophy pick.' },
  { key: 'consensus', title: 'How to read consensus without treating it as truth', body: 'See how close the model thinks a pick is, not just which card it likes best.' },
  { key: 'stayingOpen', title: 'Staying open is not the same as avoiding commitment', body: 'When is it worth staying open, and when should you just take the better card?' },
  { key: 'deckFit', title: 'Card strength vs. deck fit: know what changed', body: 'Separate a card’s baseline power from the ways your pool, curve, mana, and synergies should change the pick.' },
];

export default function LearnScreen() {
  const { session } = useNavigationSession();
  const [error, setError] = useState<string | null>(null);
  const openCanonical = async (key: CanonicalContentKey, title: string) => {
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(canonicalContentUrl(key));
    } catch {
      setError(`Could not open ${title}. Try again when your browser is available.`);
    }
  };

  if (!session?.accountToken) return <HowToScreen />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>LEARN</Text>
          <Text style={styles.title}>How Pack One works.</Text>
          <Text style={styles.lede}>Want to know where a pick came from or why it scored the way it did? Here&apos;s where you&apos;ll find the rules, scoring details, supported sets, and a few drafting guides.</Text>
        </View>

        <Text style={styles.sectionTitle}>Game & model</Text>
        <View style={styles.grid}>
          {nativeLinks.map((item) => (
            <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`}
              onPress={() => router.push(item.route)} style={[styles.card, item.route === '/how-to' && styles.primaryCard]}>
              <Text style={styles.kicker}>{item.kicker}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.action}>Open in Pack One →</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Drafting guides</Text>
        <View style={styles.grid}>
          {externalLinks.map((item) => (
            <Pressable key={item.key} accessibilityRole="link" accessibilityLabel={`Open ${item.title} on packone.pro`}
              onPress={() => void openCanonical(item.key, item.title)} style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.action}>Open packone.pro →</Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/draft-run', params: { environment: 'mixed' } })} style={styles.playButton}>
          <Text style={styles.playText}>Play Daily Draft Run</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  primaryCard: { flexBasis: '100%', borderTopWidth: 3, borderTopColor: colors.accent },
  playButton: { minHeight: 52, padding: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  playText: { color: colors.surface, fontWeight: '700', fontSize: 16 },
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -0.8 },
  lede: { color: colors.muted, fontSize: 16, lineHeight: 24, maxWidth: 720 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: { flexBasis: 280, minWidth: 0, flexGrow: 1, flexShrink: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardTitle: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  action: { color: colors.accentDark, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
