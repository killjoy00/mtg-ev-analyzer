import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { config } from '@/src/config';
import { colors, spacing } from '@/src/theme';

type AdsSdk = typeof import('react-native-google-mobile-ads');

/**
 * No advertising SDK work starts until the server has established ad eligibility
 * (or the player is a guest). The parent unmounts this on a session change.
 */
export function AdMobDailyBanner({ eligible }: { eligible: boolean }) {
  const enabled = Platform?.OS === 'ios' ? config.adMob?.iosEnabled : config.adMob?.androidEnabled;
  const unitId = Platform?.OS === 'ios' ? config.adMob?.iosBannerUnitId : config.adMob?.androidBannerUnitId;
  const [sdk, setSdk] = useState<AdsSdk | null>(null);
  const [privacyRequired, setPrivacyRequired] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // The Home screen unmounts this slot on any loss of ad eligibility.
    // State only changes in asynchronous UMP/SDK callbacks.
    if (!eligible || !enabled || !unitId || config.screenshots?.fixtures) return () => { active = false; };
    void (async () => {
      try {
        const ads = await import('react-native-google-mobile-ads');
        if (!active) return;
        // UMP refreshes the consent state on entry and presents a required form.
        const consent = await ads.AdsConsent.gatherConsent();
        if (!active) return;
        setPrivacyRequired(consent.privacyOptionsRequirementStatus === 'REQUIRED');
        if (!consent.canRequestAds) return;
        // Google's bundled iOS manifest declares tracked Device ID. Only
        // initialize the advertising SDK after Apple's ATT authorization.
        // ATT controls the advertising identifier, not whether eligible players
        // can see a non-personalized ad. Google's iOS SDK omits IDFA when ATT is
        // denied/restricted. Resolve the permission before initializing the SDK;
        // never bypass the separate UMP consent or membership checks.
        if (Platform.OS === 'ios') {
          const tracking = await import('expo-tracking-transparency');
          if (!active) return;
          let permission = await tracking.getTrackingPermissionsAsync();
          if (!active) return;
          if (permission.status === tracking.PermissionStatus.UNDETERMINED) {
            permission = await tracking.requestTrackingPermissionsAsync();
          }
          if (!active) return;
          // Denied/restricted ATT must not suppress a consent-eligible banner.
          // BannerAd always requests non-personalized inventory below.
        }
        // Keep the first release contextual, without requesting personalized ads.
        await ads.default().setRequestConfiguration({ maxAdContentRating: ads.MaxAdContentRating.G });
        if (!active) return;
        await ads.default().initialize();
        if (active) setSdk(ads);
      } catch {
        // Consent, network and native SDK errors must never block the Daily.
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [eligible, enabled, unitId]);

  const privacyChoices = async () => {
    if (!sdk) return;
    setSdk(null);
    try {
      await sdk.AdsConsent.showPrivacyOptionsForm();
      const status = await sdk.AdsConsent.getConsentInfo();
      setPrivacyRequired(status.privacyOptionsRequirementStatus === 'REQUIRED');
      if (eligible && enabled && status.canRequestAds) setSdk(sdk);
    } catch {
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
        onAdFailedToLoad={() => setFailed(true)}
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
