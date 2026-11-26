import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/components/Text';
import { themedStyles } from '@/src/appearance';
import type { PastRankingPage, PastRankingPeriod, PastRankingRow } from '@/src/api/career';
import { colors, spacing } from '@/src/theme';

type PageState = { rows: PastRankingRow[]; next: string | null; loaded: boolean; error: boolean };
const empty = (): PageState => ({ rows: [], next: null, loaded: false, error: false });
const periods: { id: PastRankingPeriod; label: string }[] = [{ id: 'season', label: 'Seasons' }, { id: 'week', label: 'Weeks' }];
const formats = [{ id: 'mixed', label: 'Draft Run' }, { id: 'latest', label: 'Latest Set' }, { id: 'powered-cube', label: 'Powered Cube' }];
function dateLabel(date: string) {
  const value = new Date(date + 'T00:00:00Z');
  return Number.isNaN(value.valueOf()) ? date : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function PastRankings({ loadPage }: {
  loadPage: (period: PastRankingPeriod, before: string | null) => Promise<PastRankingPage | null>;
}) {
  const [period, setPeriod] = useState<PastRankingPeriod>('season');
  const [pages, setPages] = useState<Record<PastRankingPeriod, PageState>>({ season: empty(), week: empty() });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current += 1; busyRef.current = false; }, []);
  const page = pages[period];

  const load = async (target: PastRankingPeriod, before: string | null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++epoch.current;
    setBusy(true);
    setPages(old => ({ ...old, [target]: { ...old[target], error: false } }));
    try {
      const result = await loadPage(target, before);
      if (request !== epoch.current) return;
      if (!result) {
        setPages({ season: empty(), week: empty() });
        return;
      }
      if (result.period !== target || !Array.isArray(result.rows) || result.rows.some(row => !row || typeof row.start_date !== 'string' || typeof row.end_date !== 'string' || !Array.isArray(row.standings))) throw new Error('Invalid rankings response.');
      setPages(old => {
        const previous = before ? old[target].rows : [];
        const seen = new Set(previous.map(row => row.start_date));
        const added = result.rows.filter(row => {
          if (seen.has(row.start_date)) return false;
          seen.add(row.start_date);
          return true;
        });
        const next = result.next_before && (!before || result.next_before < before) ? result.next_before : null;
        return { ...old, [target]: { rows: [...previous, ...added], next, loaded: true, error: false } };
      });
    } catch {
      if (request === epoch.current) setPages(old => ({ ...old, [target]: { ...old[target], error: true } }));
    } finally {
      if (request === epoch.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  return <View style={styles.content}>
    <View style={styles.tabs}>
      {periods.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: period === item.id, disabled: busy }}
        disabled={busy} style={[styles.tab, period === item.id && styles.selected]} onPress={() => {
          if (busyRef.current) return;
          setPeriod(item.id);
          if (!pages[item.id].loaded) void load(item.id, null);
        }}>
        <Text style={styles.buttonText}>{item.label}</Text>
      </Pressable>)}
    </View>
    {page.rows.map(row => <View key={row.start_date} style={styles.row}>
      <Text style={styles.title}>{row.name || dateLabel(row.start_date) + ' – ' + dateLabel(row.end_date)}</Text>
      {row.name ? <Text style={styles.meta}>{dateLabel(row.start_date)} – {dateLabel(row.end_date)}</Text> : null}
      <View style={styles.tabs}>{formats.map(format => {
        const standing = row.standings.find(item => item.environment === format.id);
        const rank = standing?.rank;
        const label = rank == null ? standing?.unavailable ? 'Rank unavailable' : 'Not ranked' : '#' + rank;
        return <View key={format.id} style={styles.rank} accessible accessibilityLabel={format.label + ', ' + label}>
          <Text style={styles.title}>{rank == null ? '—' : '#' + rank}</Text>
          <Text style={styles.meta}>{format.label}</Text>
        </View>;
      })}</View>
    </View>)}
    {page.loaded && !page.rows.length && !busy ? <Text style={styles.meta}>No past {period === 'season' ? 'season' : 'weekly'} rankings yet.</Text> : null}
    {page.error ? <Text accessibilityRole="alert" style={styles.meta}>Could not load rankings.</Text> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Loading rankings…</Text> :
      !page.loaded || page.next || page.error ? <Pressable accessibilityRole="button" style={styles.more}
        onPress={() => void load(period, page.loaded ? page.next : null)}>
        <Text style={styles.buttonText}>{page.error ? 'Try again' : page.loaded ? 'View older results' : 'View rankings'}</Text>
      </Pressable> : null}
  </View>;
}

const styles = themedStyles(StyleSheet.create({
  content: { gap: spacing.sm },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  row: { gap: spacing.xs, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: spacing.sm },
  rank: { flex: 1, gap: 2, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', backgroundColor: colors.surfaceSoft },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
  more: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: colors.accentDark, fontSize: 14, fontWeight: '700' },
}));
