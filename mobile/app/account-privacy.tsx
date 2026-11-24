import { ScrollView, StyleSheet } from 'react-native';

import { themedStyles, withAppTheme } from '@/src/appearance';
import { ResultsPreferences } from '@/src/components/ResultsPreferences';
import { AdMobPrivacyChoices } from '@/src/components/AdMobPrivacyChoices';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';

// Published-results privacy is independent of the public profile switch and of
// every email choice, so it has its own destination.
function AccountPrivacyScreen() {
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>Privacy &amp; results</Text>
    <Text style={styles.body}>Choose whether your display name can appear in published Pack One results. Your public profile is set separately in Profile.</Text>
    <ResultsPreferences settings section="privacy" />
    <AdMobPrivacyChoices />
  </ScrollView></SafeAreaView>;
}

const styles = themedStyles(StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, alignSelf: 'center', width: '100%', maxWidth: 760 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
}));

export default withAppTheme(AccountPrivacyScreen);
