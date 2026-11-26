import { themedStyles, withAppTheme } from '@/src/appearance';
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
import { config } from '@/src/config';

const nativeLinks = [
  { kicker: 'START HERE', title: 'How to Play', action: 'How to play', body: 'Choose a Daily, make your picks, and see what the trophy drafters took.', route: '/how-to' as const },
  { kicker: 'POINTS', title: 'Scoring', action: 'See scoring', body: 'How your score is calculated.', route: '/scoring' as const },
  { kicker: 'BEHIND THE MODEL', title: 'Method', action: 'How the model works', body: 'Where the picks come from and how the model works.', route: '/method' as const },
  { kicker: 'COVERAGE', title: 'Sets', action: 'Browse sets', body: 'Which sets are in the game and how many picks each one has.', route: '/sets' as const },
];

const externalLinks: { key: CanonicalContentKey; title: string; body: string }[] = [
  { key: 'firstPick', title: 'Rank your top three before the reveal', body: 'Pick your top three cards and decide how close they are before seeing the trophy pick.' },
  { key: 'consensus', title: 'What the model’s numbers actually tell you', body: 'See how close the model thinks a pick is, not just which card it likes best.' },
  { key: 'stayingOpen', title: 'When staying open is worth it', body: 'When is it worth staying open, and when should you just take the better card?' },
  { key: 'deckFit', title: 'When to take the card that fits your deck', body: 'How much should the cards already in your pool change what you take?' },
];

function LearnScreen() {
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
        <View style={styles.hero} onLayout={() => { if (config.screenshots.fixtures) console.info('PACKONE_LEARN_READY'); }}>
          <Text style={styles.eyebrow}>LEARN</Text>
          <Text style={styles.title}>How Pack One works.</Text>
          <Text style={styles.lede}>See how scoring works, where the picks come from, and what to look for when you disagree with the model.</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="About Pack One"
          onPress={() => router.push('/about')} style={styles.aboutRow}>
          <View style={styles.aboutCopy}>
            <Text style={styles.cardTitle}>About Pack One</Text>
            <Text style={styles.body}>The project, the data behind the picks, and the people to credit.</Text>
          </View>
          <Text style={styles.aboutArrow} accessible={false}>›</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Game & model</Text>
        <View style={styles.grid}>
          {nativeLinks.map((item) => (
            <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`}
              onPress={() => router.push(item.route)} style={[styles.card, item.route === '/how-to' && styles.primaryCard]}>
              <Text style={styles.kicker}>{item.kicker}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.action}>{item.action} →</Text>
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
              <Text style={styles.action}>Read guide →</Text>
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

const styles = themedStyles(StyleSheet.create({
  primaryCard: { flexBasis: '100%', borderTopWidth: 3, borderTopColor: colors.accent },
  playButton: { minHeight: 52, padding: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  playText: { color: colors.surface, fontWeight: '700', fontSize: 16 },
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  hero: { gap: spacing.xs },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8 },
  lede: { color: colors.muted, fontSize: 14, lineHeight: 21, maxWidth: 720 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  aboutRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  aboutCopy: { flex: 1, minWidth: 0, gap: 2 },
  aboutArrow: { color: colors.muted, fontSize: 26, lineHeight: 30 },
  card: { flexBasis: 280, minWidth: 0, flexGrow: 1, flexShrink: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cardTitle: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  action: { color: colors.accentDark, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
}));

export default withAppTheme(LearnScreen);
