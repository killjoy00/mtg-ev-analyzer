import { checkedPatreonAuthorizeUrl, checkedPatreonStatus, membershipSessionKey } from '@/src/api/patreon';
import type { NativePatreonStatus } from '@/src/api/patreon';
import type { MobileSession } from '@/src/storage/session';

export type MembershipState = {
  phase: 'loading' | 'ready' | 'error' | 'guest';
  data: NativePatreonStatus | null;
  busy: boolean;
  notice: string | null;
  error: string | null;
};
export const initialMembershipState: MembershipState = {
  phase: 'loading', data: null, busy: false, notice: null, error: null,
};
export type MembershipIO = {
  readSession: () => Promise<MobileSession | null>;
  load: (session: MobileSession) => Promise<NativePatreonStatus>;
  connect: (session: MobileSession) => Promise<string>;
  mutate: (session: MobileSession, action: 'refresh' | 'disconnect') => Promise<unknown>;
  openBrowser: (url: string) => Promise<unknown>;
  changed: (state: MembershipState) => void;
};

export function accountAccessLabel(state: MembershipState) {
  if (state.phase !== 'ready' || !state.data) return 'Account access not verified';
  const caps = state.data.account_capabilities;
  const cube = caps.includes('unlimited_cube_practice');
  const custom = caps.includes('custom_corpus');
  return cube && custom ? 'Elite access active' : cube || custom ? 'Additional practice access' : 'Regular practice access';
}

export function createMembershipController(io: MembershipIO) {
  let state: MembershipState = { ...initialMembershipState };
  let ownerKey: string | null = null;
  let generation = 0;
  let active = true;
  let running = false;
  const publish = (next: MembershipState) => { state = next; if (active) io.changed(next); };

  async function perform(action: 'check' | 'connect' | 'refresh' | 'disconnect', expected?: { accountUserId: string; playerId: string }) {
    if (!active || running) return;
    const actionOwner = ownerKey;
    running = true;
    const request = ++generation;
    const current = () => active && request === generation;
    publish({ ...state, busy: true, error: null, notice: null });
    try {
      const stored = await io.readSession();
      if (!current()) return;
      const key = membershipSessionKey(stored);
      if (!stored || !key) {
        ownerKey = null;
        publish({ phase: 'guest', data: null, busy: false, notice: 'Sign in to check membership and account access.', error: null });
        return;
      }
      const session: MobileSession = { ...stored, accountUser: { ...stored.accountUser! } };
      if (action !== 'check' && (!actionOwner || actionOwner !== key
        || (expected && (expected.accountUserId !== session.accountUser?.id
          || expected.playerId !== session.playerToken.slice(3).split('.')[0])))) {
        ownerKey = null;
        publish({ phase: 'error', data: null, busy: false, notice: null, error: 'Your account changed. Check status before taking a membership action.' });
        return;
      }
      if (key !== ownerKey) publish({ ...initialMembershipState, busy: true });
      ownerKey = key;
      const assertCurrent = async () => {
        if (!current()) throw new Error('Membership request was superseded.');
        const persisted = await io.readSession();
        if (!current()) throw new Error('Membership request was superseded.');
        if (membershipSessionKey(persisted) !== key) {
          ownerKey = null;
          publish({ phase: 'error', data: null, busy: false, notice: null, error: 'Your account changed. Check status again.' });
          generation += 1;
          running = false;
          throw new Error('Membership identity changed.');
        }
      };
      let notice: string | null = null;
      if (action === 'connect') {
        const url = checkedPatreonAuthorizeUrl(await io.connect(session));
        await assertCurrent();
        await io.openBrowser(url);
        await assertCurrent();
        notice = 'Browser closed or opened separately. Only the checked account status below confirms a connection.';
      } else if (action === 'refresh' || action === 'disconnect') {
        await assertCurrent();
        await io.mutate(session, action);
        await assertCurrent();
        notice = action === 'refresh'
          ? 'Refresh requested. Patreon reconciliation may still be pending; use Check status to verify it.'
          : 'Disconnect acknowledged. Verifying the remaining account access.';
      }
      await assertCurrent();
      const data = checkedPatreonStatus(await io.load(session), session);
      await assertCurrent();
      if (action === 'disconnect' && data.connected) throw new Error('Patreon still appears connected. Check status before retrying.');
      if (action === 'disconnect') notice = 'Patreon disconnected. Access from other providers was not removed.';
      publish({ phase: 'ready', data, busy: false, notice, error: null });
    } catch (error: unknown) {
      if (!current()) return;
      publish({ ...state, phase: 'error', busy: false, notice: null,
        error: error instanceof Error ? error.message : 'Membership is unavailable. Check status again.' });
    } finally {
      if (current()) {
        running = false;
        if (state.busy) publish({ ...state, busy: false });
      }
    }
  }
  return {
    check: () => perform('check'),
    connect: () => perform('connect'),
    refresh: () => perform('refresh'),
    disconnect: (accountUserId: string, playerId: string) => perform('disconnect', { accountUserId, playerId }),
    sessionChanged(next: MobileSession | null) {
      if (ownerKey && ownerKey === membershipSessionKey(next)) return;
      generation += 1;
      running = false;
      ownerKey = null;
      publish({ ...initialMembershipState });
      void perform('check');
    },
    activate() { active = true; },
    pause() { generation += 1; running = false; publish({ ...state, busy: false }); },
    dispose() { generation += 1; running = false; active = false; },
  };
}
