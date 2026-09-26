import { StyleSheet, Text, View } from 'react-native';

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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
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
  if (!rows.length) return <Text style={styles.empty}>Play at least three games in an environment to qualify it here.</Text>;
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
      {rows.slice(0, 12).map((row) => (
        <View key={`${row.date}:${row.set_id}`} style={styles.dailyRow}>
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

export function ProfileOverview({ profile, publicView = false }: { profile: CareerProfile; publicView?: boolean }) {
  const { summary } = profile;
  const trend = (profile.trend || []).slice(-10);
  const played = Number(summary.environments_played || 0);
  const total = Math.max(Number(profile.environment_total || 0), played);
  const unlocked = (profile.achievements || []).filter((item) => item.unlocked).length;
  const challengeGames = Number(summary.challenge_wins || 0) + Number(summary.challenge_losses || 0) + Number(summary.challenge_ties || 0);

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{publicView ? 'PLAYER PROFILE' : 'MY PACK ONE'}</Text>
        <Text style={styles.name}>
          {profile.player.display_name}
          {profile.player.showcase_achievement ? ' ◆' : ''}
        </Text>
        <Text style={styles.body}>
          {publicView
            ? 'A public Pack One career across the Limited archive.'
            : 'Your Pack One career, progression, achievements, and competitive record.'}
        </Text>
      </View>

      <Section title="Career Snapshot">
        <View style={styles.statsGrid}>
          <Stat label="Games" value={summary.games} />
          <Stat label="Average" value={Number(summary.average_score || 0).toFixed(1)} />
          <Stat label="Best" value={summary.best_score} />
          <Stat label="Dailies" value={summary.daily_games} />
          <Stat label="Daily streak" value={summary.current_streak} />
          <Stat label="Best streak" value={summary.best_streak} />
        </View>
        {challengeGames ? (
          <Text style={styles.meta}>
            Shared-run record · {summary.challenge_wins} W · {summary.challenge_losses} L · {summary.challenge_ties} T
          </Text>
        ) : null}
      </Section>

      {profile.current_season?.standings?.length ? (
        <Section title={`${profile.current_season.name} Season · Current`}>
          <View style={styles.rows}>
            {profile.current_season.standings.map((row) => (
              <View key={row.environment} style={styles.row}>
                <Text style={styles.rowTitle}>{environmentLabel(row.environment)}</Text>
                <Text style={styles.rowValue}>#{row.rank} · {Number(row.average || 0).toFixed(1)} · {row.days} days</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Recent Performance">
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
        ) : <Text style={styles.empty}>Complete a game to start your recent-performance chart.</Text>}
      </Section>

      <Section title="Best Environments">
        <EnvironmentRows rows={profile.best_environments || []} />
      </Section>

      <Section title="Achievements">
        <Text style={styles.meta}>{unlocked} / {(profile.achievements || []).length} unlocked</Text>
        <AchievementRows rows={profile.achievements || []} showcase={profile.player.showcase_achievement} />
      </Section>

      <Section title="Daily History">
        <DailyRows rows={profile.daily_history || []} />
      </Section>

      <Section title="Archive Progress">
        <Text style={styles.archiveNumber}>{played} / {total || 0}</Text>
        <Text style={styles.body}>Pack One environments played.</Text>
        {total > 0 ? (
          <View style={styles.archiveTrack}>
            <View style={[styles.archiveFill, { width: `${Math.min(100, Math.round((played / total) * 100))}%` as `${number}%` }]} />
          </View>
        ) : null}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  hero: { gap: spacing.xs },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  name: { color: colors.ink, fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
});
