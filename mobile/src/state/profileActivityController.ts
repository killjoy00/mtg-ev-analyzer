import type { CareerProfile } from '@/src/api/career';
import type { SetCatalog } from '@/src/api/catalog';
import type { MobileSession } from '@/src/storage/session';
import { activitySessionKey, activityShareMessage, checkedActivityProfile } from '@/src/state/profileActivity';
import type { ActivityScope, ActivityTarget, ArchiveEntry } from '@/src/state/profileActivity';

export type ProfileActivityState = {
  phase: 'loading' | 'ready' | 'guest' | 'error';
  profile: CareerProfile | null;
  refreshing: boolean;
  sharing: boolean;
  error: string | null;
  shareError: string | null;
  shareText: string | null;
  archive: ArchiveEntry[] | null;
  coverage: SetCatalog | null;
  catalogBusy: boolean;
  catalogError: string | null;
  coverageError: string | null;
};
export const initialProfileActivity: ProfileActivityState = {
  phase: 'loading', profile: null, refreshing: false, sharing: false, error: null,
  shareError: null, shareText: null, archive: null, coverage: null, catalogBusy: false,
  catalogError: null, coverageError: null,
};
export type ProfileActivityIO = {
  readSession: () => Promise<MobileSession | null>;
  loadPrivate: (session: MobileSession) => Promise<CareerProfile>;
  loadPublic: (key: string) => Promise<CareerProfile>;
  loadArchive: () => Promise<ArchiveEntry[]>;
  loadCoverage: () => Promise<SetCatalog>;
  share: (message: string, anchor?: number) => Promise<unknown>;
  changed: (state: ProfileActivityState) => void;
};

function message(error: unknown) { return error instanceof Error ? error.message : 'The record could not be loaded. Try again.'; }
function denied(error: unknown) {
  const value = error as { status?: unknown; name?: unknown } | null;
  return [401, 403, 404, 410].includes(Number(value?.status)) || value?.name === 'InvalidPublicProfileError';
}

