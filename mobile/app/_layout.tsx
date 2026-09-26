import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';

import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { VersionGate } from '@/src/components/VersionGate';
import { colors } from '@/src/theme';

function MembershipEntry() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open membership and account access"
      onPress={() => router.push('/membership')} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.accentDark, fontWeight: '700' }}>Membership</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  return (
    <VersionGate>
      <>
        <StatusBar style="dark" />
        <Stack
          unstable_screenErrorBoundary={ScreenErrorBoundary}
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerShadowVisible: false,
            headerTintColor: colors.ink,
            contentStyle: { backgroundColor: colors.page },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="draft-run" options={{ title: 'Draft Run' }} />
          <Stack.Screen name="shared-run" options={{ title: 'Shared Draft Run' }} />
          <Stack.Screen name="resume-shared-run" options={{ title: 'Saved Shared Run' }} />
          <Stack.Screen name="practice" options={{ title: 'Practice', headerRight: MembershipEntry }} />
          <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
          <Stack.Screen name="career" options={{ title: 'My Pack One' }} />
          <Stack.Screen name="profile" options={{ title: 'Player Profile' }} />
          <Stack.Screen name="historical-challenge" options={{ title: 'Historical Challenge' }} />
          <Stack.Screen name="learn" options={{ title: 'Learn' }} />
          <Stack.Screen name="how-to" options={{ title: 'How to Play' }} />
          <Stack.Screen name="scoring" options={{ title: 'Scoring' }} />
          <Stack.Screen name="method" options={{ title: 'Method' }} />
          <Stack.Screen name="sets" options={{ title: 'Sets' }} />
          <Stack.Screen name="account" options={{ title: 'Account', headerRight: MembershipEntry }} />
          <Stack.Screen name="membership" options={{ title: 'Membership' }} />
        </Stack>
      </>
    </VersionGate>
  );
}
