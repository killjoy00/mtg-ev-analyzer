// A local-only, privacy-preserving rating gate. Never offer a custom rating UI.
// iOS decides whether to actually display StoreKit's standard in-app prompt.
type RatingHistory = {
  runs: { id: string; day: string }[];
  lastRequestedVersion?: string;
  lastRequestedAt?: number;
};
const KEY = 'packone.mobile.rating.v1';
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
function parse(value: string | null): RatingHistory {
  if (!value) return { runs: [] };
  try {
    const raw = JSON.parse(value) as Partial<RatingHistory>;
    if (!Array.isArray(raw.runs)) return { runs: [] };
    return {
      runs: raw.runs.filter((item) => item && typeof item.id === 'string' && typeof item.day === 'string').slice(-30),
      lastRequestedVersion: typeof raw.lastRequestedVersion === 'string' ? raw.lastRequestedVersion : undefined,
      lastRequestedAt: typeof raw.lastRequestedAt === 'number' && Number.isFinite(raw.lastRequestedAt) ? raw.lastRequestedAt : undefined,
    };
  } catch { return { runs: [] }; }
}
export function planRatingPrompt(previous: string | null, id: string, day: string, version: string, now: number) {
  const state = parse(previous);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !id || !version || !Number.isFinite(now)) return { state, shouldRequest: false };
  const runs = state.runs.some((entry) => entry.id === id) ? state.runs : [...state.runs, { id, day }].slice(-30);
  const distinctDays = new Set(runs.map((entry) => entry.day)).size;
  const shouldRequest = runs.length >= 3 && distinctDays >= 3
    && state.lastRequestedVersion !== version
    && (state.lastRequestedAt === undefined || now - state.lastRequestedAt >= COOLDOWN_MS);
  return { state: { ...state, runs }, shouldRequest };
}
export async function maybeRequestPackOneRating(id: string, day: string): Promise<void> {
  try {
    // Delay module loads until the end of a genuine iOS result. Mounted tests and
    // screenshot fixtures must not initialize native StoreKit.
    const { Platform } = await import('react-native');
    if (Platform.OS !== 'ios') return;
    const { config } = await import('@/src/config');
    if (config.screenshots.fixtures) return;
    const App = await import('expo-application');
    const version = App.nativeApplicationVersion;
    if (!version) return;
    const SecureStore = await import('expo-secure-store');
    const previous = await SecureStore.getItemAsync(KEY);
    const now = Date.now();
    const planned = planRatingPrompt(previous, id, day, version, now);
    await SecureStore.setItemAsync(KEY, JSON.stringify(planned.state));
    if (!planned.shouldRequest) return;
    const StoreReview = await import('expo-store-review');
    if (!(await StoreReview.isAvailableAsync())) return;
    // Persist before the request: StoreKit may decide not to display, but do
    // not retry on every result screen or repeatedly interrupt the player.
    await SecureStore.setItemAsync(KEY, JSON.stringify({
      ...planned.state, lastRequestedVersion: version, lastRequestedAt: now,
    }));
    await StoreReview.requestReview();
  } catch {
    // Rating requests must never block gameplay, navigation or result reviews.
  }
}
