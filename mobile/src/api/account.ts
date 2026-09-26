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
  credentials: { password: boolean; google: boolean; apple: boolean };
  deletion: {
    enabled: boolean;
    available: boolean;
    googleOnly: boolean;
    socialOnly?: boolean;
    method: 'password' | 'email' | 'apple' | null;
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

export async function startAppleSignIn(current: MobileSession) {
  return requestJson<{ flowToken: string; url: string }>('/growth/v1/mobile/account/apple/start', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: {},
  });
}

export async function finishAppleSignIn(
  current: MobileSession,
  handoffToken: string,
  validateDailyRunId?: string,
) {
  const result = await requestJson<MobileAuthResponse>('/growth/v1/mobile/account/apple/finish', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: { handoffToken, validateDailyRunId },
  });
  return { result, session: await persistAccount(result) };
}

export async function finishNativeAppleSignIn(
  current: MobileSession,
  credential: {
    flowToken: string;
    identityToken: string;
    authorizationCode: string;
    firstName?: string | null;
    lastName?: string | null;
  },
  validateDailyRunId?: string,
) {
  const result = await requestJson<MobileAuthResponse>('/growth/v1/mobile/account/apple/native', {
    method: 'POST',
    mobileSessionToken: current.playerToken,
    body: { ...credential, validateDailyRunId },
  });
  return { result, session: await persistAccount(result) };
}

export function requestMobilePasswordReset(session: MobileSession, email: string) {
  return requestJson<{ ok: boolean; message: string }>('/growth/v1/mobile/account/request-password-reset', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    body: { email },
  });
}

export function requestMobileVerificationEmail(session: MobileSession, email: string) {
  return requestJson<{ ok: boolean; message: string }>('/growth/v1/mobile/account/send-verification-email', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    body: { email },
  });
}

export function resetMobilePassword(session: MobileSession, token: string, newPassword: string) {
  return requestJson<{ ok: boolean }>('/growth/v1/mobile/account/reset-password', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    body: { token, newPassword },
  });
}

export function changeMobilePassword(session: MobileSession, currentPassword: string, newPassword: string) {
  if (!session.accountToken) throw new Error('Sign in before changing your password.');
  return requestJson<{ ok: boolean; signedOut: boolean }>('/growth/v1/mobile/account/password-change', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { currentPassword, newPassword },
  });
}

export type PatreonStatus = {
  configured: boolean;
  support_url: string;
  connected: boolean;
  ad_free: boolean;
  ads_allowed: boolean;
  membership: {
    status?: string | null;
    entitled_amount_cents?: number;
    is_free_trial?: boolean;
    is_gifted?: boolean;
    effective_state?: string | null;
    sync_pending?: boolean;
  } | null;
  capabilities: string[];
};

export function loadMobilePatreonStatus(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to manage Patreon access.');
  return requestJson<PatreonStatus>('/growth/v1/mobile/patreon/status', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    timeoutMs: 15_000,
  });
}

export function startMobilePatreonConnect(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to connect Patreon.');
  return requestJson<{ url: string }>('/growth/v1/mobile/patreon/connect', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {},
    timeoutMs: 15_000,
  });
}

export function disconnectMobilePatreon(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in to disconnect Patreon.');
  return requestJson<{ ok: boolean }>('/growth/v1/mobile/patreon/disconnect', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {},
    timeoutMs: 15_000,
  });
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

export async function startAppleDeletionVerification(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  return requestJson<{ flowToken: string; url: string }>('/growth/v1/mobile/account/delete/apple/start', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: { confirm: true },
  });
}

export async function finishAppleDeletion(
  session: MobileSession,
  handoffToken: string,
) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  const result = await requestJson<{ ok: boolean; deletion: 'complete' | 'accepted'; operationId?: string }>(
    '/growth/v1/mobile/account/delete/apple/finish',
    {
      method: 'POST',
      mobileSessionToken: session.playerToken,
      mobileAccountToken: session.accountToken,
      body: { confirm: true, handoffToken },
      timeoutMs: 30_000,
    },
  );
  await clearSession();
  return result;
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
