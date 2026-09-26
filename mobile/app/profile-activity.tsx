import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { loadMobileCareer } from '@/src/api/career';
import { loadProfileArchive, loadProfileCoverage } from '@/src/api/profileArchive';
import { loadPublicProfile } from '@/src/api/publicProfile';
import { useAppResume } from '@/src/hooks/useAppResume';
import { activityScope, achievementProgress, archiveProgress, dailyKey, dailyStanding, environmentName, filterArchive } from '@/src/state/profileActivity';
import type { ActivityScope, ActivityTab, ActivityTarget, ArchiveFilter } from '@/src/state/profileActivity';
import { createProfileActivityController, initialProfileActivity } from '@/src/state/profileActivityController';
import { readSession, subscribeSession } from '@/src/storage/session';
import { colors, spacing } from '@/src/theme';

const tabs: { id: ActivityTab; label: string }[] = [
  { id: 'archive', label: 'Archive' }, { id: 'achievements', label: 'Achievements' }, { id: 'daily', label: 'Daily finishes' },
];

function ActivityRecord({ scope, initialTab }: { scope: ActivityScope; initialTab: ActivityTab }) {
  const [tab, setTab] = useState<ActivityTab>(initialTab);
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [state, setState] = useState(initialProfileActivity);
  const attemptedCatalog = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width >= 760 && fontScale <= 1.3;
  const [controller] = useState(() => createProfileActivityController(scope, {
    readSession, loadPrivate: loadMobileCareer, loadPublic: loadPublicProfile,
    loadArchive: loadProfileArchive, loadCoverage: loadProfileCoverage,
    share: (message, anchor) => Share.share({ message }, anchor === undefined ? undefined : { anchor }), changed: setState,
  }));

  useEffect(() => {
    const unsubscribe = scope.kind === 'private' ? subscribeSession(controller.sessionChanged) : () => {};
    return () => { unsubscribe(); controller.dispose(); };
  }, [controller, scope.kind]);
  useFocusEffect(useCallback(() => {
    controller.resume();
    return () => controller.pause();
  }, [controller]));
  useAppResume(controller.refresh);
  useEffect(() => {
    if (tab === 'archive' && state.phase === 'ready' && !attemptedCatalog.current) {
      attemptedCatalog.current = true;
      void controller.catalog();
    }
  }, [controller, state.phase, tab]);

  const shareActivity = (target: ActivityTarget, event?: GestureResponderEvent) => {
    const anchor = event?.nativeEvent?.target;
    void controller.share(target, typeof anchor === 'number' ? anchor : undefined);
  };
  const disabled = state.refreshing || state.sharing;
  const profile = state.profile;
  if (state.phase !== 'ready' || !profile) return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ title: 'Profile activity' }} />
      <View style={styles.center}>
        {state.phase === 'loading' ? <><ActivityIndicator accessibilityLabel="Loading profile activity" /><Text style={styles.body}>Loading profile activity...</Text></>
          : state.phase === 'guest' ? <>
            <Text style={styles.title}>Sign in to see your activity.</Text>
            <Text style={styles.body}>Your private archive, achievements and Daily finishes belong to your signed-in account.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.button}>
              <Text style={styles.buttonText}>Sign in</Text>
            </Pressable>
          </> : <>
            <Text style={styles.title}>Activity unavailable</Text><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
          </>}
        {state.phase !== 'loading' ? <Pressable accessibilityRole="button" onPress={() => void controller.refresh()} style={styles.button}>
          <Text style={styles.buttonText}>Retry activity</Text>
        </Pressable> : null}
      </View>
    </SafeAreaView>
  );

  const archive = state.archive === null ? null : archiveProgress(state.archive, profile);
  const visible = archive === null ? [] : filterArchive(archive, filter, search);
  const unlocked = profile.achievements.filter((item) => item.unlocked).length;
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ title: 'Profile activity' }} />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>{scope.kind === 'public' ? 'PUBLIC PLAYER ACTIVITY' : 'MY PACK ONE'}</Text>
        <Text style={styles.title}>{profile.player.display_name}</Text>
        <View style={styles.actions}>
          {tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: item.id === tab }}
            onPress={() => setTab(item.id)} style={[styles.button, tab === item.id && styles.selected]}>
            <Text style={styles.buttonText}>{item.label}</Text>
          </Pressable>)}
        </View>
        {state.refreshing ? <ActivityIndicator accessibilityLabel="Refreshing activity" /> : null}
        {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void controller.refresh()} style={styles.button}>
          <Text style={styles.buttonText}>Refresh activity</Text>
        </Pressable>

        {tab === 'archive' ? <>
          <Text style={styles.heading}>Archive progress</Text>
          <Text style={styles.body}>Published archive environments, including those not currently in live serving coverage. An unplayed environment is not an access grant.</Text>
          {state.catalogBusy ? <ActivityIndicator accessibilityLabel="Loading archive catalog" /> : null}
          {state.catalogError ? <Text accessibilityRole="alert" style={styles.error}>{state.catalogError}</Text> : null}
          {archive === null ? <Text style={styles.body}>The archive catalog is not available. Progress cannot be determined from live sets alone.</Text> : <>
            <Text accessibilityLabel="Published archive progress" style={styles.heading}>{archive.filter((entry) => entry.played).length} / {archive.length} environments played</Text>
            <TextInput accessibilityLabel="Search archive environments" placeholder="Search by set name or code" value={search} onChangeText={setSearch} style={styles.search} />
            <View style={styles.actions}>
              {(['all', 'played', 'unplayed'] as const).map((item) => <Pressable key={item} accessibilityRole="button"
                accessibilityLabel={`Show ${item} environments`} accessibilityState={{ selected: filter === item }}
                onPress={() => setFilter(item)} style={[styles.button, filter === item && styles.selected]}>
                <Text style={styles.buttonText}>{item[0]!.toUpperCase() + item.slice(1)}</Text>
              </Pressable>)}
            </View>
            <Text style={styles.meta}>{visible.length} matching environments</Text>
            <View style={styles.archiveGrid}>
              {visible.map((entry) => {
                const live = state.coverage?.sets.find((item) => item.set_id === entry.id);
                const record = entry.record;
                return <View key={entry.id} style={[styles.panel, { width: twoColumns ? '48.5%' : '100%' }]}>
                  <Text style={styles.meta}>{entry.played ? 'Played' : 'Unplayed'}{entry.cube ? ' · Special environment' : ''}{entry.favorite ? ' · Favorite' : ''}</Text>
                  <Text style={styles.heading}>{entry.name}</Text>
                  {record && entry.played ? <>
                    <Text style={styles.body}>{record.games} games · {record.average_score.toFixed(1)} average · {record.best_score} best</Text>
                    {record.daily_games != null ? <Text style={styles.meta}>{record.daily_games} Daily games</Text> : null}
                    {record.last_played_at ? <Text style={styles.meta}>Last played {record.last_played_at}</Text> : null}
                  </> : <Text style={styles.body}>No recorded games in this archive environment.</Text>}
                  <Pressable accessibilityRole="button" accessibilityLabel={`View ${entry.name} set details`}
                    accessibilityState={{ expanded: expanded === entry.id }} onPress={() => setExpanded((previous) => previous === entry.id ? null : entry.id)} style={styles.button}>
                    <Text style={styles.buttonText}>{expanded === entry.id ? 'Hide set details' : 'View set details'}</Text>
                  </Pressable>
                  {expanded === entry.id ? <View style={styles.details}>
                    <Text style={styles.body}>Archive code: {entry.id.toUpperCase()}{entry.dataDate ? ` · archive data through ${entry.dataDate}` : ''}</Text>
                    {state.coverage === null ? <Text style={styles.body}>Live coverage has not been verified. Retry the catalog to check it.</Text> : live ? <>
                      <Text style={styles.body}>Live coverage: {live.set_name || entry.name}</Text>
                      <Text style={styles.body}>{live.verified_decisions.toLocaleString()} verified decisions · {live.qualified_trophy_drafts.toLocaleString()} qualified trophy drafts</Text>
                      <Text style={styles.body}>{live.training_drafts.toLocaleString()} training drafts{live.data_date ? ` · data through ${live.data_date}` : ''}</Text>
                      <Text style={styles.meta}>Serving corpus: {state.coverage.corpus_version}</Text>
                    </> : <Text style={styles.body}>Not present in the current live serving catalog. Historical progress is retained.</Text>}
                  </View> : null}
                </View>;
              })}
            </View>
            {!visible.length ? <Text style={styles.body}>No environments match these filters.</Text> : null}
          </>}
          {state.coverageError ? <Text accessibilityRole="alert" style={styles.error}>Live coverage: {state.coverageError}</Text> : null}
          <Pressable accessibilityRole="button" disabled={state.catalogBusy} onPress={() => void controller.catalog()} style={styles.button}>
            <Text style={styles.buttonText}>Refresh archive catalog</Text>
          </Pressable>
        </> : tab === 'achievements' ? <>
          <Text style={styles.heading}>Achievements · {unlocked} / {profile.achievements.length} unlocked</Text>
          {profile.achievements.map((item) => {
            const progress = achievementProgress(item);
            return <View key={item.id} style={styles.panel}>
              <Text style={styles.heading}>{item.label}</Text>
              <Text style={styles.body}>{item.unlocked ? 'Unlocked' : 'In progress'}{item.unlocked && item.id === profile.player.showcase_achievement ? ' · Showcased' : ''}</Text>
              {item.description ? <Text style={styles.body}>{item.description}</Text> : null}
              {item.progress_text ? <Text style={styles.meta}>{item.progress_text}</Text> : null}
              {progress !== null ? <View accessibilityRole="progressbar" accessibilityLabel={`${item.label} progress`}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }} style={styles.track}>
                <View style={[styles.fill, { width: `${progress}%` as `${number}%` }]} />
              </View> : null}
              {item.earned_at ? <Text style={styles.meta}>Earned {item.earned_at}</Text> : null}
              {item.unlocked ? <Pressable accessibilityRole="button" accessibilityLabel={`Share achievement ${item.label}`} disabled={disabled}
                onPress={(event) => shareActivity({ kind: 'achievement', id: item.id }, event)} style={styles.button}>
                <Text style={styles.buttonText}>Share achievement</Text>
              </Pressable> : null}
            </View>;
          })}
          {!profile.achievements.length ? <Text style={styles.body}>No achievements were returned for this record.</Text> : null}
        </> : <>
          <Text style={styles.heading}>Daily finishes</Text>
          <Text style={styles.body}>All {profile.daily_history.length} finishes returned by the server. Shared history includes its date and Live/Final status; it does not start or replay an old Daily.</Text>
          {profile.daily_history.map((row) => <View key={dailyKey(row)} style={styles.panel}>
            <Text style={styles.heading}>{environmentName(row.set_id)} · {row.date}</Text>
            <Text style={styles.body}>{row.score}/100{row.grade ? ` · ${row.grade}` : ''} · {row.mode}</Text>
            <Text style={styles.meta}>{dailyStanding(row)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Share ${row.set_id} Daily finish ${row.date} ${row.mode}`} disabled={disabled}
              onPress={(event) => shareActivity({ kind: 'daily', date: row.date, set: row.set_id, mode: row.mode }, event)} style={styles.button}>
              <Text style={styles.buttonText}>Share Daily finish</Text>
            </Pressable>
          </View>)}
          {!profile.daily_history.length ? <Text style={styles.body}>No ranked Daily finishes yet.</Text> : null}
        </>}
        {state.sharing ? <ActivityIndicator accessibilityLabel="Verifying record before sharing" /> : null}
        {state.shareError ? <Text accessibilityRole="alert" style={styles.error}>{state.shareError}</Text> : null}
        {state.shareText ? <View style={styles.panel}><Text style={styles.meta}>Verified share text. Select to copy when the share sheet is unavailable.</Text>
          <Text selectable accessibilityLabel="Verified activity share text" style={styles.body}>{state.shareText}</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function ProfileActivityScreen() {
  const params = useLocalSearchParams<{ profileKey?: string | string[]; tab?: string | string[] }>();
  let scope: ActivityScope;
  try { scope = activityScope(params.profileKey); }
  catch { return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.title}>Activity unavailable</Text><Text style={styles.body}>This public profile link is invalid.</Text></View></SafeAreaView>; }
  const tab = tabs.find((item) => item.id === params.tab)?.id ?? 'archive';
  return <ActivityRecord key={`${scope.kind}:${scope.kind === 'public' ? scope.key : ''}:${tab}`} scope={scope} initialTab={tab} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  center: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.ink, fontSize: 30, lineHeight: 37, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 19, lineHeight: 26, fontWeight: '800' },
  body: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, padding: spacing.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  selected: { backgroundColor: colors.surfaceSoft },
  search: { borderWidth: 1, borderColor: colors.lineStrong, color: colors.ink, backgroundColor: colors.surface, padding: spacing.md, minHeight: 48, fontSize: 16 },
  archiveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm },
  details: { gap: spacing.sm, paddingTop: spacing.sm },
  track: { height: 8, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
