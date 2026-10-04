import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { canonicalContentUrl, type CanonicalContentKey } from '@/src/contentLinks';
import { colors, spacing } from '@/src/theme';

const nativeLinks = [
  { kicker: 'START HERE', title: 'How to Play', body: 'Learn the eight-decision loop and what to look at before you lock a pick.', route: '/how-to' as const },
  { kicker: 'POINTS', title: 'Scoring', body: 'See how trophy matches and model-supported alternatives become your run score.', route: '/scoring' as const },
  { kicker: 'BEHIND THE MODEL', title: 'Method', body: 'See how Pack One qualifies evidence and builds the comparison model.', route: '/method' as const },
  { kicker: 'COVERAGE', title: 'Sets', body: 'Browse current Pack One set coverage and supported Draft Run environments.', route: '/sets' as const },
];

const externalLinks: { key: CanonicalContentKey; title: string; body: string }[] = [
  { key: 'learn', title: 'Drafting guides', body: 'Open the current Pack One guide library on packone.pro. Guide copy stays single-source there.' },
  { key: 'about', title: 'About Pack One', body: 'Product purpose, data attribution, and Fan Content notice.' },
  { key: 'contact', title: 'Support & contact', body: 'Bug reports, accessibility, data corrections, feature requests, and business inquiries.' },
  { key: 'privacy', title: 'Privacy', body: 'Current privacy information, account deletion details, analytics, memberships, and external services.' },
  { key: 'terms', title: 'Terms', body: 'Current terms, scoring limitations, attribution, affiliate disclosure, and external-link terms.' },
];

export default function LearnScreen() {
  const [error, setError] = useState<string | null>(null);
  const openCanonical = async (key: CanonicalContentKey, title: string) => {
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(canonicalContentUrl(key));
    } catch {
      setError(`Could not open ${title}. Try again when your browser is available.`);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>LEARN</Text>
          <Text style={styles.title}>Go deeper on Pack One.</Text>
          <Text style={styles.lede}>Start with the game and model inside the app. Editorial guides and policy pages open their canonical Pack One web versions so there is one current copy.</Text>
        </View>

        <Text style={styles.sectionTitle}>Game & model</Text>
        <View style={styles.grid}>
          {nativeLinks.map((item) => (
            <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`}
              onPress={() => router.push(item.route)} style={styles.card}>
              <Text style={styles.kicker}>{item.kicker}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.action}>Open in Pack One →</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Guides, support & policies</Text>
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
        <Text style={styles.note}>Opening these pages does not sign you in to a different Pack One account or share your Pack One sign-in in the URL.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 34, lineHeight: 39, fontWeight: '800', letterSpacing: -0.8 },
  lede: { color: colors.muted, fontSize: 16, lineHeight: 24, maxWidth: 720 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: { width: '48%', minWidth: 280, flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  cardTitle: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  action: { color: colors.accentDark, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
