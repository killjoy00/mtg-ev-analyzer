import { router, type ErrorBoundaryProps } from 'expo-router';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, spacing } from '@/src/theme';

export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <Text style={styles.eyebrow}>PACK ONE</Text>
        <Text style={styles.title}>This screen hit a problem.</Text>
        <Text style={styles.body}>
          Your saved Pack One account and server-authoritative game state are unchanged. You can retry this screen or return home.
        </Text>

        {__DEV__ ? (
          <View style={styles.detail}>
            <Text style={styles.detailLabel}>DEVELOPMENT DETAIL</Text>
            <Text style={styles.detailText}>{error.message}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void retry()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Return home</Text>
          </Pressable>
        </View>
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
  detail: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  detailLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  detailText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  actions: { gap: spacing.sm },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { color: colors.accentDark, fontSize: 15, fontWeight: '800' },
});
