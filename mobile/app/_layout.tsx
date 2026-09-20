import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/src/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
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
        <Stack.Screen name="career" options={{ title: 'Career' }} />
        <Stack.Screen name="how-to" options={{ title: 'How to Play' }} />
        <Stack.Screen name="scoring" options={{ title: 'Scoring' }} />
        <Stack.Screen name="method" options={{ title: 'Method' }} />
        <Stack.Screen name="sets" options={{ title: 'Sets' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
      </Stack>
    </>
  );
}
