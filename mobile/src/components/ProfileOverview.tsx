import { themedStyles } from '@/src/appearance';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';

import {
  type CareerProfile,
  type DailyHistoryRow,
  type ProfileAchievement,
  type ProfileEnvironment,
} from '@/src/api/career';
import { DAILY_ENVIRONMENT_META, isDailyEnvironment } from '@/src/api/draftRun';
import { colors, spacing } from '@/src/theme';

function environmentLabel(value: string) {
  return isDailyEnvironment(value) ? DAILY_ENVIRONMENT_META[value].title : value.toUpperCase();
}

function shortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Stat({ label, value, half = false }: { label: string; value: string | number; half?: boolean }) {
  return (
    <View style={[styles.stat, half && styles.statHalf]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function EnvironmentRows({ rows }: { rows: ProfileEnvironment[] }) {
  if (!rows.length) return <Text style={styles.empty}>Play at least three games in a set or format.</Text>;
  return (
    <View style={styles.rows}>
      {rows.slice(0, 5).map((row, index) => (
        <View key={row.set_id} style={styles.row}>
          <Text style={styles.rank}>{index + 1}</Text>
          <Text style={styles.rowTitle}>{environmentLabel(row.set_id)}</Text>
          <Text style={styles.rowValue}>{Number(row.average_score || 0).toFixed(1)} avg</Text>
        </View>
      ))}
    </View>
  );
}

function AchievementRows({ rows, showcase }: { rows: ProfileAchievement[]; showcase?: string | null }) {
  if (!rows.length) return <Text style={styles.empty}>Achievements appear here as you play.</Text>;
  return (
    <View style={styles.achievementGrid}>
      {rows.map((item) => (
        <View key={item.id} style={[styles.achievement, !item.unlocked && styles.achievementLocked]}>
          <Text style={styles.achievementMark}>{item.unlocked ? '◆' : '◇'}</Text>
          <View style={styles.achievementCopy}>
            <Text style={styles.achievementTitle}>
              {item.label}{showcase === item.id ? ' · SHOWCASED' : ''}
            </Text>
            {item.description ? <Text style={styles.achievementBody}>{item.description}</Text> : null}
            <Text style={styles.achievementProgress}>{item.progress_text || (item.unlocked ? 'Unlocked' : 'In progress')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DailyRows({ rows }: { rows: DailyHistoryRow[] }) {
  if (!rows.length) return <Text style={styles.empty}>No ranked Daily finishes yet.</Text>;
  return (
    <View style={styles.rows}>
      {rows.slice(0, 5).map((row) => (
        <View key={`${row.date}:${row.set_id}:${row.mode}`} style={styles.dailyRow}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{environmentLabel(row.set_id)} · {row.date}</Text>
            <Text style={styles.rowMeta}>
              {row.final ? 'Final' : 'Live'}{row.percentile ? ` · Top ${row.percentile}%` : ''} · #{row.rank} of {row.total}
            </Text>
          </View>
          <Text style={styles.dailyScore}>{row.score}</Text>
        </View>
      ))}
    </View>
  );
}

export function ProfileOverview({ profile, publicView = false, pastRankings }: { profile: CareerProfile; publicView?: boolean; pastRankings?: React.ReactNode }) {
  const publicKey = profile.player.profile_key;
  const canExplore = !publicView || (profile.player.profile_public === true && typeof publicKey === 'string' && /^[a-f0-9]{16}$/.test(publicKey));
  const activityLink = (tab: 'archive' | 'achievements' | 'daily', label: string) => canExplore ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/profile-activity', params: { tab, ...(publicView ? { profileKey: publicKey! } : {}) } })}
      style={styles.activityButton}>
      <Text style={styles.activityButtonText}>{label}</Text>
    </Pressable>
  ) : null;
  const { summary } = profile;
  const trend = (profile.trend || []).slice(-10);
  const played = Number(summary.environments_played || 0);
  const total = Math.max(Number(profile.environment_total || 0), played);
  const unlocked = (profile.achievements || []).filter((item) => item.unlocked).length;
  const dailyCount = Math.min(12, (profile.daily_history || []).length);
  const challengeGames = Number(summary.challenge_wins || 0) + Number(summary.challenge_losses || 0) + Number(summary.challenge_ties || 0);

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{publicView ? 'PLAYER PROFILE' : 'MY PACK ONE'}</Text>
        <Text style={styles.name}>
          {profile.player.display_name}
          {profile.player.showcase_achievement ? ' ◆' : ''}
        </Text>
        {publicView ? <Text style={styles.body}>A public Pack One career across the Limited archive.</Text> : null}
      </View>

      <Section title="Your record">
        <View style={styles.statsGrid}>
          <Stat label="Games" value={summary.games} half={!publicView} />
          <Stat label="Average" value={Number(summary.average_score || 0).toFixed(1)} half={!publicView} />
          <Stat label="Best" value={summary.best_score} half={!publicView} />
          {publicView ? <Stat label="Dailies" value={summary.daily_games} /> : null}
          <Stat label="Daily streak" value={summary.current_streak} half={!publicView} />
          {publicView ? <Stat label="Best streak" value={summary.best_streak} /> : null}
        </View>
        {publicView && challengeGames ? (
          <>
            <Text style={styles.meta}>
              Shared challenges played · {Number(summary.challenge_wins || 0)} beaten · {Number(summary.challenge_losses || 0)} below target · {Number(summary.challenge_ties || 0)} tied
            </Text>
            <Text style={styles.meta}>Results from playing other people’s shared runs.</Text>
          </>
        ) : null}
      </Section>

      {profile.current_season?.standings?.length ? (
        <Section title={`${profile.current_season.name} Season · Current`}>
          <View style={styles.rows}>
            {profile.current_season.standings.map((row) => (
              <View key={row.environment} style={styles.row}>
                <Text style={styles.rowTitle}>{environmentLabel(row.environment)}</Text>
                <Text style={styles.rowValue}>#{row.rank} · {row.rating == null ? Number(row.average || 0).toFixed(1) : `${row.rating.toFixed(1)} rating · ${Number(row.average_score).toFixed(1)} avg`} · {row.days} days</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Recent scores">
        {trend.length ? (
          <View style={styles.performance}>
            {trend.map((row, index) => {
              const score = Math.max(0, Math.min(100, Number(row.score || 0)));
              return (
                <View key={`${row.played_at}:${index}`} style={styles.performanceRow}>
                  <Text style={styles.performanceDate}>{shortDate(row.played_at)}</Text>
                  <View style={styles.performanceTrack}>
                    <View style={[styles.performanceFill, { width: `${score}%` as `${number}%` }]} />
                  </View>
                  <Text style={styles.performanceScore}>{score}</Text>
                </View>
              );
            })}
          </View>
        ) : <Text style={styles.empty}>Play a game to see your recent scores here.</Text>}
      </Section>

      <Section title="Best sets">
        <EnvironmentRows rows={profile.best_environments || []} />
      </Section>

      {!publicView && pastRankings ? <Section title="Past rankings">{pastRankings}</Section> : null}

      <Section title="Achievements">
        <Text style={styles.meta}>{unlocked} / {(profile.achievements || []).length} unlocked</Text>
        <AchievementRows rows={profile.achievements || []} showcase={profile.player.showcase_achievement} />
        {activityLink('achievements', 'Browse achievements and sharing')}
      </Section>

      <Section title="Daily finishes">
        <DailyRows rows={profile.daily_history || []} />
        {dailyCount > 0 ? activityLink('daily', dailyCount > 5 ? 'View last ' + dailyCount + ' Daily finishes' : 'View Daily details') : null}
      </Section>

      {!publicView ? <Section title="Career details">
        <View style={styles.rows}>
          <View style={styles.row}><Text style={styles.rowTitle}>Dailies played</Text><Text style={styles.rowValue}>{Number(summary.daily_games || 0).toLocaleString()}</Text></View>
          <View style={styles.row}><Text style={styles.rowTitle}>Longest daily streak</Text><Text style={styles.rowValue}>{Number(summary.best_streak || 0).toLocaleString()} {summary.best_streak === 1 ? 'day' : 'days'}</Text></View>
          <View style={styles.row}><Text style={styles.rowTitle}>Shared challenges played</Text><Text style={styles.rowValue}>{challengeGames.toLocaleString()}</Text></View>
          <View style={styles.row}><Text style={styles.rowTitle}>Sets played</Text><Text style={styles.rowValue}>{played} / {total || 0}</Text></View>
        </View>
        {activityLink('archive', 'See all sets')}
        {challengeGames ? (
          <View style={styles.statsGrid}>
            <Stat label="Beaten" value={Number(summary.challenge_wins || 0)} />
            <Stat label="Below target" value={Number(summary.challenge_losses || 0)} />
            <Stat label="Tied" value={Number(summary.challenge_ties || 0)} />
          </View>
        ) : <Text style={styles.empty}>No shared challenges played yet.</Text>}
      </Section> : <Section title="Sets played">
        <Text style={styles.archiveNumber}>{played} / {total || 0}</Text>
        {activityLink('archive', 'See all sets')}
        {total > 0 ? (
          <View style={styles.archiveTrack}>
            <View style={[styles.archiveFill, { width: `${Math.min(100, Math.round((played / total) * 100))}%` as `${number}%` }]} />
          </View>
        ) : null}
      </Section>}
    </View>
  );
}

const styles = themedStyles(StyleSheet.create({
  root: { gap: spacing.md },
  activityButton: { minHeight: 48, borderWidth: 1, borderColor: colors.accent, padding: spacing.md, justifyContent: 'center', alignItems: 'center' },
  activityButtonText: { color: colors.accentDark, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  hero: { gap: spacing.xs },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  name: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Your record shows four numbers as a two-by-two grid; public profiles keep three across.
  statHalf: { width: '47%' },
  stat: {
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    backgroundColor: colors.surfaceSoft,
    padding: spacing.md,
    gap: 2,
  },
  statValue: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  rows: { gap: spacing.xs },
  row: {
    minHeight: 44,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rank: { width: 24, color: colors.accentDark, fontSize: 14, fontWeight: '800' },
  rowTitle: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
  rowValue: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  rowMeta: { color: colors.muted, fontSize: 12 },
  rowCopy: { flex: 1, gap: 2 },
  dailyRow: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  dailyScore: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  performance: { gap: spacing.sm },
  performanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  performanceDate: { width: 48, color: colors.muted, fontSize: 11, fontWeight: '700' },
  performanceTrack: { flex: 1, height: 8, backgroundColor: colors.line, overflow: 'hidden' },
  performanceFill: { height: '100%', backgroundColor: colors.accent },
  performanceScore: { width: 32, textAlign: 'right', color: colors.ink, fontSize: 12, fontWeight: '800' },
  achievementGrid: { gap: spacing.sm },
  achievement: {
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  achievementLocked: { opacity: 0.62 },
  achievementMark: { width: 22, color: colors.accentDark, fontSize: 16, fontWeight: '800' },
  achievementCopy: { flex: 1, gap: 3 },
  achievementTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  achievementBody: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  achievementProgress: { color: colors.accentDark, fontSize: 11, fontWeight: '800' },
  archiveNumber: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  archiveTrack: { height: 8, backgroundColor: colors.line, overflow: 'hidden' },
  archiveFill: { height: '100%', backgroundColor: colors.accent },
  empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
}));
