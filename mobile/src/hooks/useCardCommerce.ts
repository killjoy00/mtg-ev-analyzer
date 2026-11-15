import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { readSession, subscribeSession } from '@/src/storage/session';
import { loadNativePatreonStatus } from '@/src/api/patreon';
import { useAppResume } from '@/src/hooks/useAppResume';

export function useCardCommerce() {
  const [allowed, setAllowed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setAllowed(false);
    try {
      const session = await readSession();
      let next = false;
      if (!session?.accountToken) next = true;
      else if (session?.accountToken) {
        const status = await loadNativePatreonStatus(session);
        const elite = ['custom_corpus', 'unlimited_cube_practice'].every(cap => status.account_capabilities.includes(cap));
        next = status.ads_allowed === true && !status.ad_free && !elite;
      }
      if (id === generation.current) setAllowed(next);
    } catch { /* Unverified access stays ad-free. */ }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeSession(() => { void refresh(); });
    return () => { generation.current += 1; unsubscribe(); };
  }, [refresh]);
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; setAllowed(false); };
  }, [refresh]));
  useAppResume(refresh);
  return allowed;
}
