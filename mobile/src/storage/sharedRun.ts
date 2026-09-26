import * as SecureStore from 'expo-secure-store';

import type { MobileSession } from '@/src/storage/session';

const SHARED_RUN_KEY = 'packone.mobile.shared-run.v1';
const SHARE_ID = /^[a-f0-9]{24}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type SharedRunRecord = {
  shareId: string;
  runId: string;
  playerId: string;
  accountUserId: string;
};

function playerId(session: MobileSession) {
  if (session.subjectId && UUID.test(session.subjectId)) return session.subjectId.toLowerCase();
  const match = session.playerToken.match(/^p1_([a-f0-9-]{36})\./i);
  const id = match?.[1];
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

function accountUserId(session: MobileSession) {
  const id = session.accountUser?.id;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

function identity(session: MobileSession) {
  if (!session.accountToken) return null;
  const player = playerId(session);
  const account = accountUserId(session);
  return player && account ? { player, account } : null;
}

function validRecord(value: unknown): value is SharedRunRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SharedRunRecord>;
  return typeof record.shareId === 'string'
    && SHARE_ID.test(record.shareId)
    && typeof record.runId === 'string'
    && UUID.test(record.runId)
    && typeof record.playerId === 'string'
    && UUID.test(record.playerId)
    && typeof record.accountUserId === 'string'
    && UUID.test(record.accountUserId);
}

export async function readSharedRunContinuation(shareId: string, session: MobileSession) {
  if (!SHARE_ID.test(shareId)) return null;
  const current = identity(session);
  if (!current) return null;
  const raw = await SecureStore.getItemAsync(SHARED_RUN_KEY);
  if (!raw) return null;
  try {
    const record: unknown = JSON.parse(raw);
    if (!validRecord(record)) return null;
    if (
      record.shareId !== shareId
      || record.playerId.toLowerCase() !== current.player
      || record.accountUserId.toLowerCase() !== current.account
    ) return null;
    return record.runId.toLowerCase();
  } catch {
    return null;
  }
}

export async function writeSharedRunContinuation(
  shareId: string,
  runId: string,
  session: MobileSession,
) {
  if (!SHARE_ID.test(shareId) || !UUID.test(runId)) {
    throw new Error('Invalid shared-run continuation.');
  }
  const current = identity(session);
  if (!current) throw new Error('Sign in before saving a shared run.');
  const record: SharedRunRecord = {
    shareId,
    runId: runId.toLowerCase(),
    playerId: current.player,
    accountUserId: current.account,
  };
  await SecureStore.setItemAsync(SHARED_RUN_KEY, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSharedRunContinuation() {
  await SecureStore.deleteItemAsync(SHARED_RUN_KEY);
}
