import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/src/components/Text';
import { config } from '@/src/config';
import { colors, spacing } from '@/src/theme';

/** A UMP privacy-options entry point on the Account screen, including for guests. */
export function AdMobPrivacyChoices() {
  const enabled = Platform?.OS === 'ios' ? config.adMob?.iosEnabled : config.adMob?.androidEnabled;
  const [required, setRequired] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!enabled || config.screenshots?.fixtures) return;
    let active = true;
    void (async () => {
      try {
        const { AdsConsent } = await import('react-native-google-mobile-ads');
        if (!active) return;
        // UMP says not to infer this status from an old stored consent value.
        const info = await AdsConsent.requestInfoUpdate();
        if (active) setRequired(info.privacyOptionsRequirementStatus === 'REQUIRED');
      } catch { /* Do not show a broken entry point. */ }
    })();
    return () => { active = false; };
  }, [enabled]);

  const open = async () => {
    setMessage('');
    try {
      const { AdsConsent } = await import('react-native-google-mobile-ads');
      await AdsConsent.showPrivacyOptionsForm();
      const info = await AdsConsent.getConsentInfo();
      setRequired(info.privacyOptionsRequirementStatus === 'REQUIRED');
    } catch { setMessage('Could not open ad privacy choices. Please try again.'); }
  };
  if (!enabled || !required || config.screenshots?.fixtures) return null;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Ad privacy choices"
      style={styles.button} onPress={() => void open()}>
      <Text style={styles.link}>Ad privacy choices</Text>
    </Pressable>
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
  </>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, justifyContent: 'center', paddingVertical: spacing.sm },
  link: { color: colors.accentDark, fontSize: 15, textDecorationLine: 'underline' },
  message: { color: colors.danger, fontSize: 13 },
});
