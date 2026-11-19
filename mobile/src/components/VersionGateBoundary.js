const { useCallback, useEffect, useRef, useState } = require('react');

function VersionGateBoundary({
  children,
  checkVersion,
  initialAppState,
  subscribe,
  checkingFallback,
  renderRequired,
}) {
  const [decision, setDecision] = useState(null);
  const mountedRef = useRef(false);
  const previousStateRef = useRef(initialAppState);
  const requestIdRef = useRef(0);

  const runCheck = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    let next;
    try {
      next = await checkVersion();
    } catch {
      next = { status: 'allowed' };
    }

    if (!next || next.status !== 'required') next = { status: 'allowed' };

    if (mountedRef.current && requestId === requestIdRef.current) {
      setDecision(next);
    }
  }, [checkVersion]);

  useEffect(() => {
    mountedRef.current = true;
    void runCheck();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [runCheck]);

  useEffect(
    () =>
      subscribe((nextState) => {
        const previous = previousStateRef.current;
        previousStateRef.current = nextState;
        const wasAway = previous === 'inactive' || previous === 'background';
        if (wasAway && nextState === 'active') {
          // Foreground checks intentionally do not clear the current decision.
          // Supported navigation therefore stays mounted while revalidation runs.
          void runCheck();
        }
      }),
    [runCheck, subscribe],
  );

  if (decision === null) return checkingFallback;
  if (decision.status === 'required') return renderRequired(decision);
  return children;
}

module.exports = { VersionGateBoundary };
