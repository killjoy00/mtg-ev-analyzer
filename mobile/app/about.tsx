import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArticleScreen } from '@/src/components/ArticleScreen';
import { Text } from '@/src/components/Text';
import { aboutSections } from '@/src/nativeEditorial';
import { colors, spacing } from '@/src/theme';

const rows = [
  { title: 'Support & contact', body: 'Get help, report a bug, or share an accessibility issue.', route: '/support' as const },
  { title: 'Privacy', body: 'Your information, account deletion, and external services.', route: '/privacy' as const },
  { title: 'Terms', body: 'Using Pack One, scoring limitations, attribution, and disclosures.', route: '/terms' as const },
];

export default function AboutScreen() {
  return (
    <ArticleScreen
      kicker="About"
      title="About Pack One"
      deck="Eight decisions from real trophy drafts."
      sections={aboutSections}
      footer={(
        <View style={styles.links}>
          {rows.map((row) => (
            <Pressable
              key={row.route}
              accessibilityRole="button"
              onPress={() => router.push(row.route)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.copy}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowBody}>{row.body}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  links: { borderTopWidth: 1, borderColor: colors.line },
  row: {
    minHeight: 68,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.72 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  rowBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  arrow: { color: colors.muted, fontSize: 28, lineHeight: 30 },
});
