import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme';

export type ArticleSection = {
  title: string;
  body: string[];
  extra?: ReactNode;
};

export function ArticleScreen({
  kicker,
  title,
  deck,
  sections,
  footer,
}: {
  kicker: string;
  title: string;
  deck: string;
  sections: ArticleSection[];
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.deck}>{deck}</Text>
        </View>

        <View style={styles.prose}>
          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.body.map((paragraph, index) => (
                <Text key={`${section.title}-${index}`} style={styles.body}>{paragraph}</Text>
              ))}
              {section.extra}
            </View>
          ))}
        </View>

        {footer}
      </ScrollView>
    </SafeAreaView>
  );
}

export const articleStyles = StyleSheet.create({
  linkGrid: { gap: spacing.md },
  linkCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  linkKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  linkTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  linkBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  linkAction: { color: colors.accentDark, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  callout: {
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    padding: spacing.md,
    gap: spacing.xs,
  },
  calloutTitle: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  calloutBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 860 },
  header: { gap: spacing.sm, paddingTop: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  deck: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  prose: { gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
});
