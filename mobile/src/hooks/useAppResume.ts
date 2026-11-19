import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useAppResume(onResume: () => void | Promise<void>) {
  const callback = useRef(onResume);
  const previousState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    callback.current = onResume;
  }, [onResume]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = previousState.current;
      previousState.current = nextState;
      const wasAway = previous === 'inactive' || previous === 'background';
      if (wasAway && nextState === 'active') {
        void callback.current();
      }
    });

    return () => subscription.remove();
  }, []);
}
