import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { ApiError } from '@/src/api/client';
import {
  forgetAccountLocally,
  loadMobileAccount,
  type AccountState,
} from '@/src/api/account';
import {
  loadMobileCareer,
  type CareerProfile,
} from '@/src/api/career';
import {
  loadSetCatalog,
  type PracticeSet,
} from '@/src/api/draftRun';
import { ensureGuestSession } from '@/src/api/guest';
import type { MobileSession } from '@/src/storage/session';

type Options = {
  requireAccount?: boolean;
  loadProfile?: boolean;
  loadCatalog?: boolean;
};

export function useAccountState({
  requireAccount = false,
  loadProfile = false,
  loadCatalog = false,
}: Options = {}) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [catalogSets, setCatalogSets] = useState<PracticeSet[]>([]);
  const [busy, setBusy] = useState(true);
  const [enrichmentBusy, setEnrichmentBusy] = useState(loadProfile || loadCatalog);
  const [message, setMessage] = useState<string | null>(null);
  const [enrichmentWarning, setEnrichmentWarning] = useState<string | null>(null);
  const generation = useRef(0);

  const clearEnrichment = useCallback(() => {
    setProfile(null);
    setCatalogSets([]);
    setEnrichmentWarning(null);
    setEnrichmentBusy(false);
  }, []);

  const loadEnrichment = useCallback(async (current: MobileSession, id: number) => {
    if (!loadProfile && !loadCatalog) {
      if (id === generation.current) setEnrichmentBusy(false);
      return;
    }
    setEnrichmentBusy(true);
    setEnrichmentWarning(null);
    const profilePromise = loadProfile
      ? loadMobileCareer(current)
      : Promise.resolve<CareerProfile | null>(null);
    const catalogPromise = loadCatalog
      ? loadSetCatalog(current)
      : Promise.resolve<{ sets: PracticeSet[] }>({ sets: [] });
    const [profileResult, catalogResult] = await Promise.allSettled([
      profilePromise,
      catalogPromise,
    ]);
    if (id !== generation.current) return;
    if (profileResult.status === 'fulfilled' && loadProfile) setProfile(profileResult.value);
    if (catalogResult.status === 'fulfilled' && loadCatalog) setCatalogSets(catalogResult.value.sets);
    if (profileResult.status === 'rejected' || catalogResult.status === 'rejected') {
      setEnrichmentWarning('Some account details could not refresh. Try again.');
    }
    setEnrichmentBusy(false);
  }, [loadCatalog, loadProfile]);

  const loadForSession = useCallback(async (current: MobileSession, id: number) => {
    if (id !== generation.current) return null;
    setSession(current);
    if (!current.accountToken) {
      setAccount(null);
      clearEnrichment();
      if (requireAccount) router.replace('/account');
      return null;
    }
    try {
      const state = await loadMobileAccount(current);
      if (id !== generation.current) return null;
      setAccount(state);
      void loadEnrichment(current, id);
      return state;
    } catch (error: unknown) {
      if (id !== generation.current) return null;
      if (error instanceof ApiError && error.status === 401) {
        const guest = await forgetAccountLocally(current);
        if (id !== generation.current) return null;
        setSession(guest);
        setAccount(null);
        clearEnrichment();
        setMessage('Your account session expired. Sign in again.');
        if (requireAccount) router.replace('/account');
        return null;
      }
      setMessage(error instanceof Error ? error.message : 'Could not restore your account.');
      return null;
    }
  }, [clearEnrichment, loadEnrichment, requireAccount]);

  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setBusy(true);
    setMessage(null);
    try {
      const current = await ensureGuestSession();
      if (id !== generation.current) return null;
      return await loadForSession(current, id);
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }, [loadForSession]);

  const adoptSession = useCallback(async (next: MobileSession) => {
    const id = ++generation.current;
    setBusy(false);
    setMessage(null);
    return loadForSession(next, id);
  }, [loadForSession]);

  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);

  const clearAccount = useCallback((next: MobileSession | null = null) => {
    generation.current += 1;
    setSession(next);
    setAccount(null);
    clearEnrichment();
  }, [clearEnrichment]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]));

  return {
    session,
    account,
    profile,
    catalogSets,
    busy,
    enrichmentBusy,
    message,
    enrichmentWarning,
    setMessage,
    refresh,
    adoptSession,
    clearAccount,
    invalidate,
  };
}
