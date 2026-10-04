import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { forgetAccountLocally, loadMobileAccount } from '@/src/api/account';
import { ApiError } from '@/src/api/client';
import { ensureGuestSession } from '@/src/api/guest';
import { useAppResume } from '@/src/hooks/useAppResume';
import { readSession, subscribeSession, type MobileSession } from '@/src/storage/session';

export function sessionIdentity(session: MobileSession | null) {
  return session ? JSON.stringify([session.playerToken, session.accountToken, session.accountUser?.id]) : '';
}

type NavigationSession = {
  session: MobileSession | null;
  status: 'checking' | 'ready' | 'unavailable';
  message: string | null;
  refresh: () => Promise<void>;
};
const Context = createContext<NavigationSession>({ session: null, status: 'checking', message: null, refresh: async () => {} });
export const useNavigationSession = () => useContext(Context);

/** A failed revalidation never signs the player out; only an authoritative 401 does. */
export function NavigationSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<NavigationSession, 'refresh'>>({ session: null, status: 'checking', message: null });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    try {
      const session = await ensureGuestSession();
      if (id !== generation.current) return;
      setState({ session, status: session.accountToken ? 'checking' : 'ready', message: null });
      if (!session.accountToken) return;
      try {
        await loadMobileAccount(session);
        if (id === generation.current) setState({ session, status: 'ready', message: null });
      } catch (error) {
        if (id !== generation.current) return;
        // Re-read before any persistent mutation: a newer sign-in owns storage.
        if (sessionIdentity(await readSession()) !== sessionIdentity(session) || id !== generation.current) return;
        if (error instanceof ApiError && error.status === 401) {
          const guest = await forgetAccountLocally(session);
          setState({ session: guest, status: 'ready', message: 'Your session expired. Sign in again to use your account.' });
        } else {
          setState({ session, status: 'unavailable', message: 'Account check unavailable. Your saved sign-in is retained.' });
        }
      }
    } catch {
      if (id === generation.current) setState({ session: null, status: 'unavailable', message: 'Could not read your saved identity. Unlock your device and retry.' });
    }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeSession((session) => {
      generation.current += 1;
      setState({ session, status: 'ready', message: null });
    });
    void Promise.resolve().then(refresh);
    return () => { generation.current += 1; unsubscribe(); };
  }, [refresh]);
  useAppResume(refresh);
  return <Context.Provider value={{ ...state, refresh }}>{children}</Context.Provider>;
}
