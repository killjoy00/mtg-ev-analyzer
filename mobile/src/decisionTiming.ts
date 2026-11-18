// Measure only time spent looking at one selectable Draft Run decision.
// Foreground intervals survive a brief background/refocus, but a new pack
// starts with a fresh clock. Network round trips and reveal screens are paused.
export function createForegroundDecisionTimer(now: () => number = () => performance.now()) {
  let key: string | null = null;
  let elapsed = 0;
  let started: number | null = null;
  const pause = () => {
    if (started !== null) {
      elapsed += Math.max(0, now() - started);
      started = null;
    }
  };
  return {
    sync(nextKey: string | null, visible: boolean) {
      if (nextKey !== key) {
        pause();
        key = nextKey;
        elapsed = 0;
      }
      if (!key || !visible) pause();
      else if (started === null) started = now();
    },
    sample(decisionKey: string): number | null {
      if (!key || key !== decisionKey) return null;
      const ms = elapsed + (started === null ? 0 : Math.max(0, now() - started));
      return Number.isFinite(ms) && ms >= 0 && ms <= 1_800_000 ? Math.round(ms) : null;
    },
    clear() {
      pause();
      key = null;
      elapsed = 0;
    },
  };
}
