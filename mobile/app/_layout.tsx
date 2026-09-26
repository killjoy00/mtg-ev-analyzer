import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { VersionGate } from '@/src/components/VersionGate';
import { colors } from '@/src/theme';

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
          <Stack.Screen name="practice" options={{ title: 'Practice' }} />
          <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
          <Stack.Screen name="career" options={{ title: 'My Pack One' }} />
          <Stack.Screen name="profile" options={{ title: 'Player Profile' }} />
          <Stack.Screen name="learn" options={{ title: 'Learn' }} />
          <Stack.Screen name="guide" options={{ title: 'Limited Guide' }} />
          <Stack.Screen name="how-to" options={{ title: 'How to Play' }} />
          <Stack.Screen name="scoring" options={{ title: 'Scoring' }} />
          <Stack.Screen name="method" options={{ title: 'Method' }} />
          <Stack.Screen name="sets" options={{ title: 'Sets' }} />
          <Stack.Screen name="set-archive" options={{ title: 'Set Archive' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="about" options={{ title: 'About & Support' }} />
          <Stack.Screen name="legal" options={{ title: 'Pack One Policy' }} />
        </Stack>
      </>
    </VersionGate>
  );
}
