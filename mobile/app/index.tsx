import { router } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/src/theme';

function Brand() {
  return (
    <View style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>P¹</Text>
      </View>
      <View>
        <Text style={styles.brandName}>Pack One</Text>
        <Text style={styles.brandSub}>DRAFT DECISION LAB</Text>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Brand />
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>NATIVE FOUNDATION</Text>
          <Text style={styles.title}>Make the pick. See what strong drafters did.</Text>
          <Text style={styles.lede}>
            Pack One mobile uses the same gameplay, scoring, account, and leaderboard authority as packone.pro.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/draft-run')}
          style={({ pressed }) => [styles.primaryCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>PLAY TODAY</Text>
          <Text style={styles.cardTitle}>Draft Run</Text>
          <Text style={styles.cardBody}>
            Play the full eight-pick Daily against Pack One&apos;s production scoring authority.
          </Text>
          <Text style={styles.cardAction}>Start Draft Run →</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/account')}
          style={({ pressed }) => [styles.accountCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>ACCOUNT</Text>
          <Text style={styles.accountTitle}>Sign in or create an account</Text>
          <Text style={styles.cardBody}>Use the same Pack One identity and career across web and mobile.</Text>
        </Pressable>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>One product, not a fork</Text>
          <Text style={styles.noteBody}>
            Native clients will share Pack One&apos;s server-authoritative game state and scoring. No production credentials or database access live in the app.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  brandMarkText: { color: colors.accentDark, fontSize: 18, fontWeight: '800' },
  brandName: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  brandSub: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 2 },
  hero: { gap: spacing.sm, paddingTop: spacing.lg },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 42, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2 },
  lede: { color: colors.muted, fontSize: 17, lineHeight: 26, maxWidth: 560 },
  primaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.78 },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  cardAction: { color: colors.accentDark, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  accountCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  accountTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  note: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  noteBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});
