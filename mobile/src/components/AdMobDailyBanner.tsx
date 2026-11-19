import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { config } from '@/src/config';
import { colors, spacing } from '@/src/theme';

type AdsSdk = typeof import('react-native-google-mobile-ads');

export type AdDiagnostic = {
  stage: 'starting' | 'consent-checking' | 'consent-ready' | 'consent-blocked' | 'consent-error'
    | 'tracking-checked' | 'tracking-error' | 'sdk-initializing' | 'sdk-error'
    | 'banner-requested' | 'banner-loaded' | 'banner-no-fill' | 'banner-error';
  consent?: 'permitted' | 'reused' | 'blocked';
  tracking?: 'granted' | 'denied' | 'restricted' | 'unavailable';
  code?: string;
};

/** Allow only short SDK error codes; never reveal messages, IDs or consent strings. */
function safeAdErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = String(error.code ?? '');
  return /^(?:[a-z][a-z0-9_-]*\/)?[a-z0-9_-]{1,60}$/i.test(code) ? code : 'unknown';
}

/**
 * No advertising SDK work starts until the server has established ad eligibility
 * (or the player is a guest). The parent unmounts this on a session change.
 */
export function AdMobDailyBanner({ eligible, onStatus }: { eligible: boolean; onStatus?: (event: AdDiagnostic) => void }) {
  const enabled = Platform?.OS === 'ios' ? config.adMob?.iosEnabled : config.adMob?.androidEnabled;
  const unitId = Platform?.OS === 'ios' ? config.adMob?.iosBannerUnitId : config.adMob?.androidBannerUnitId;
  const [sdk, setSdk] = useState<AdsSdk | null>(null);
  const [privacyRequired, setPrivacyRequired] = useState(false);
  const [failed, setFailed] = useState(false);
  const report = useCallback((event: AdDiagnostic) => onStatus?.(event), [onStatus]);

  useEffect(() => {
    let active = true;
    // The Home screen unmounts this slot on any loss of ad eligibility.
    // State only changes in asynchronous UMP/SDK callbacks.
    if (!eligible || !enabled || !unitId || config.screenshots?.fixtures) return () => { active = false; };
    report({ stage: 'consent-checking' });
    void (async () => {
      let failureStage: AdDiagnostic['stage'] = 'consent-error';
      try {
        const ads = await import('react-native-google-mobile-ads');
        if (!active) return;

        // UMP refreshes consent and shows required forms. Google allows an
        // existing permitted state to be reused after a failed refresh.
        // Never request ads unless UMP explicitly reports canRequestAds=true.
        let consent: { canRequestAds: boolean; privacyOptionsRequirementStatus?: string } | null = null;
        let reused = false;
        try {
          const updated = await ads.AdsConsent.gatherConsent();
          consent = { canRequestAds: updated.canRequestAds, privacyOptionsRequirementStatus: updated.privacyOptionsRequirementStatus };
        } catch {
          reused = true;
          try {
            const previous = await ads.AdsConsent.getConsentInfo();
            consent = { canRequestAds: previous.canRequestAds, privacyOptionsRequirementStatus: previous.privacyOptionsRequirementStatus };
          } catch {
            if (active) report({ stage: 'consent-error', code: 'unavailable' });
            return;
          }
        }
        if (!active) return;
        setPrivacyRequired(consent.privacyOptionsRequirementStatus === 'REQUIRED');
        if (!consent.canRequestAds) {
          report({ stage: reused ? 'consent-error' : 'consent-blocked', consent: 'blocked' });
          return;
        }
        report({ stage: 'consent-ready', consent: reused ? 'reused' : 'permitted' });

        // ATT determines access to IDFA, independently of UMP. Denial must
        // not block an otherwise consented, non-personalized ad request.
        failureStage = 'tracking-error';
        if (Platform.OS === 'ios') {
          const tracking = await import('expo-tracking-transparency');
          if (!active) return;
          const permission = await tracking.getTrackingPermissionsAsync();
          if (!active) return;
          const decision = permission.status === tracking.PermissionStatus.UNDETERMINED
            ? await tracking.requestTrackingPermissionsAsync()
            : permission;
          if (!active) return;
          const value = String(decision.status);
          report({ stage: 'tracking-checked', tracking: value === 'granted' || value === 'denied' || value === 'restricted'
            ? value : 'unavailable' });
        }

        failureStage = 'sdk-error';
        report({ stage: 'sdk-initializing' });
        await ads.default().setRequestConfiguration({ maxAdContentRating: ads.MaxAdContentRating.G });
        if (!active) return;
        await ads.default().initialize();
        if (active) {
          report({ stage: 'banner-requested' });
          setSdk(ads);
        }
      } catch (error: unknown) {
        // Never block the Daily or expose raw SDK errors.
        if (active) {
          report({ stage: failureStage, code: safeAdErrorCode(error) });
          setFailed(true);
        }
      }
    })();
    return () => { active = false; };
  }, [eligible, enabled, unitId, report]);

  const privacyChoices = async () => {
    if (!sdk) return;
    setSdk(null);
    try {
      await sdk.AdsConsent.showPrivacyOptionsForm();
      const status = await sdk.AdsConsent.getConsentInfo();
      setPrivacyRequired(status.privacyOptionsRequirementStatus === 'REQUIRED');
      if (eligible && enabled && status.canRequestAds) {
        report({ stage: 'banner-requested', consent: 'permitted' });
        setSdk(sdk);
      } else report({ stage: 'consent-blocked', consent: 'blocked' });
    } catch {
      report({ stage: 'consent-error', code: 'unavailable' });
      setFailed(true);
    }
  };

  if (!eligible || !enabled || !unitId || (!sdk && !privacyRequired) || failed) return null;
  const Banner = sdk?.BannerAd;
  return <View style={styles.slot} accessibilityLabel="Advertisement">
    {Banner ? <>
      <Text style={styles.label}>Advertisement</Text>
      <Banner
        unitId={unitId}
        size={sdk!.BannerAdSize.BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => report({ stage: 'banner-loaded' })}
        onAdFailedToLoad={(error) => {
          const code = safeAdErrorCode(error);
          report({ stage: /no[-_]?fill/i.test(code) ? 'banner-no-fill' : 'banner-error', code });
          setFailed(true);
        }}
      />
    </> : null}
    {privacyRequired && sdk ? <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ad privacy choices"
      onPress={() => void privacyChoices()}
      style={styles.privacyButton}
    ><Text style={styles.privacyText}>Ad privacy choices</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  label: { color: colors.muted, fontSize: 12 },
  privacyButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  privacyText: { color: colors.accentDark, fontSize: 13, textDecorationLine: 'underline' },
});
