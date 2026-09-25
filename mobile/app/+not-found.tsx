import { router } from 'expo-router';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/src/theme';

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.eyebrow}>PACK ONE</Text>
        <Text style={styles.title}>That link doesn&apos;t match a Pack One screen.</Text>
        <Text style={styles.body}>
          It may be an old or incomplete link. Return home to choose a Daily, practice run, leaderboard, or guide.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Return home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
