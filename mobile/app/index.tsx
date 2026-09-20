import { router } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DAILY_ENVIRONMENT_META, type DailyEnvironment } from '@/src/api/draftRun';
import { colors, spacing } from '@/src/theme';

const dailies: { environment: DailyEnvironment; action: string }[] = [
  { environment: 'mixed', action: 'Start Draft Run →' },
  { environment: 'powered-cube', action: 'Play Powered Cube →' },
  { environment: 'latest', action: 'Play Latest Set →' },
];

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

        <View style={styles.dailySection}>
          <Text style={styles.sectionLabel}>PLAY TODAY</Text>
          {dailies.map(({ environment, action }, index) => {
            const meta = DAILY_ENVIRONMENT_META[environment];
            return (
              <Pressable
                key={environment}
                accessibilityRole="button"
                accessibilityLabel={`Play ${meta.title} Daily`}
                onPress={() => router.push({ pathname: '/draft-run', params: { environment } })}
                style={({ pressed }) => [
                  index === 0 ? styles.primaryCard : styles.dailyCard,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.cardKicker}>{meta.eyebrow}</Text>
                <Text style={index === 0 ? styles.cardTitle : styles.dailyTitle}>{meta.title}</Text>
                <Text style={styles.cardBody}>{meta.description}</Text>
                <Text style={styles.cardAction}>{action}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open leaderboard"
          onPress={() => router.push('/leaderboard')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>RANKINGS</Text>
          <Text style={styles.utilityTitle}>Leaderboard</Text>
          <Text style={styles.cardBody}>Compare ranked Daily scores across Draft Run, Powered Cube, and Latest Set.</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/account')}
          style={({ pressed }) => [styles.utilityCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardKicker}>ACCOUNT</Text>
          <Text style={styles.utilityTitle}>Sign in or create an account</Text>
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
  dailySection: { gap: spacing.md },
  sectionLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  primaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.line,
    borderTopColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dailyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.78 },
  cardKicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  dailyTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  cardBody: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  cardAction: { color: colors.accentDark, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  utilityCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  utilityTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  note: { borderTopWidth: 1, borderColor: colors.line, paddingTop: spacing.lg, gap: spacing.xs },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  noteBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});
