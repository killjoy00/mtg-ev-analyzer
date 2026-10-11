import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { ScreenArea as SafeAreaView } from '@/src/components/ScreenArea';
import { AboutLink } from '@/src/components/AboutLink';
import { loadMobileInsights, type DraftInsights, type InsightGroup, type InsightsEnvironment, type InsightsPeriod } from '@/src/api/insights';
import { ApiError } from '@/src/api/client';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

const environments: { value: InsightsEnvironment; label: string }[] = [
  { value: 'mixed', label: 'Mixed' }, { value: 'latest', label: 'Latest Set' }, { value: 'powered-cube', label: 'Powered Cube' },
];
const periods: { value: InsightsPeriod; label: string }[] = [
  { value: 'all', label: 'All available' }, { value: '90d', label: 'Last 90 days' }, { value: '365d', label: 'Last year' },
];
const identity = (session: MobileSession | null) => session
  ? JSON.stringify([session.playerToken, session.accountToken ?? '', session.subjectId ?? '', session.accountUser?.id ?? '']) : '';
const score = (value: number | null) => value === null ? '—' : Number(value).toFixed(1);
const num = (value: number) => Number(value || 0).toLocaleString();

function ChoiceRow<T extends string>({ name, values, selected, onChange }: {
  name: string; values: { value: T; label: string }[]; selected: T; onChange: (value: T) => void;
}) {
  return <View style={styles.choiceGroup}>
    <Text style={styles.controlLabel}>{name}</Text>
    <View style={styles.choices}>
      {values.map(item => <Pressable key={item.value} accessibilityRole="button"
        accessibilityLabel={name + ': ' + item.label} accessibilityState={{ selected: selected === item.value }}
        onPress={() => onChange(item.value)}
        style={[styles.choice, selected === item.value && styles.choiceActive]}>
        <Text style={[styles.choiceText, selected === item.value && styles.choiceTextActive]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    {children}
  </View>;
}

function Metrics({ rows }: { rows: (InsightGroup & { label: string })[] }) {
  if (!rows.length) return <Text style={styles.caption}>No eligible decisions in this group yet.</Text>;
  return <View style={styles.metricList}>{rows.map((row, index) => <View key={row.label + index} style={styles.metric}>
    <View style={styles.metricHead}>
      <Text style={styles.metricName}>{row.label}</Text>
      <Text style={styles.metricScore}>{row.average_score === null ? 'Need 5 picks' : score(row.average_score) + ' / 100'}</Text>
    </View>
    <View accessibilityLabel={row.label + ', ' + row.count + ' decisions, ' +
      (row.average_score === null ? 'not enough to average' : score(row.average_score) + ' average points')}
      style={styles.track}>
      <View style={[styles.trackFill, { width: (Math.max(0, Math.min(100, Number(row.average_score ?? 0))) + '%') as '100%' }]} />
    </View>
    <Text style={styles.meta}>{num(row.count)} decisions</Text>
  </View>)}</View>;
}

function InsightSections({ data }: { data: DraftInsights }) {
  if (!data.unlocked) return <Section title="Unlock your Drafting Insights">
    <Text style={styles.body}>Play a few more runs in {data.environment_label}. You have {num(data.eligible_decisions)} of {data.unlock_at} eligible first-time decisions in this period.</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/')} style={styles.primaryButton}>
      <Text style={styles.primaryText}>Play today&apos;s Daily</Text>
    </Pressable>
  </Section>;

  const monthly = data.months || [];
  return <>
    <Section title="Your patterns" caption="Conservative observations from comparable decision groups">
      {data.observations.length ? data.observations.map(row =>
        <View key={row.id} style={styles.observation}><Text style={styles.observationMark}>◆</Text><Text style={styles.observationCopy}>{row.text}</Text></View>)
        : <Text style={styles.caption}>Not enough comparable decisions yet. Observations need 40 picks per group and a 10-point gap.</Text>}
    </Section>
    <Section title="Pick-by-pick strengths" caption="Actual source P1P positions, not game-round order. Five decisions are needed for each average.">
      <Metrics rows={data.pick_depth.map(row => ({ ...row, label: row.label }))} />
    </Section>
    <Section title="Difficulty context" caption="These bands contain different puzzles; no difficulty-adjusted skill grade is inferred.">
      <Metrics rows={data.difficulty.map(row => ({ ...row, label: row.band.charAt(0).toUpperCase() + row.band.slice(1) }))} />
      {data.unknown_difficulty ? <Text style={styles.meta}>{num(data.unknown_difficulty)} decisions lack a verified difficulty band.</Text> : null}
    </Section>
    <Section title="Progress over time" caption="Two consecutive 40-pick windows in the selected environment">
      {data.progress ? <>
        <View style={styles.windowRow}>
          <View style={styles.window}><Text style={styles.meta}>Previous 40 picks</Text><Text style={styles.bigScore}>{score(data.progress.previous.average_score)}</Text>
            <Text style={styles.meta}>{data.progress.previous.from} to {data.progress.previous.to}</Text></View>
          <View style={styles.window}><Text style={styles.meta}>Latest 40 picks</Text><Text style={styles.bigScore}>{score(data.progress.recent.average_score)}</Text>
            <Text style={styles.meta}>{data.progress.recent.from} to {data.progress.recent.to}</Text></View>
        </View>
        <Text style={styles.caption}>Recorded difference: {data.progress.delta > 0 ? '+' : ''}{score(data.progress.delta)} points. Different picks cannot prove improvement or decline.</Text>
      </> : <Text style={styles.caption}>This comparison needs 80 eligible decisions (40 in each window). You have {num(data.eligible_decisions)}.</Text>}
      <Text style={styles.subheading}>Pacific calendar months</Text>
      {monthly.length ? <View style={styles.months}>{monthly.map(row => <View key={row.month} style={styles.month}>
        <Text style={styles.meta}>{row.month}</Text><Text style={styles.monthScore}>{score(row.average_score)}</Text>
        <Text style={styles.meta}>{num(row.count)} picks{row.average_score === null ? ' · need 10' : ''}</Text>
      </View>)}</View> : <Text style={styles.caption}>Monthly averages need at least 10 eligible decisions per Pacific month.</Text>}
    </Section>
    <Section title="Format patterns" caption="Card pools differ between formats; these are recorded scores, not skill rankings.">
      <View style={styles.formats}>{data.formats.map(row => <View key={row.environment}
        style={[styles.format, row.environment === data.environment && styles.formatSelected]}>
        <Text style={styles.formatName}>{row.label}</Text><Text style={styles.bigScore}>{score(row.average_score)}</Text>
        <Text style={styles.meta}>{num(row.count)} eligible picks{row.average_score === null ? ' · need 5' : ''}</Text>
      </View>)}</View>
    </Section>
  </>;
}

export default function InsightsScreen() {
  const [environment, setEnvironment] = useState<InsightsEnvironment>('mixed');
  const [period, setPeriod] = useState<InsightsPeriod>('all');
  const [data, setData] = useState<DraftInsights | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const requestId = useRef(0);
  const activeOwner = useRef('');

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setData(null);
    setProblem(null);
    setPhase('loading');
    let session: MobileSession | null = null;
    try {
      session = await ensureGuestSession();
      if (id !== requestId.current) return;
      if (!session.accountToken) { activeOwner.current = ''; setPhase('signed-out'); return; }
      const owner = identity(session);
      if (activeOwner.current !== owner) { activeOwner.current = owner; setData(null); }
      const response = await loadMobileInsights(session, environment, period);
      const current = await readSession();
      if (id !== requestId.current) return;
      if (!current?.accountToken || identity(current) !== owner) {
        activeOwner.current = ''; setData(null); setPhase('signed-out'); return;
      }
      setData(response);
      setPhase('ready');
    } catch (error: unknown) {
      if (id !== requestId.current) return;
      setData(null);
      if (error instanceof ApiError && [401, 403, 410].includes(error.status)) {
        activeOwner.current = ''; setPhase('signed-out');
      } else {
        setProblem(error instanceof Error ? error.message : 'Insights are unavailable.'); setPhase('error');
      }
    }
  }, [environment, period]);

  useEffect(() => subscribeSession(next => {
    const current = next?.accountToken ? identity(next) : '';
    if (current === activeOwner.current) return;
    requestId.current += 1;
    activeOwner.current = current;
    setData(null);
    setPhase(current ? 'loading' : 'signed-out');
    if (current) void load();
  }), [load]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));
  useAppResume(() => load());

  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: 'My Pack One' }} />
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>MY PACK ONE</Text>
      <View accessibilityLabel="My Pack One sections" style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }}
          onPress={() => router.dismissTo('/career')} style={styles.tab}><Text style={styles.tabText}>Stats</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: true }}
          style={[styles.tab, styles.tabSelected]}><Text style={[styles.tabText, styles.tabTextSelected]}>Insights</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }}
          onPress={() => router.push('/account')} style={styles.tab}><Text style={styles.tabText}>Account settings</Text></Pressable>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>Your Drafting Insights</Text>
      <Text style={styles.intro}>Explore how your real draft decisions vary by pick, format and difficulty.</Text>
      <View style={styles.filters}>
        <ChoiceRow name="Environment" values={environments} selected={environment} onChange={setEnvironment} />
        <ChoiceRow name="Time period" values={periods} selected={period} onChange={setPeriod} />
      </View>
      {phase === 'loading' ? <View style={styles.notice}><ActivityIndicator accessibilityLabel="Loading Insights" /><Text style={styles.body}>Loading your private drafting decisions…</Text></View> : null}
      {phase === 'signed-out' ? <Section title="Sign in to see your Insights">
        <Text style={styles.body}>Your private analysis requires a linked Pack One account.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.primaryButton}><Text style={styles.primaryText}>Sign in</Text></Pressable>
      </Section> : null}
      {phase === 'error' ? <Section title="Insights unavailable">
        <Text accessibilityRole="alert" style={styles.body}>{problem || 'Please retry.'} Your other My Pack One sections are still available.</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry Insights</Text></Pressable>
      </Section> : null}
      {phase === 'ready' && data ? <>
        <Text style={styles.summary}>{num(data.eligible_decisions)} eligible decisions · {data.environment_label} · {periods.find(p => p.value === period)?.label}</Text>
        <InsightSections data={data} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How these insights are calculated</Text>
          <Text style={styles.caption}>{data.methodology}</Text>
        </View>
      </> : null}
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Insights</Text></Pressable>
      <AboutLink />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  page: { width: '100%', maxWidth: 980, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  eyebrow: { color: colors.accent, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  heading: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: -12 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line },
  tab: { minWidth: 0, flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  tabSelected: { borderBottomWidth: 3, borderColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  tabTextSelected: { color: colors.ink },
  filters: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.md },
  choiceGroup: { gap: spacing.xs },
  controlLabel: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', paddingHorizontal: spacing.md },
  choiceActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  choiceTextActive: { color: colors.accentDark },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  caption: { fontSize: 13, lineHeight: 19, color: colors.muted },
  body: { fontSize: 14, lineHeight: 21, color: colors.ink },
  summary: { fontSize: 13, fontWeight: '800', color: colors.accentDark },
  notice: { minHeight: 140, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  metricList: { gap: spacing.md },
  metric: { gap: spacing.xs },
  metricHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'baseline' },
  metricName: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.ink },
  metricScore: { fontSize: 12, color: colors.accentDark, fontWeight: '800' },
  track: { width: '100%', height: 11, backgroundColor: colors.surfaceSoft },
  trackFill: { height: '100%', backgroundColor: colors.accent },
  meta: { fontSize: 11, color: colors.muted, lineHeight: 17 },
  observation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  observationMark: { color: colors.accent, fontSize: 13 },
  observationCopy: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 21 },
  windowRow: { flexDirection: 'row', gap: spacing.sm },
  window: { flex: 1, padding: spacing.md, backgroundColor: colors.surfaceSoft, gap: spacing.xs },
  bigScore: { fontSize: 30, fontWeight: '800', color: colors.ink },
  subheading: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: spacing.sm },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  month: { minWidth: 105, flexGrow: 1, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surfaceSoft },
  monthScore: { fontSize: 22, fontWeight: '800', color: colors.ink },
  formats: { gap: spacing.sm },
  format: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, gap: spacing.xs },
  formatSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  formatName: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  primaryButton: { minHeight: 48, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  primaryText: { color: colors.surface, fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.accentDark, fontSize: 14, fontWeight: '800' },
});
