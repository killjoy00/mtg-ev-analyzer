import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Linking, Platform, Settings, } from 'react-native';

import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { VersionGate } from '@/src/components/VersionGate';
import { config } from '@/src/config';
import { BrandFonts } from '@/src/components/BrandFonts';
import { NavigationSessionProvider } from '@/src/navigation/session';

import { colors } from '@/src/theme';

function ScreenshotFixtureEntry() {
  useEffect(() => {
    if (!config.screenshots.fixtures) return;
    if (Platform.OS === 'android') {
      void Linking.getInitialURL().then((url) => {
        if (url?.startsWith('packone://native-acceptance')) {
          const query = new URL(url).searchParams;
          router.replace({ pathname: '/native-acceptance', params: { scenario: query.get('scenario') || 'member', screen: query.get('screen') || 'home' } });
        } else if (url?.startsWith('packone://store-screenshot-feedback')) {
          router.replace('/store-screenshot-feedback');
        }
      });
      return;
    }
    if (Platform.OS !== 'ios') return;
    const scene = Settings.get('packoneScreenshotScene');
    if (typeof scene !== 'string' || !scene) return;

    if (scene.startsWith('acceptance:')) {
      const [, scenario, screen] = scene.split(':');
      router.replace({ pathname: '/native-acceptance', params: { scenario: scenario || 'member', screen: screen || 'home' } });
    } else if (scene === 'daily-decision') {
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

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  return (
    <BrandFonts><VersionGate><NavigationSessionProvider>
      <>
        <StatusBar style="dark" />
        <ScreenshotFixtureEntry />
        <Stack
          unstable_screenErrorBoundary={ScreenErrorBoundary}
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerShadowVisible: false,
            headerTintColor: colors.ink,
            headerBackTitle: 'Back',
            headerBackButtonDisplayMode: 'generic',
            contentStyle: { backgroundColor: colors.page },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Daily' }} />
          <Stack.Screen name="draft-run" options={{ title: 'Draft Run' }} />
          <Stack.Screen name="native-acceptance" options={{ headerShown: false }} />
          <Stack.Screen name="store-screenshot-feedback" options={{ title: 'Draft Run' }} />
          <Stack.Screen name="shared-run" options={{ title: 'Shared Draft Run' }} />
          <Stack.Screen name="resume-shared-run" options={{ title: 'Saved Shared Run' }} />
          <Stack.Screen name="profile" options={{ title: 'Player Profile' }} />
          <Stack.Screen name="historical-challenge" options={{ title: 'Historical Challenge' }} />
          <Stack.Screen name="how-to" options={{ title: 'How to Play' }} />
          <Stack.Screen name="scoring" options={{ title: 'Scoring' }} />
          <Stack.Screen name="method" options={{ title: 'Method' }} />
          <Stack.Screen name="sets" options={{ title: 'Sets' }} />
          <Stack.Screen name="set-archive" options={{ title: 'Set Archive' }} />
          <Stack.Screen name="account" options={{ title: 'Account settings' }} />
          <Stack.Screen name="account-profile" options={{ title: 'Profile & visibility' }} />
          <Stack.Screen name="help" options={{ title: 'Help & information' }} />
          <Stack.Screen name="membership" options={{ title: 'Membership' }} />
          <Stack.Screen name="account-security" options={{ title: 'Sign-in & security' }} />
          <Stack.Screen name="account-delete" options={{ title: 'Delete account' }} />
        </Stack>
      </>
    </NavigationSessionProvider></VersionGate></BrandFonts>
  );
}
