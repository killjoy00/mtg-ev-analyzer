import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Linking, Platform, Settings, } from 'react-native';

import { AppleSubscriptionSync } from '@/src/components/AppleSubscriptionSync';
import { ReminderPushBridge } from '@/src/components/ReminderPushBridge';
import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { VersionGate } from '@/src/components/VersionGate';
import { config } from '@/src/config';
import { BrandFonts } from '@/src/components/BrandFonts';
import { NavigationSessionProvider } from '@/src/navigation/session';

import { themeColor, useAppTheme } from '@/src/appearance';

function ScreenshotFixtureEntry() {
  useEffect(() => {
    // Native AdMob verification has intentionally disabled screenshot fixtures.
    // The fixture-only deep-link handler below cannot route this preview probe.
    // Select the isolated screen deterministically before opening a backend UI.
    if (Platform.OS === 'android' && process.env.EXPO_PUBLIC_PACKONE_AD_PROBE === '1') {
      const enabled = config.environment === 'preview' && !config.screenshots.fixtures
        && config.adMob.testBanners && config.adMob.androidEnabled;
      console.info('PACKONE_ANDROID_AD_PROBE_BOOT', JSON.stringify({
        preview: config.environment === 'preview',
        screenshotFixtures: config.screenshots.fixtures,
        testBanners: config.adMob.testBanners,
        androidAdsEnabled: config.adMob.androidEnabled,
        bannerConfigured: Boolean(config.adMob.androidBannerUnitId),
        routeEnabled: enabled,
      }));
      // Wait for native linking initialization before overriding its default
      // home route, as the screenshot-fixture entry does for other scenes.
      if (enabled) {
        void Linking.getInitialURL().then(() => router.replace('/android-admob-acceptance'));
      }
      return;
    }
    if (!config.screenshots.fixtures) return;
    if (Platform.OS === 'android') {
      void Linking.getInitialURL().then((url) => {
        if (url?.startsWith('packone://native-acceptance')) {
          const query = new URL(url).searchParams;
          router.replace({ pathname: '/native-acceptance', params: { scenario: query.get('scenario') || 'member', destination: query.get('destination') || 'home', screenshot: query.get('screenshot') || '' } });
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
      router.replace({ pathname: '/native-acceptance', params: { scenario: scenario || 'member', destination: screen || 'home' } });
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
    } else if (scene === 'leaderboard') {
      router.replace('/leaderboard');
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
  const appearance = useAppTheme();
  return (
    <BrandFonts><VersionGate><NavigationSessionProvider>
      <>
        <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
        <ScreenshotFixtureEntry />
        <AppleSubscriptionSync />
        <ReminderPushBridge />
        <Stack
          unstable_screenErrorBoundary={ScreenErrorBoundary}
          screenOptions={{
            headerStyle: { backgroundColor: themeColor('surface') },
            headerShadowVisible: false,
            headerTintColor: themeColor('ink'),
            headerBackTitle: 'Back',
            headerBackButtonDisplayMode: 'generic',
            contentStyle: { backgroundColor: themeColor('page') },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Daily' }} />
          <Stack.Screen name="draft-run" options={({ route }) => {
            const { environment, mode, setIds } = (route.params ?? {}) as {
              environment?: unknown; mode?: unknown; setIds?: unknown;
            };
            if (mode === 'practice') {
              const custom = typeof setIds === 'string'
                && setIds.split(',').some(id => /^[-a-z0-9]{2,40}$/.test(id.trim().toLowerCase()));
              return { title: custom ? 'Custom Set Practice'
                : environment === 'powered-cube' ? 'Powered Cube Practice' : 'Draft Run Practice' };
            }
            return { title: environment === 'powered-cube' ? 'Powered Cube'
              : environment === 'latest' ? 'Latest Set' : 'Draft Run' };
          }} />
          <Stack.Screen name="native-acceptance" options={{ headerShown: false }} />
          <Stack.Screen name="android-admob-acceptance" options={{ headerShown: false }} />
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
          <Stack.Screen name="insights" options={{ title: 'My Pack One' }} />
          <Stack.Screen name="account" options={{ title: 'Settings' }} />
          <Stack.Screen name="account-profile" options={{ title: 'Profile & visibility' }} />
          <Stack.Screen name="account-reminders" options={{ title: 'Emails & reminders' }} />
          <Stack.Screen name="account-appearance" options={{ title: 'Appearance' }} />
          <Stack.Screen name="account-privacy" options={{ title: 'Privacy & results' }} />
          <Stack.Screen name="about" options={{ title: 'About' }} />
          <Stack.Screen name="support" options={{ title: 'Support & contact' }} />
          <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
          <Stack.Screen name="terms" options={{ title: 'Terms' }} />
          <Stack.Screen name="membership" options={{ title: 'Membership' }} />
          <Stack.Screen name="account-security" options={{ title: 'Sign-in & security' }} />
          <Stack.Screen name="account-delete" options={{ title: 'Delete account' }} />
        </Stack>
      </>
    </NavigationSessionProvider></VersionGate></BrandFonts>
  );
}
