import { requestJson } from '@/src/api/client';
import {
  clearSession,
  writeSession,
  type MobileAccountUser,
  type MobileSession,
} from '@/src/storage/session';

export type AccountState = {
  user: MobileAccountUser;
  session: { expiresAt?: string };
  credentials: { password: boolean; google: boolean };
  deletion: {
    enabled: boolean;
    available: boolean;
    googleOnly: boolean;
    method: 'password' | 'email' | null;
  };
};

type LinkState = {
  ok: boolean;
  merged: boolean;
  validatedDailyScore: boolean;
  playerId: string;
  token: string;
  displayName: string;
  profileKey?: string | null;
  email?: string | null;
  rankingIdentity?: { eligible: boolean; reason?: string | null };
};

export type MobileAuthResponse = {
  user: MobileAccountUser;
  session: { token: string; expiresAt?: string };
  linked: LinkState;
};

export type SignupResponse =
  | MobileAuthResponse
  | { ok: boolean; verificationRequired: true; user?: MobileAccountUser | null };

function isMobileAuthResponse(value: SignupResponse): value is MobileAuthResponse {
  return 'session' in value && typeof value.session?.token === 'string';
}

async function persistAccount(result: MobileAuthResponse) {
  const next: MobileSession = {
    playerToken: result.linked.token,
    subjectId: result.linked.playerId,
    accountToken: result.session.token,
    accountExpiresAt: result.session.expiresAt,
    accountUser: result.user,
  };
  await writeSession(next);
  return next;
}

export async function signInWithEmail(
  current: MobileSession,
  email: string,
  password: string,
  validateDailyRunId?: string,
) {
  const result = await requestJson<MobileAuthResponse>('/growth/v1/mobile/account/signin', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: { email, password, validateDailyRunId },
  });
  return { result, session: await persistAccount(result) };
}

export async function signUpWithEmail(
  current: MobileSession,
  name: string,
  email: string,
  password: string,
  validateDailyRunId?: string,
) {
  const result = await requestJson<SignupResponse>('/growth/v1/mobile/account/signup', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: { name, email, password, validateDailyRunId },
  });
  if (!isMobileAuthResponse(result)) return { result, session: null };
  return { result, session: await persistAccount(result) };
}

export async function startGoogleSignIn(current: MobileSession) {
  return requestJson<{ url: string }>('/growth/v1/mobile/account/google/start', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: {},
  });
}

export async function finishGoogleSignIn(
  current: MobileSession,
  handoffToken: string,
  validateDailyRunId?: string,
) {
  const result = await requestJson<MobileAuthResponse>('/growth/v1/mobile/account/google/finish', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: { handoffToken, validateDailyRunId },
  });
  return { result, session: await persistAccount(result) };
}

export async function loadMobileAccount(session: MobileSession) {
  if (!session.accountToken) return null;
  return requestJson<AccountState>('/growth/v1/mobile/account/session', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
  });
}

export async function forgetAccountLocally(session: MobileSession) {
  const next: MobileSession = {
    playerToken: session.playerToken,
    subjectId: session.subjectId,
  };
  await writeSession(next);
  return next;
}

export async function signOutMobileAccount(session: MobileSession) {
  if (session.accountToken) {
    await requestJson<{ ok: boolean }>('/growth/v1/mobile/account/signout', {
      method: 'POST',
      mobileSessionToken: session.playerToken,
      mobileAccountToken: session.accountToken,
      body: {},
    });
  }
  return forgetAccountLocally(session);
}

export async function startDeletionVerification(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  return requestJson<{ ok: boolean; verification: string; expiresInSeconds: number }>(
    '/growth/v1/mobile/account/delete/verification/start',
    {
      method: 'POST',
      mobileSessionToken: session.playerToken,
      mobileAccountToken: session.accountToken,
      body: { confirm: true },
    },
  );
}

export async function deleteMobileAccount(
  session: MobileSession,
  proof: { currentPassword?: string; code?: string },
) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  const result = await requestJson<{ ok: boolean; deletion: 'complete' | 'accepted'; operationId?: string }>(
    '/growth/v1/mobile/account/delete',
    {
      method: 'POST',
      mobileSessionToken: session.playerToken,
      mobileAccountToken: session.accountToken,
      body: { confirm: true, ...proof },
      timeoutMs: 30_000,
    },
  );
  await clearSession();
  return result;
}
