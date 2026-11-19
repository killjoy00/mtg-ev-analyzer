import type { DailyEnvironment, DailyStatus, DraftRunAnswer, DraftRunState } from '@/src/api/draftRun';
import { pacificDay } from '@/src/dailyClock';

// Mirrors the Daily share text and links in share-cards.mjs and the
// completed-Daily checks in today-status.mjs. Native shares through the OS
// sheet, which already offers copying, so only the text and link are needed.
// tests/daily-share-parity.test.mjs compares these against the web modules.

const SHARE_ORIGIN = 'https://packone.pro';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const GRADE_EMOJI = { match: '🟩', strong: '🟦', good: '🟨', fair: '🟧', miss: '⬛' } as const;
type Grade = keyof typeof GRADE_EMOJI;

export function pickGrades(answers: Pick<DraftRunAnswer, 'historicalMatch' | 'score'>[]): Grade[] {
  return answers.map((a) => a.historicalMatch ? 'match' : a.score >= 85 ? 'strong' : a.score >= 60 ? 'good' : a.score >= 25 ? 'fair' : 'miss');
}

export function shareSquares(answers: Pick<DraftRunAnswer, 'historicalMatch' | 'score'>[]) {
  return pickGrades(answers).map((grade) => GRADE_EMOJI[grade]).join('');
}

export function dailyModeLabel(environment: string) {
  return environment === 'latest' ? 'Latest Set' : environment === 'powered-cube' ? 'Powered Cube' : 'Draft Run';
}

export function shareDate(day: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

// Older APIs did not send a run length (draft-run-format.mjs).
export function draftRunLength(run: Pick<DraftRunState, 'run_length' | 'complete' | 'answers'>) {
  if ([8, 10].includes(Number(run.run_length))) return Number(run.run_length);
  if (run.complete && [8, 10].includes(run.answers?.length)) return run.answers.length;
  return 10;
}

// Short result-share routes. The path itself marks a result share and the
// link carries only the sharer's date. Recipients open their own Daily.
const SHORT_SHARE_PATHS: Record<string, string> = { mixed: '/d/', 'powered-cube': '/d/c/', latest: '/d/l/' };
export function dailyShareUrl(run: Pick<DraftRunState, 'day' | 'environment'>) {
  if (!DAY.test(String(run.day ?? ''))) throw new Error('A Daily share needs its Daily date.');
  return `${SHARE_ORIGIN}${SHORT_SHARE_PATHS[run.environment] ?? SHORT_SHARE_PATHS.mixed}?d=${run.day}`;
}

type ShareRun = Pick<DraftRunState, 'day' | 'environment' | 'score' | 'answers' | 'run_length' | 'complete'>;

// Dated, and never "beat my score": a link opened tomorrow plays different picks.
export function draftRunShareText(run: ShareRun) {
  const matches = run.answers.filter((a) => a.historicalMatch).length;
  const label = dailyModeLabel(run.environment);
  const squares = shareSquares(run.answers);
  if (run.day) return `I scored ${run.score}/100 on the Pack One ${label} Daily (${shareDate(run.day)}).\n${squares}\n${matches}/${draftRunLength(run)} trophy picks matched.\nTry Pack One's Daily. No account needed:`;
  return `Pack One · ${label} · Practice\n${run.score}/100  ${squares}\n${matches}/${draftRunLength(run)} trophy picks matched. Play this run and compare.`;
}

// The day's three Dailies in one message, offered only after all three are
// finished. Rows keep a fixed order, and there are still no card names.
const DAILY_SET_ENVIRONMENTS: readonly DailyEnvironment[] = ['mixed', 'powered-cube', 'latest'];
const DAILY_RUN_ID = /^[a-f0-9-]{8,64}$/i;

// Run IDs of the two other Dailies finished on the result's day, or null when
// today's status cannot vouch for both of them.
export function dailySetRunIds(history: DailyStatus['daily_history'] | undefined, current: Pick<DraftRunState, 'day' | 'environment'>) {
  if (!Array.isArray(history) || !DAY.test(String(current.day ?? '')) || !DAILY_SET_ENVIRONMENTS.includes(current.environment as DailyEnvironment)) return null;
  const ids: string[] = [];
  for (const environment of DAILY_SET_ENVIRONMENTS) {
    if (environment === current.environment) continue;
    const row = history.find((item) => String(item?.date ?? '') === current.day && String(item?.mode ?? '') === 'draft_run'
      && String(item?.set_id ?? '') === environment && DAILY_RUN_ID.test(String(item?.run_id ?? '')));
    if (!row) return null;
    ids.push(String(row.run_id));
  }
  return ids;
}

// The three finished runs in share order, or null unless they are exactly one
// complete Daily per environment from the same day.
export function dailySetShareRuns<T extends ShareRun>(runs: T[]) {
  if (!Array.isArray(runs) || runs.length !== DAILY_SET_ENVIRONMENTS.length) return null;
  const day = String(runs[0]?.day ?? '');
  if (!DAY.test(day)) return null;
  const ordered = DAILY_SET_ENVIRONMENTS.map((environment) => runs.find((item) => item?.environment === environment));
  const valid = ordered.every((item) => item && item.day === day && item.complete === true && Number.isFinite(Number(item.score))
    && Array.isArray(item.answers) && item.answers.length === draftRunLength(item));
  return valid ? ordered as T[] : null;
}

export function dailySetShareText(runs: ShareRun[]) {
  const rows = runs.map((item) => `${dailyModeLabel(item.environment)} ${Number(item.score)} ${shareSquares(item.answers)}`);
  return `Pack One · ${shareDate(String(runs[0]?.day))}\n${rows.join('\n')}`;
}

// today-status.mjs: used only after a completed real Daily. Never infer an
// unfinished game from missing/failed status, a stale Pacific date, or a
// different player's history.
export const DAILY_NEXT_ORDER: readonly { environment: DailyEnvironment; label: string }[] = [
  { environment: 'mixed', label: 'Play Daily Draft Run' },
  { environment: 'powered-cube', label: 'Play Daily Powered Cube' },
  { environment: 'latest', label: 'Play Daily Latest Set' },
];

function completedDailyStatus(status: DailyStatus | null | undefined, completedDay: string | null, completedEnvironment: string, now = new Date()) {
  const day = pacificDay(now);
  if (completedDay !== day
    || !DAILY_NEXT_ORDER.some((item) => item.environment === completedEnvironment)
    || !Array.isArray(status?.daily_history)
    || (status.day && status.day !== day)) return null;
  const done = (environment: string) => status.daily_history.some((row) => String(row?.date ?? '') === day
    && String(row?.mode ?? '') === 'draft_run' && String(row?.set_id ?? '') === environment);
  // The result on screen is complete even if history is briefly behind.
  return DAILY_NEXT_ORDER.map((item) => ({ item, complete: item.environment === completedEnvironment || done(item.environment) }));
}

export function nextUnfinishedDaily(status: DailyStatus | null | undefined, completedDay: string | null, completedEnvironment: string, now = new Date()) {
  return completedDailyStatus(status, completedDay, completedEnvironment, now)?.find((entry) => !entry.complete)?.item ?? null;
}

export function completedAllDailies(status: DailyStatus | null | undefined, completedDay: string | null, completedEnvironment: string, now = new Date()) {
  return completedDailyStatus(status, completedDay, completedEnvironment, now)?.every((entry) => entry.complete) === true;
}
