import * as SecureStore from 'expo-secure-store';
import { config } from '@/src/config';
import type { MobileSession } from '@/src/storage/session';

async function deviceStore() {
  return config.screenshots.fixtures ? import('@/src/screenshots/storage') : SecureStore;
}

const KEY='packone.mobile.creator-challenge.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type RecordValue={challengeId:string;runId:string;playerId:string;slug?:string};

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
    &&typeof row.playerId==='string'&&UUID.test(row.playerId)
    &&(row.slug===undefined||(typeof row.slug==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(row.slug)));
}

export async function readCreatorChallengeContinuation(identifier:string,session:MobileSession){
  const normalized=String(identifier||'').toLowerCase();
  if(!UUID.test(normalized)&&!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized))return null;
  if(!playerId(session))return null;
  const raw=await (await deviceStore()).getItemAsync(KEY);if(!raw)return null;
  try{
    const row:unknown=JSON.parse(raw);
    if(!valid(row))return null;
    const matches=row.challengeId.toLowerCase()===normalized||row.slug?.toLowerCase()===normalized;
    return matches?row.runId.toLowerCase():null;
  }catch{return null;}
}

export async function writeCreatorChallengeContinuation(challengeId:string,runId:string,session:MobileSession,slug?:string){
  if(!UUID.test(challengeId)||!UUID.test(runId))throw new Error('Invalid creator challenge continuation.');
  const normalizedSlug=slug?.toLowerCase();
  if(normalizedSlug&&!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalizedSlug))throw new Error('Invalid creator challenge slug.');
  const player=playerId(session);if(!player)throw new Error('Invalid Pack One player session.');
  const row:RecordValue={challengeId:challengeId.toLowerCase(),runId:runId.toLowerCase(),playerId:player,...(normalizedSlug?{slug:normalizedSlug}:{})};
  await (await deviceStore()).setItemAsync(KEY,JSON.stringify(row),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
}

export async function clearCreatorChallengeContinuation(){
  await (await deviceStore()).deleteItemAsync(KEY);
}
