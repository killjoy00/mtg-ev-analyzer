import { Redirect, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AdMobDailyBanner, type AdDiagnostic } from '@/src/components/AdMobDailyBanner';
import { ScreenArea } from '@/src/components/ScreenArea';
import { Text } from '@/src/components/Text';
import { config } from '@/src/config';
import { colors, spacing } from '@/src/theme';

/**
 * A preview-only native ad/insets probe. Google-provided demo IDs are required.
 * No account, live Pack One backend, production ad unit, or publishing path.
 */
export default function AndroidAdMobAcceptance() {
  const [stage, setStage] = useState<AdDiagnostic['stage']>('starting');
  const onAdStatus = useCallback((event: AdDiagnostic) => {
    setStage(event.stage);
    // Stage names and sanitized error codes only. No identifiers/consent strings.
    console.info('PACKONE_ANDROID_AD_TEST', JSON.stringify({
      stage: event.stage,
      ...(event.code ? { code: event.code } : {}),
    }));
  }, []);
  if (Platform.OS !== 'android' || process.env.EXPO_PUBLIC_PACKONE_AD_PROBE !== '1' ||
      config.environment !== 'preview' || config.screenshots.fixtures ||
      !config.adMob.testBanners || !config.adMob.androidEnabled ||
      config.adMob.androidBannerUnitId !== 'ca-app-pub-3940256099942544/6300978111') {
    return <Redirect href="/" />;
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ScreenArea style={styles.safe}>
      <View style={styles.page}>
        <Text accessibilityLabel="Edge-to-edge test title" style={styles.title}>
          Android native ad and safe-area check
        </Text>
        <Text style={styles.body}>Preview-only Google test banner. Never a live Pack One ad unit.</Text>
        <AdMobDailyBanner eligible onStatus={onAdStatus} />
        <Text accessibilityLabel="Ad diagnostic stage" style={styles.status}>Ad status: {stage}</Text>
        <View style={styles.space} />
        <Text accessibilityLabel="Bottom safe-area marker" style={styles.footer}>
          Bottom safe-area marker
        </Text>
      </View>
    </ScreenArea>
  </>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  body: { fontSize: 14, color: colors.muted, marginTop: spacing.sm },
  status: { fontSize: 14, color: colors.ink, marginTop: spacing.md },
  space: { flex: 1 },
  footer: { fontSize: 14, color: colors.ink, textAlign: 'center', paddingVertical: spacing.sm },
});