/** Scope, identity and read-only preflight are shared by every activity action. */
export function createProfileActivityController(scope: ActivityScope, io: ProfileActivityIO) {
  let state: ProfileActivityState = { ...initialProfileActivity };
  let alive = true;
  let active = false;
  let generation = 0;
  let metadataGeneration = 0;
  let ownerKey: string | null = null;
  let loading = false;
  let sharing = false;
  let metadataLoading = false;
  const publish = (next: ProfileActivityState) => { state = next; if (alive) io.changed(next); };
  const clear = (phase: 'error' | 'guest', error: string | null) => {
    generation += 1;
    loading = false;
    sharing = false;
    ownerKey = null;
    publish({ ...state, phase, profile: null, refreshing: false, sharing: false,
      error, shareError: null, shareText: null });
  };

  async function verify(expected: string, current: () => boolean) {
    let stored: MobileSession | null;
    try { stored = await io.readSession(); }
    catch {
      if (current()) clear('error', 'Your account could not be verified. Unlock the device and retry.');
      return false;
    }
    if (!current()) return false;
    const key = activitySessionKey(stored);
    if (key !== expected) {
      clear(key ? 'error' : 'guest', key ? 'Your account changed. Refresh the current record.' : null);
      return false;
    }
    return true;
  }

  async function read(current: () => boolean, action = false): Promise<CareerProfile | null> {
    let profile: CareerProfile;
    if (scope.kind === 'private') {
      let stored: MobileSession | null;
      try { stored = await io.readSession(); }
      catch {
        if (current()) clear('error', 'Your account could not be verified. Unlock the device and retry.');
        return null;
      }
      if (!current()) return null;
      const key = activitySessionKey(stored);
      if (!stored || !key) { clear('guest', null); return null; }
      if (action && key !== ownerKey) { clear('error', 'Your account changed. Refresh before sharing.'); return null; }
      if (key !== ownerKey) publish({ ...state, phase: 'loading', profile: null, shareText: null, shareError: null });
      ownerKey = key;
      const session: MobileSession = { ...stored, accountUser: { ...stored.accountUser! } };
      try { profile = await io.loadPrivate(session); }
      catch (error: unknown) {
        if (!await verify(key, current)) return null;
        throw error;
      }
      if (!await verify(key, current)) return null;
    } else {
      profile = await io.loadPublic(scope.key);
      if (!current()) return null;
    }
    try { return checkedActivityProfile(profile, scope); }
    catch (error: unknown) { if (current()) clear('error', message(error)); return null; }
  }

  async function refresh() {
    if (!alive || !active || loading || sharing) return;
    loading = true;
    const request = ++generation;
    const current = () => alive && active && request === generation;
    publish({ ...state, refreshing: true, error: null, shareError: null, shareText: null });
    try {
      const profile = await read(current);
      if (profile && current()) publish({ ...state, phase: 'ready', profile, error: null });
    } catch (error: unknown) {
      if (!current()) return;
      if (denied(error) || !state.profile) clear('error', message(error));
      else publish({ ...state, error: message(error) });
    } finally {
      if (current()) { loading = false; publish({ ...state, refreshing: false }); }
    }
  }

  async function share(target: ActivityTarget, anchor?: number) {
    if (!alive || !active || loading || sharing || state.phase !== 'ready' || !state.profile) return;
    sharing = true;
    const request = generation;
    const current = () => alive && active && request === generation;
    publish({ ...state, sharing: true, shareError: null, shareText: null });
    try {
      const profile = await read(current, true);
      if (!profile || !current()) return;
      publish({ ...state, profile });
      const text = activityShareMessage(profile, target);
      // The last storage read is deliberately adjacent to the native handoff.
      if (scope.kind === 'private' && (!ownerKey || !await verify(ownerKey, current))) return;
      if (!current()) return;
      publish({ ...state, shareText: text });
      await io.share(text, anchor);
    } catch (error: unknown) {
      if (!current()) return;
      if (denied(error)) clear('error', message(error));
      else publish({ ...state, shareError: message(error) });
    } finally { if (current()) { sharing = false; publish({ ...state, sharing: false }); } }
  }

  async function catalog() {
    if (!alive || !active || metadataLoading) return;
    metadataLoading = true;
    const request = ++metadataGeneration;
    publish({ ...state, catalogBusy: true, catalogError: null, coverageError: null });
    // Archive progress does not become unavailable just because live serving
    // metadata failed, and a missing catalog is never an empty/complete archive.
    const [archive, coverage] = await Promise.allSettled([Promise.resolve().then(io.loadArchive), Promise.resolve().then(io.loadCoverage)]);
    if (!alive || request !== metadataGeneration) return;
    metadataLoading = false;
    publish({ ...state, catalogBusy: false,
      archive: archive.status === 'fulfilled' ? archive.value : null,
      coverage: coverage.status === 'fulfilled' ? coverage.value : null,
      catalogError: archive.status === 'rejected' ? message(archive.reason) : null,
      coverageError: coverage.status === 'rejected' ? message(coverage.reason) : null });
  }

  return {
    refresh, share, catalog,
    resume() { alive = true; active = true; void refresh(); },
    pause() {
      active = false; generation += 1; loading = false; sharing = false;
      publish({ ...state, refreshing: false, sharing: false, shareText: null, shareError: null });
    },
    sessionChanged(session: MobileSession | null) {
      if (scope.kind === 'public' || activitySessionKey(session) === ownerKey) return;
      const key = activitySessionKey(session);
      clear(key ? 'error' : 'guest', key ? 'Your account changed. Loading the current record.' : null);
      if (active && key) void refresh();
    },
    dispose() { alive = false; active = false; generation += 1; metadataGeneration += 1; metadataLoading = false; },
  };
}
