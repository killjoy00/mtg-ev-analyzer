import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme';

export default function HistoricalChallengeScreen() {
  const params = useLocalSearchParams<{ challenge?: string }>();
  const challenge = typeof params.challenge === 'string' && /^[a-f0-9]{12}$/.test(params.challenge)
    ? params.challenge
    : '';

  const open = async () => {
    if (!challenge) return;
    await WebBrowser.openBrowserAsync(
      `https://packone.pro/?challenge=${encodeURIComponent(challenge)}`,
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.eyebrow}>HISTORICAL PACK ONE LINK</Text>
        <Text style={styles.title}>This challenge uses the retired web format.</Text>
        <Text style={styles.body}>
          Older 12-character challenge links belong to Pack One&apos;s historical Full Pack / Top 3 reader.
          They are preserved on packone.pro instead of being converted into a different eight-pick Draft Run.
        </Text>
        {challenge ? (
          <Pressable accessibilityRole="button" onPress={() => void open()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open historical challenge on packone.pro</Text>
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
