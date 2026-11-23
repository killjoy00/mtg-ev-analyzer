import { ScrollView, StyleSheet } from 'react-native';

import { themedStyles, withAppTheme } from '@/src/appearance';
import { CardDisplaySettings } from '@/src/components/CardDisplaySettings';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { Text } from '@/src/components/Text';
import { colors, spacing } from '@/src/theme';

// Appearance is available to guests and signed-in players. Light and dark
// mode follow the device; Pack One has no separate theme switch.
function AccountAppearanceScreen() {
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>Appearance</Text>
    <Text style={styles.body}>Pack One follows your device’s light or dark setting.</Text>
    <CardDisplaySettings />
  </ScrollView></SafeAreaView>;
}

const styles = themedStyles(StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, alignSelf: 'center', width: '100%', maxWidth: 760 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
}));

export default withAppTheme(AccountAppearanceScreen);
