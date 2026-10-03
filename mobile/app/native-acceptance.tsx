import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { config } from '@/src/config';
import { configureScreenshotScenario } from '@/src/screenshots/fixtures';
import { screenshotSession } from '@/src/screenshots/session';
import { writeSession } from '@/src/storage/session';

/** Preview-fixture-only entry. Never available in a production build. */
export default function NativeAcceptanceScreen() {
  const params = useLocalSearchParams<{ scenario?: string; screen?: string }>();
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
      const screen = params.screen;
      if (screen === 'feedback') router.replace('/store-screenshot-feedback');
      else if (screen === 'practice') router.replace('/practice');
      else if (screen === 'learn') router.replace('/learn');
      else if (screen === 'career') router.replace('/career');
      else router.replace('/');
    })();
    return () => { active = false; };
  }, [params.scenario, params.screen]);
  if (!config.screenshots.fixtures) return <Redirect href="/" />;
  return <ActivityIndicator accessibilityLabel="Preparing controlled native acceptance fixture" />;
}
