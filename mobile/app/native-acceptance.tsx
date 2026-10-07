import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { config } from '@/src/config';
import { configureScreenshotScenario } from '@/src/screenshots/fixtures';
import { screenshotSession } from '@/src/screenshots/session';
import { writeSession } from '@/src/storage/session';

/** Preview-fixture-only entry. Never available in a production build. */
export default function NativeAcceptanceScreen() {
  const params = useLocalSearchParams<{ scenario?: string; destination?: string }>();
  useEffect(() => {
    if (!config.screenshots.fixtures) return;
    let active = true;
    void (async () => {
      const scenario = typeof params.scenario === 'string' ? params.scenario : 'member';
      await configureScreenshotScenario(scenario);
      await writeSession(scenario.startsWith('guest')
        ? { playerToken: screenshotSession.playerToken, subjectId: screenshotSession.subjectId }
        : screenshotSession);
      if (!active) return;
      const screen = params.destination;
      console.info('PACKONE_SCENE', JSON.stringify({ scenario, destination: screen }));
      if (screen === 'shared') { router.replace({ pathname: '/shared-run', params: { shared: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }); return; }
      if (screen === 'feedback') router.replace('/store-screenshot-feedback');
      else if (screen === 'practice') router.dismissTo('/practice');
      else if (screen === 'learn') router.dismissTo('/learn');
      else if (screen === 'career') router.dismissTo('/career');
      else if (screen === 'leaders') router.dismissTo('/leaderboard');
      else if (screen === 'account') router.replace('/account');
      else if (screen === 'how-to') router.replace('/how-to');
      else if (screen === 'about') router.replace('/about');
      else if (screen === 'support') router.replace('/support');
      else if (screen === 'privacy') router.replace('/privacy');
      else if (screen === 'terms') router.replace('/terms');
      else router.dismissTo('/');
    })();
    return () => { active = false; };
  }, [params.scenario, params.destination]);
  if (!config.screenshots.fixtures) return <Redirect href="/" />;
  return <ActivityIndicator accessibilityLabel="Preparing controlled native acceptance fixture" />;
}
