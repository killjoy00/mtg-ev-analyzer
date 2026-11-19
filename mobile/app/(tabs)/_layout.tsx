import { Tabs } from 'expo-router';
import { StyleSheet, View, useWindowDimensions, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/src/components/Text';
import { TabIcon } from '@/src/components/TabIcon';
import { AdaptiveTabBar } from '@/src/components/AdaptiveTabBar';
import { useNavigationSession } from '@/src/navigation/session';
import { colors } from '@/src/theme';

// URL paths remain /, /practice, /leaderboard, /learn, /career and /how-to.
// Hidden guest tabs are still public routes; this is navigation, not authorization.
export default function TabLayout() {
  const { session } = useNavigationSession();
  const member = Boolean(session?.accountToken);
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const icon = (name: 'daily' | 'practice' | 'leaders' | 'learn' | 'account') => function Icon({ color }: { color: ColorValue }) { return <TabIcon name={name} color={color} />; };
  return <View style={styles.shell}>
    <Tabs backBehavior="history" tabBar={props => <AdaptiveTabBar {...props} />} screenOptions={{
      // The tab screens already contain their own page heading. The redundant
      // navigator header costs a row of vertical space on every phone.
      // ScreenArea handles the top safe inset for headerless tab screens.
      headerShown: false,
      tabBarActiveTintColor: colors.accentDark, tabBarInactiveTintColor: colors.muted,
      tabBarLabelPosition: 'below-icon',
      tabBarLabel: ({ color, children }) => <Text style={{ color, fontSize: 12, fontWeight: '600', textAlign: 'center', width: '100%', flexShrink: 1 }}>{children}</Text>,
      tabBarItemStyle: { paddingHorizontal: 2 },
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 60 + Math.max(insets.bottom, 8) + Math.max(0, fontScale - 1) * 64, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6 },
      tabBarActiveBackgroundColor: colors.accentSoft, tabBarHideOnKeyboard: true,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Daily', headerShown: false, tabBarIcon: icon('daily') }} />
      <Tabs.Screen name="practice" options={{ title: 'Practice', href: member ? '/practice' : null, tabBarIcon: icon('practice') }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaders', href: member ? '/leaderboard' : null, tabBarIcon: icon('leaders') }} />
      <Tabs.Screen name="learn" options={{ title: member ? 'Learn' : 'How to Play', tabBarIcon: icon('learn') }} />
      <Tabs.Screen name="career" options={{ title: 'My Pack One', href: member ? '/career' : null, tabBarIcon: icon('account') }} />
      <Tabs.Screen name="sign-in" options={{ title: 'Sign in', href: member ? null : '/sign-in', tabBarIcon: icon('account') }} />
    </Tabs>
  </View>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.page },
});
