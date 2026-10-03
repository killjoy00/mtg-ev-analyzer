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
  { kicker: 'START HERE', title: 'How to Play', body: 'Learn the eight-decision loop and what to look at before you lock a pick.', route: '/how-to' as const },
  { kicker: 'POINTS', title: 'Scoring', body: 'See how trophy matches and model-supported alternatives become your run score.', route: '/scoring' as const },
  { kicker: 'BEHIND THE MODEL', title: 'Method', body: 'See how Pack One qualifies evidence and builds the comparison model.', route: '/method' as const },
  { kicker: 'COVERAGE', title: 'Sets', body: 'Browse current Pack One set coverage and supported Draft Run environments.', route: '/sets' as const },
];

const externalLinks: { key: CanonicalContentKey; title: string; body: string }[] = [
  { key: 'firstPick', title: 'First-pick discipline: commit before the reveal', body: 'A repeatable way to separate card strength, confidence, and hindsight.' },
  { key: 'consensus', title: 'How to read consensus without treating it as truth', body: 'Distinguish strong signals from legitimately close Limited decisions.' },
  { key: 'stayingOpen', title: 'Staying open is not the same as avoiding commitment', body: 'Know when flexibility has value and when to take the best card.' },
  { key: 'deckFit', title: 'Card strength vs. deck fit: know what changed', body: 'Use your pool, curve, mana, and synergies to put card strength in context.' },
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
          <Text style={styles.title}>Go deeper on Pack One.</Text>
          <Text style={styles.lede}>Read the draft with more confidence. Start with the basics, then explore scoring and guides for your next decision.</Text>
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
