import * as SecureStore from 'expo-secure-store';
import { config } from '@/src/config';
import type { MobileSession } from '@/src/storage/session';

async function deviceStore() {
  return config.screenshots.fixtures ? import('@/src/screenshots/storage') : SecureStore;
}

const KEY='packone.mobile.creator-challenge.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type RecordValue={challengeId:string;runId:string;playerId:string};

function playerId(session:MobileSession){
  const tokenPlayer=session.playerToken.match(/^p1_([a-f0-9-]{36})\./i)?.[1];
  if(!tokenPlayer||!UUID.test(tokenPlayer))return null;
  if(session.subjectId&&(!UUID.test(session.subjectId)||session.subjectId.toLowerCase()!==tokenPlayer.toLowerCase()))return null;
  return tokenPlayer.toLowerCase();
}

function valid(value:unknown):value is RecordValue{
  if(!value||typeof value!=='object')return false;
  const row=value as Partial<RecordValue>;
  return typeof row.challengeId==='string'&&UUID.test(row.challengeId)
    &&typeof row.runId==='string'&&UUID.test(row.runId)
    &&typeof row.playerId==='string'&&UUID.test(row.playerId);
}

export async function readCreatorChallengeContinuation(challengeId:string,session:MobileSession){
  if(!UUID.test(challengeId))return null;
  const player=playerId(session);if(!player)return null;
  const raw=await (await deviceStore()).getItemAsync(KEY);if(!raw)return null;
  try{
    const row:unknown=JSON.parse(raw);
    if(!valid(row)||row.challengeId.toLowerCase()!==challengeId.toLowerCase()||row.playerId.toLowerCase()!==player)return null;
    return row.runId.toLowerCase();
  }catch{return null;}
}

export async function writeCreatorChallengeContinuation(challengeId:string,runId:string,session:MobileSession){
  if(!UUID.test(challengeId)||!UUID.test(runId))throw new Error('Invalid creator challenge continuation.');
  const player=playerId(session);if(!player)throw new Error('Invalid Pack One player session.');
  const row:RecordValue={challengeId:challengeId.toLowerCase(),runId:runId.toLowerCase(),playerId:player};
  await (await deviceStore()).setItemAsync(KEY,JSON.stringify(row),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
}

export async function clearCreatorChallengeContinuation(){
  await (await deviceStore()).deleteItemAsync(KEY);
}
