import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';

import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';

import { colors, spacing } from '@/src/theme';

export default function HistoricalChallengeScreen() {
  const params = useLocalSearchParams<{ challenge?: string }>();
  const challenge = typeof params.challenge === 'string' && /^[a-f0-9]{12}$/.test(params.challenge)
    ? params.challenge
    : '';

  const open = async () => {
    if (!challenge) return;
    await WebBrowser.openBrowserAsync(
      'https://packone.pro/?game=draft-run&daily=1',
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.eyebrow}>HISTORICAL PACK ONE LINK</Text>
        <Text style={styles.title}>This game mode has been retired.</Text>
        <Text style={styles.body}>
          Full Pack and Top 3 are no longer available. You can play today&apos;s Daily instead.
        </Text>
        {challenge ? (
          <Pressable accessibilityRole="button" onPress={() => void open()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Play the Daily on packone.pro</Text>
          </Pressable>
        ) : (
          <Text accessibilityRole="alert" style={styles.error}>This historical challenge link is invalid.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 720,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 35, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  primaryButton: {
    minHeight: 50,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
