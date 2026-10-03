import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/src/components/Text';
import { useNavigationSession } from '@/src/navigation/session';
import { colors } from '@/src/theme';

// URL paths remain /, /practice, /leaderboard, /learn, /career and /how-to.
// Hidden guest tabs are still public routes; this is navigation, not authorization.
export default function TabLayout() {
  const { session } = useNavigationSession();
  const member = Boolean(session?.accountToken);
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const icon = (glyph: string) => function TabIcon({ color }: { color: ColorValue }) { return <Text accessible={false} style={{ color, fontSize: 22 }}>{glyph}</Text>; };
  return <View style={styles.shell}>
    <Tabs backBehavior="history" screenOptions={{
      headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.ink, headerShadowVisible: false,
      headerTitleStyle: { fontFamily: 'BarlowCondensed-Bold', fontSize: 24 },
      tabBarActiveTintColor: colors.accentDark, tabBarInactiveTintColor: colors.muted,
      tabBarLabelStyle: { fontFamily: 'SourceSans3-Semibold', fontSize: 12 },
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 62 + Math.max(insets.bottom, 8) + Math.max(0, fontScale - 1) * 32, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6 },
      tabBarActiveBackgroundColor: colors.accentSoft, tabBarHideOnKeyboard: true,
      headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Help and information" onPress={() => router.push('/help')} style={styles.help}><Text style={styles.noticeText}>Help</Text></Pressable>,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Daily', headerShown: false, tabBarIcon: icon('▣') }} />
      <Tabs.Screen name="practice" options={{ title: 'Practice', href: member ? '/practice' : null, tabBarIcon: icon('◇') }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaders', href: member ? '/leaderboard' : null, tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="learn" options={{ title: member ? 'Learn' : 'How to Play', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="career" options={{ title: 'My Pack One', href: member ? '/career' : null, tabBarIcon: icon('○') }} />
      <Tabs.Screen name="sign-in" options={{ title: 'Sign in', href: member ? null : '/sign-in', tabBarIcon: icon('○') }} />
    </Tabs>
  </View>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.page },
  notice: { padding: 12, backgroundColor: colors.accentSoft },
  noticeText: { color: colors.accentDark, fontSize: 14, fontWeight: '600' },
  checking: { color: colors.muted, padding: 8, fontSize: 14 },
  help: { minWidth: 48, minHeight: 44, justifyContent: 'center', marginRight: 12 },
});
