import { themedStyles } from '@/src/appearance';
import { useRef, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/src/components/Text';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { config } from '@/src/config';

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
  intro,
  scrollToEnd = false,
}: {
  kicker: string;
  title: string;
  deck: string;
  sections: ArticleSection[];
  footer?: ReactNode;
  intro?: ReactNode;
  scrollToEnd?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.page}
        onContentSizeChange={() => {
          if (scrollToEnd) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        <View
          onLayout={() => {
            if (config.screenshots.fixtures) console.info('PACKONE_ARTICLE_READY', JSON.stringify({ title }));
          }}
          style={styles.header}
        >
          <Text style={styles.kicker}>{kicker.toUpperCase()}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.deck}>{deck}</Text>
        </View>

        {intro}
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

export const articleStyles = themedStyles(StyleSheet.create({
  linkGrid: { gap: spacing.sm },
  linkCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
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
}));

const styles = themedStyles(StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: 20, alignSelf: 'center', width: '100%', maxWidth: 840 },
  header: { gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8 },
  deck: { color: colors.muted, fontSize: 16, lineHeight: 23 },
  prose: { gap: 20 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
}));
