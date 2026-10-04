import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions, type ColorValue, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/src/components/Text';
import { TabIcon } from '@/src/components/TabIcon';
import { AdaptiveTabBar } from '@/src/components/AdaptiveTabBar';
import { useNavigationSession } from '@/src/navigation/session';
import { colors } from '@/src/theme';
import { config } from '@/src/config';

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
      header: ({ options }) => <View style={{ backgroundColor: colors.surface, paddingTop: insets.top, paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16) }}>
        <View style={styles.headerRow} onLayout={event => recordHeader('row', options.title, event)}>
          <Text accessibilityRole="header" style={styles.headerTitle} onLayout={event => recordHeader('title', options.title, event)}>{options.title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Help and information" onPress={() => router.push('/help')}
            onLayout={event => recordHeader('help', options.title, event)} style={styles.help}><Text style={styles.noticeText}>Help</Text></Pressable>
        </View>
      </View>,
      tabBarActiveTintColor: colors.accentDark, tabBarInactiveTintColor: colors.muted,
      tabBarLabelPosition: 'below-icon',
      tabBarLabel: ({ color, children }) => <Text style={{ color, fontSize: 12, fontWeight: '600', textAlign: 'center', width: '100%', flexShrink: 1 }}>{children}</Text>,
      tabBarItemStyle: { paddingHorizontal: 2 },
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 70 + Math.max(insets.bottom, 8) + Math.max(0, fontScale - 1) * 64, paddingBottom: Math.max(insets.bottom, 8), paddingTop: 6 },
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
function recordHeader(label: string, title: string | undefined, event: LayoutChangeEvent) {
  if (config.screenshots.fixtures) console.info('PACKONE_HEADER', JSON.stringify({ label, title, ...event.nativeEvent.layout }));
}
const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8, minHeight: 56 },
  headerTitle: { color: colors.ink, fontSize: 24, fontWeight: '700', flex: 1, minWidth: 0 },
  shell: { flex: 1, backgroundColor: colors.page },
  notice: { padding: 12, backgroundColor: colors.accentSoft },
  noticeText: { color: colors.accentDark, fontSize: 14, fontWeight: '600' },
  checking: { color: colors.muted, padding: 8, fontSize: 14 },
  help: { minWidth: 48, minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
