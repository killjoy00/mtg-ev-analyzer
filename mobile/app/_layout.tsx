import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Linking, Platform, Pressable, Settings, Text } from 'react-native';

import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { VersionGate } from '@/src/components/VersionGate';
import { config } from '@/src/config';
import { colors } from '@/src/theme';

function ScreenshotFixtureEntry() {
  useEffect(() => {
    if (!config.screenshots.fixtures) return;
    if (Platform.OS === 'android') {
      void Linking.getInitialURL().then((url) => {
        if (url?.startsWith('packone://store-screenshot-feedback')) {
          router.replace('/store-screenshot-feedback');
        }
      });
      return;
    }
    if (Platform.OS !== 'ios') return;
    const scene = Settings.get('packoneScreenshotScene');
    if (typeof scene !== 'string' || !scene) return;

    if (scene === 'daily-decision') {
      router.replace({ pathname: '/draft-run', params: { environment: 'mixed' } });
    } else if (scene === 'reveal-comparison') {
      // Use the dedicated fixture-only route instead of replacing into the
      // draft-run query shape during cold startup. This avoids a transient
      // blank render observed on the 6.9-inch iPhone simulator.
      router.replace('/store-screenshot-feedback');
    } else if (scene === 'daily-hub') {
      // The app already cold-starts on the hub. Replacing / with / during the
      // initial router mount can leave a blank frame on some iPhone runtimes.
      return;
    } else if (scene === 'practice') {
      router.replace('/practice');
    } else if (scene === 'career') {
      router.replace('/career');
    } else if (scene === 'membership') {
      router.replace('/membership');
    }
  }, []);

  return null;
}

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
        <ScreenshotFixtureEntry />
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
          <Stack.Screen name="store-screenshot-feedback" options={{ title: 'Draft Run' }} />
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
          <Stack.Screen name="set-archive" options={{ title: 'Set Archive' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="account-profile" options={{ title: 'Profile & visibility' }} />
          <Stack.Screen name="membership" options={{ title: 'Membership' }} />
          <Stack.Screen name="account-security" options={{ title: 'Sign-in & security' }} />
          <Stack.Screen name="account-delete" options={{ title: 'Delete account' }} />
        </Stack>
      </>
    </VersionGate>
  );
}
