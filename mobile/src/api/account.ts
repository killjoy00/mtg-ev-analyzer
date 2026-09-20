import { requestJson } from '@/src/api/client';
import { clearSession, writeSession, type MobileAccountUser, type MobileSession } from '@/src/storage/session';

export type AccountSessionResponse = {
  user: MobileAccountUser;
  session: {
    token?: string;
    expiresAt?: string;
  };
  deletion?: {
    passwordSupported: boolean;
    googleSupported: boolean;
  };
};

type LinkResponse = {
  ok: boolean;
  merged: boolean;
  validatedDailyScore: boolean;
  playerId: string;
  token: string;
  displayName: string;
  profileKey?: string | null;
  email?: string | null;
};

type SignupResponse = AccountSessionResponse & {
  ok?: boolean;
  verificationRequired?: boolean;
};

export async function startGoogleSignIn(playerToken: string) {
  return requestJson<{ url: string }>('/growth/v1/mobile/account/google/start', {
    method: 'POST',
    mobileSessionToken: playerToken,
    body: {},
  });
}

export async function startGoogleDeletion(session: MobileSession) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  return requestJson<{ url: string }>('/growth/v1/mobile/account/google/delete/start', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: {},
  });
}

export async function finishGoogleSignIn(playerToken: string, handoffToken: string) {
  return requestJson<AccountSessionResponse>('/growth/v1/mobile/account/google/finish', {
    method: 'POST',
    mobileSessionToken: playerToken,
    body: { handoffToken },
  });
}

export async function signInWithEmail(playerToken: string, email: string, password: string) {
  return requestJson<AccountSessionResponse>('/growth/v1/mobile/account/signin', {
    method: 'POST',
    mobileSessionToken: playerToken,
    body: { email, password },
  });
}

export async function signUpWithEmail(
  playerToken: string,
  name: string,
  email: string,
  password: string,
) {
  return requestJson<SignupResponse>('/growth/v1/mobile/account/signup', {
    method: 'POST',
    mobileSessionToken: playerToken,
    body: { name, email, password },
  });
}

export async function linkMobileAccount(
  session: MobileSession,
  account: AccountSessionResponse,
  claimToken?: string,
) {
  const accountToken = account.session.token;
  if (!accountToken) throw new Error('Pack One did not return a native account session.');
  const linked = await requestJson<LinkResponse>('/growth/v1/mobile/account/link', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: accountToken,
    body: claimToken ? { claimToken } : {},
  });
  const next: MobileSession = {
    playerToken: linked.token,
    subjectId: linked.playerId,
    accountToken,
    accountExpiresAt: account.session.expiresAt,
    accountUser: account.user,
  };
  await writeSession(next);
  return { linked, session: next };
}

export async function loadMobileAccount(session: MobileSession) {
  if (!session.accountToken) return null;
  return requestJson<AccountSessionResponse>('/growth/v1/mobile/account/session', {
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
  });
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
  await clearSession();
}

export async function deleteMobileAccount(
  session: MobileSession,
  proof: { password?: string; googleHandoff?: string },
) {
  if (!session.accountToken) throw new Error('Sign in before deleting your account.');
  const result = await requestJson<{ ok: boolean; deleted: boolean }>('/growth/v1/mobile/account/delete', {
    method: 'POST',
    mobileSessionToken: session.playerToken,
    mobileAccountToken: session.accountToken,
    body: proof,
  });
  if (!result.deleted) throw new Error('Pack One did not confirm account deletion.');
  await clearSession();
  return result;
}
