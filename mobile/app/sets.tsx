import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { loadSetCatalog, type SetCatalog, type SetCatalogEntry } from '@/src/api/catalog';
import { colors, spacing } from '@/src/theme';

type State =
  | { status: 'loading' }
  | { status: 'ready'; catalog: SetCatalog }
  | { status: 'error'; message: string };

function formatNumber(value: number) {
  return value.toLocaleString();
}

function dateLabel(value?: string | null) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'Date not recorded';
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function cohortLabel(entry: SetCatalogEntry) {
  if (entry.win_rate_cutoff) return `${Math.round(entry.win_rate_cutoff * 100)}%+ source win rate`;
  return 'Experienced Arena-rank source cohort';
}

function SetCard({
  entry,
  latest = false,
}: {
  entry: SetCatalogEntry;
  latest?: boolean;
}) {
  const environment = entry.set_id === 'powered-cube'
    ? 'powered-cube'
    : latest ? 'latest' : entry.regular_run ? 'mixed' : null;
  const action = environment === 'powered-cube'
    ? 'Play Cube Daily →'
    : environment === 'latest' ? 'Play Latest Set Daily →' : 'Play Draft Run Daily →';

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>DATA THROUGH {dateLabel(entry.data_date).toUpperCase()}</Text>
      <Text style={styles.cardTitle}>{entry.set_name || entry.set_id.toUpperCase()}</Text>
      <Text style={styles.body}>
        {formatNumber(entry.verified_decisions)} verified first-pack decisions · {formatNumber(entry.qualified_trophy_drafts)} qualified Premier trophy drafts.
      </Text>
      <Text style={styles.body}>
        {cohortLabel(entry)}{entry.training_drafts ? ` · ${formatNumber(entry.training_drafts)} training drafts` : ''}.
      </Text>
      {environment ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/draft-run', params: { environment } })}
          style={styles.cardAction}
        >
          <Text style={styles.cardActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SetsScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', catalog: await loadSetCatalog() });
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Current serving coverage could not be loaded.',
      });
    }
  };

  useEffect(() => {
    let active = true;
    void loadSetCatalog()
      .then((catalog) => {
        if (active) setState({ status: 'ready', catalog });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Current serving coverage could not be loaded.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.body}>Loading current serving coverage…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Couldn&apos;t load the set archive.</Text>
          <Text style={styles.body}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const standard = state.catalog.sets
    .filter((entry) => entry.regular_run)
    .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')) || a.set_id.localeCompare(b.set_id));
  const special = state.catalog.sets
    .filter((entry) => !entry.regular_run)
    .sort((a, b) => String(b.data_date || '').localeCompare(String(a.data_date || '')) || a.set_id.localeCompare(b.set_id));
  const latest = standard.at(0);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>SET ARCHIVE</Text>
          <Text style={styles.title}>Every set in Pack One.</Text>
          <Text style={styles.deck}>
            Live Draft Run coverage, qualified trophy sources, verified first-pack decisions, and training cohorts—read from the serving corpus.
          </Text>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{standard.length}</Text>
            <Text style={styles.summaryLabel}>standard sets</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue} numberOfLines={2}>{latest?.set_name || latest?.set_id.toUpperCase() || '—'}</Text>
            <Text style={styles.summaryLabel}>latest environment</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{dateLabel(latest?.data_date)}</Text>
            <Text style={styles.summaryLabel}>latest data date</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.kicker}>LIVE DRAFT RUN ARCHIVE</Text>
            <Text style={styles.sectionTitle}>Supported sets</Text>
          </View>
          {standard.length ? standard.map((entry) => (
            <SetCard key={entry.set_id} entry={entry} latest={entry.set_id === latest?.set_id} />
          )) : (
            <Text style={styles.body}>The serving catalog did not contain any playable regular sets.</Text>
          )}
        </View>

        {special.length ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.kicker}>SEPARATE ENVIRONMENT</Text>
              <Text style={styles.sectionTitle}>Special formats</Text>
            </View>
            {special.map((entry) => <SetCard key={entry.set_id} entry={entry} />)}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  hero: { gap: spacing.sm },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8, textAlign: 'left' },
  deck: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryValue: { color: colors.ink, fontSize: 18, lineHeight: 22, fontWeight: '800' },
  summaryLabel: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  section: { gap: spacing.md },
  sectionHeader: { gap: spacing.xs },
  sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  cardAction: { paddingTop: spacing.xs },
  cardActionText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  primaryButton: {
    minHeight: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
