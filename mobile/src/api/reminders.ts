import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { requestJson } from '@/src/api/client';
import type { MobileSession } from '@/src/storage/session';

export type ReminderSchedule = {
  frequency: 'daily' | 'weekly' | 'custom';
  weekdays: number[];
  localTime: string;
  timeZone: string;
};
export type ReminderSnapshot = {
  schedule: ReminderSchedule;
  email: { enabled: boolean; eligible: boolean; suppressed: boolean; consentedAt: string | null; deliveredAt: string | null };
  push: { enabled: boolean; consentedAt: string | null; providerAcceptedAt: string | null };
  nextAt: string | null;
  deliveryActive: boolean;
};
export type ReminderChannel = 'email' | 'push';

const INSTALLATION_KEY='packone.push.installation.v1';

function authentication(session: MobileSession) {
  if (!session.playerToken || !session.accountToken) throw Error('Sign in to manage reminders.');
  return { mobileSessionToken:session.playerToken, mobileAccountToken:session.accountToken };
}
function newInstallationId(): string {
  // This is a non-secret installation label; the server independently verifies
  // the player and account sessions on every registration and mutation.
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes=Array.from({length:16},()=>Math.floor(Math.random()*256));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.map(v=>v.toString(16).padStart(2,'0')).join('');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
export async function installationId() {
  let id=await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (id && /^[a-f0-9-]{36}$/i.test(id)) return id;
  id=newInstallationId();
  await SecureStore.setItemAsync(INSTALLATION_KEY,id,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
  return id;
}
export function loadNativeReminders(session: MobileSession) {
  return requestJson<ReminderSnapshot>('/growth/v1/mobile/account/reminders',authentication(session));
}
export function saveNativeReminders(
  session:MobileSession,channel:ReminderChannel,enabled:boolean,schedule:ReminderSchedule,
) {
  return requestJson<ReminderSnapshot>('/growth/v1/mobile/account/reminders',{
    ...authentication(session),method:'PATCH',body:{channel,enabled,...schedule},
  });
}
export async function unregisterReminderDevice(session:MobileSession) {
  if(!session.accountToken)return;
  const id=await installationId();
  await requestJson('/growth/v1/mobile/account/reminders/devices',{
    ...authentication(session),method:'DELETE',body:{installationId:id},
  });
}
function expoProjectId():string {
  const project=process.env.EXPO_PUBLIC_PACKONE_EXPO_PROJECT_ID||
    Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if(typeof project!=='string'||!project.trim())
    throw Error('Push setup requires the Pack One Expo project ID in this app build.');
  return project;
}
async function readPushToken() {
  if (Platform.OS!=='ios'&&Platform.OS!=='android')throw Error('Push notifications are available on iOS and Android only.');
  if(Platform.OS==='android') {
    await Notifications.setNotificationChannelAsync('daily-reminders',{
      name:'Daily reminders',importance:Notifications.AndroidImportance.DEFAULT,
      description:'Optional reminder to play the three current Dailies',
      showBadge:false,
    });
  }
  const push=await Notifications.getExpoPushTokenAsync({projectId:expoProjectId()});
  if(!push?.data)throw Error('This device could not obtain a push token.');
  return push.data;
}
function granted(permission:Notifications.NotificationPermissionsStatus) {
  return permission.granted ||
    (Platform.OS==='ios'&&permission.ios?.status===Notifications.IosAuthorizationStatus.PROVISIONAL);
}
export class PushPermissionDenied extends Error {}
export async function enablePushOnDevice(session:MobileSession) {
  // The only path requesting a platform prompt is a deliberate Enable Push tap.
  let permission=await Notifications.getPermissionsAsync();
  if(!granted(permission))permission=await Notifications.requestPermissionsAsync();
  if(!granted(permission))throw new PushPermissionDenied('Notifications are blocked. Open device Settings to allow Pack One notifications.');
  const token=await readPushToken();
  await requestJson('/growth/v1/mobile/account/reminders/devices',{
    ...authentication(session),method:'POST',
    body:{installationId:await installationId(),token,platform:Platform.OS},
  });
}
export async function refreshGrantedPushRegistration(session:MobileSession) {
  if(!session.accountToken)return;
  const permission=await Notifications.getPermissionsAsync();
  if(!granted(permission))return;
  const current=await loadNativeReminders(session);
  if(!current.push.enabled)return;
  const token=await readPushToken();
  await requestJson('/growth/v1/mobile/account/reminders/devices',{
    ...authentication(session),method:'POST',
    body:{installationId:await installationId(),token,platform:Platform.OS},
  });
}
