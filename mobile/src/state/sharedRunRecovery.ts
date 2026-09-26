import type { DraftRunState } from '@/src/api/draftRun';
import type { MobileSession } from '@/src/storage/session';

const SHARE_ID = /^[a-f0-9]{24}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type SharedRunRecoveryIO = {
  readSession: () => Promise<MobileSession | null>;
  readContinuation: (shareId: string, session: MobileSession) => Promise<string | null>;
  writeContinuation: (shareId: string, runId: string, session: MobileSession) => Promise<void>;
  loadRun: (runId: string, session: MobileSession) => Promise<DraftRunState>;
  startRun: (shareId: string, session: MobileSession) => Promise<DraftRunState>;
};

export class SharedRunIdentityChangedError extends Error {
  constructor() {
    super('Your Pack One account changed. Reopen this shared run with your current account.');
    this.name = 'SharedRunIdentityChangedError';
  }
}

function signedIdentity(session: MobileSession | null) {
  if (!session?.accountToken || !session.accountUser?.id) return null;
  const tokenPlayer = session.playerToken.match(/^p1_([a-f0-9-]{36})\./i)?.[1];
  const subject = session.subjectId ?? tokenPlayer;
  const account = session.accountUser.id;
  if (!subject || !tokenPlayer || !UUID.test(subject) || !UUID.test(tokenPlayer) || !UUID.test(account)) return null;
  if (subject.toLowerCase() !== tokenPlayer.toLowerCase()) return null;
  return `${subject.toLowerCase()}:${account.toLowerCase()}`;
}

function sameSession(expected: MobileSession, current: MobileSession | null) {
  const identity = signedIdentity(expected);
  return Boolean(identity && current
    && signedIdentity(current) === identity
    && current.playerToken === expected.playerToken
    && current.accountToken === expected.accountToken);
}

function checkedRun(run: DraftRunState, expectedId?: string) {
  if (!run || typeof run.id !== 'string' || !UUID.test(run.id) || run.day) {
    throw new Error('The server did not return a valid shared practice run.');
  }
  if (expectedId && run.id.toLowerCase() !== expectedId.toLowerCase()) {
    throw new Error('The recovered run did not match the saved server run.');
  }
  return run;
}

/**
 * One coordinator per mounted shared-run surface. The stored server UUID is a
 * checkpoint, never a hint that may be discarded after a failed GET. A fresh
 * start is allowed only after an explicit user action and no known checkpoint.
 * The server, not a client-generated idempotency key, deduplicates that start.
 */
export function createSharedRunRecovery(io: SharedRunRecoveryIO) {
  const knownRuns = new Map<string, string>();
  const inFlight = new Map<string, Promise<DraftRunState | null>>();

  async function resolve(shareId: string, session: MobileSession, allowStart: boolean) {
    if (!SHARE_ID.test(shareId)) throw new Error('Invalid shared Draft Run.');
    const snapshot: MobileSession = {
      ...session,
      accountUser: session.accountUser ? { ...session.accountUser } : undefined,
    };
    const identity = signedIdentity(snapshot);
    if (!identity) throw new Error('Sign in to play a shared Pack One run.');
    const scope = `${identity}:${shareId}`;
    // Credentials are used only in memory to avoid joining an obsolete request
    // after a sign-out/sign-in or token rotation. They are never persisted here.
    const operationKey = `${scope}:${snapshot.playerToken}:${snapshot.accountToken}:${allowStart}`;
    const assertCurrent = async () => {
      if (!sameSession(snapshot, await io.readSession())) throw new SharedRunIdentityChangedError();
    };

    let pending = inFlight.get(operationKey);
    if (!pending) {
      pending = (async () => {
        await assertCurrent();
        const storedId = await io.readContinuation(shareId, snapshot);
        await assertCurrent();
        const knownId = knownRuns.get(scope);
        if (storedId !== null && !UUID.test(storedId)) {
          throw new Error('The saved shared-run continuation is invalid.');
        }
        if (storedId && knownId && storedId.toLowerCase() !== knownId) {
          throw new Error('The saved shared-run continuation changed. Reopen the invitation.');
        }
        const runId = storedId?.toLowerCase() ?? knownId;
        if (runId) {
          // Deliberately do not catch a 404, timeout, or authorization failure
          // and fall back to POST. The same checkpoint must remain recoverable.
          const run = checkedRun(await io.loadRun(runId, snapshot), runId);
          await assertCurrent();
          if (!storedId) {
            await io.writeContinuation(shareId, runId, snapshot);
            await assertCurrent();
          }
          return run;
        }
        if (!allowStart) return null;

        await assertCurrent();
        const run = checkedRun(await io.startRun(shareId, snapshot));
        // Keep a scoped in-memory checkpoint even if SecureStore fails after
        // the server has committed. Retrying must GET this UUID, not POST again.
        knownRuns.set(scope, run.id.toLowerCase());
        await assertCurrent();
        await io.writeContinuation(shareId, run.id.toLowerCase(), snapshot);
        await assertCurrent();
        return run;
      })();
      inFlight.set(operationKey, pending);
    }
    try {
      const run = await pending;
      await assertCurrent();
      return run;
    } finally {
      if (inFlight.get(operationKey) === pending) inFlight.delete(operationKey);
    }
  }

  return {
    resume: (shareId: string, session: MobileSession) => resolve(shareId, session, false),
    start: (shareId: string, session: MobileSession) => resolve(shareId, session, true),
  };
}
