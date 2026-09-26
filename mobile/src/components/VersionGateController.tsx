import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import type { VersionGateDecision } from '@/src/versionPolicy';

type GateState = 'checking' | VersionGateDecision;
type RequiredDecision = Extract<VersionGateDecision, { status: 'required' }>;

export type ForegroundSubscriber = (onForeground: () => void) => () => void;

export function VersionGateController({
  children,
  check,
  subscribeToForeground,
  checking,
  renderRequired,
}: {
  children: ReactNode;
  check: () => Promise<VersionGateDecision>;
  subscribeToForeground: ForegroundSubscriber;
  checking: ReactNode;
  renderRequired: (decision: RequiredDecision) => ReactNode;
}) {
  const [state, setState] = useState<GateState>('checking');
  const mounted = useRef(false);
  const requestSequence = useRef(0);

  const checkVersion = useCallback(async () => {
    const requestId = ++requestSequence.current;
    let next: VersionGateDecision;
    try {
      next = await check();
    } catch {
      // The version service is an availability guard, not a dependency that may
      // strand otherwise supported clients.
      next = { status: 'allowed' };
    }

    if (!mounted.current || requestId !== requestSequence.current) return;
    setState(next);
  }, [check]);

  useEffect(() => {
    mounted.current = true;
    void checkVersion();
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [checkVersion]);

  useEffect(() => subscribeToForeground(() => {
    // Foreground validation is intentionally non-blocking. Keeping the allowed
    // subtree mounted preserves navigation, form, share-sheet, auth-return, and
    // server-authoritative run state while the check is in flight.
    void checkVersion();
  }), [checkVersion, subscribeToForeground]);

  if (state === 'checking') return checking;
  if (state.status === 'required') return renderRequired(state);
  return children;
}
