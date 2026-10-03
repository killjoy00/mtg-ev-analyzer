import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { ScreenArea } from '@/src/components/ScreenArea';
import { Text } from '@/src/components/Text';
import { canonicalContentUrl, type CanonicalContentKey } from '@/src/contentLinks';
import { colors, spacing } from '@/src/theme';

const links: { key: CanonicalContentKey; title: string; body: string }[] = [
  { key: 'about', title: 'About Pack One', body: 'Our purpose, data sources, and Fan Content notice.' },
  { key: 'contact', title: 'Support & contact', body: 'Get help, report a bug, or share an accessibility issue.' },
  { key: 'privacy', title: 'Privacy', body: 'Your information, account deletion, and external services.' },
  { key: 'terms', title: 'Terms', body: 'Using Pack One, scoring limitations, and disclosures.' },
];
export default function HelpScreen() {
  const [error, setError] = useState<string | null>(null);
  async function open(key: CanonicalContentKey) {
    setError(null);
    try { await WebBrowser.openBrowserAsync(canonicalContentUrl(key)); }
    catch { setError('Could not open this page. Please try again.'); }
  }
  return <ScreenArea style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    {links.map((link) => <Pressable key={link.key} accessibilityRole="link" onPress={() => void open(link.key)} style={styles.card}>
      <Text style={styles.title}>{link.title}</Text><Text style={styles.body}>{link.body}</Text>
    </Pressable>)}
    {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
  </ScrollView></ScreenArea>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 840, alignSelf: 'center' },
  card: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
});
