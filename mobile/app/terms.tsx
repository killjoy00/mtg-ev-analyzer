import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArticleScreen } from '@/src/components/ArticleScreen';
import { Text } from '@/src/components/Text';
import { fontLicenses } from '@/src/fontLicenses';
import { config } from '@/src/config';
import { termsSections } from '@/src/nativeEditorial';
import { colors, spacing } from '@/src/theme';

export default function TermsScreen() {
  const params = useLocalSearchParams<{ licenses?: string }>();
  const previewLicensesOpen = config.screenshots.fixtures && params.licenses === '1';
  const [licensesOpen, setLicensesOpen] = useState(previewLicensesOpen);
  useEffect(() => {
    if (previewLicensesOpen) setLicensesOpen(true);
  }, [previewLicensesOpen]);
  return (
    <ArticleScreen
      kicker="Policy"
      title="Terms"
      deck="Terms for using Pack One, including scoring limitations, licensing and attribution, advertising and affiliate disclosures, external links, and independence."
      sections={termsSections}
      scrollToEnd={previewLicensesOpen}
      footer={(
        <View style={styles.licenses}>
          <Text style={styles.title}>Font licenses</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: licensesOpen }}
            onPress={() => setLicensesOpen(value => !value)}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>{licensesOpen ? 'Hide font licenses' : 'Show font licenses'}</Text>
          </Pressable>
          {licensesOpen ? fontLicenses.map(font => (
            <View key={font.name} style={styles.licenseBlock}>
              <Text style={styles.fontName}>{font.name}</Text>
              <Text style={styles.licenseText}>{font.license}</Text>
            </View>
          )) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  licenses: { gap: spacing.md, borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.xl },
  title: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  toggle: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  toggleText: { color: colors.accentDark, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  licenseBlock: { gap: spacing.sm },
  fontName: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  licenseText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});
