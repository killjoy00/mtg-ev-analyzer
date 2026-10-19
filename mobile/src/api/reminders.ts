import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { requestJson } from '@/src/api/client';
import { readSession, type MobileSession } from '@/src/storage/session';

export type ReminderSchedule = {
  frequency: 'daily' | 'weekly' | 'custom';
  weekdays: number[];
  localTime: string;
  timeZone: string;
};
export type ReminderSnapshot = {
  schedule: ReminderSchedule;
  email: { enabled: boolean; eligible: boolean; suppressed: boolean; consentedAt: string | null; deliveredAt: string | null; lastAttempt?:{state:string;acceptedAt:string|null;deliveredAt:string|null}|null; deliveryActive?:boolean; addressChanged?:boolean };
  push: { enabled: boolean; consentedAt: string | null; providerAcceptedAt: string | null; lastAttempt?:{state:string;acceptedAt:string|null;platformReceipt:string|null}|null; deliveryActive?:boolean; registeredDevices?:number };
  nextAt: string | null;
  deliveryActive: boolean;
  // Provider acceptance and platform receipt are not equivalent to confirmed device display.
  // Email delivery is confirmed only by an authenticated Resend event.
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
  bytes[6]=((bytes[6] ?? 0)&15)|64;bytes[8]=((bytes[8] ?? 0)&63)|128;
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
const BINDING_KEY='packone.push.binding.v1';
type DeviceBinding={installationId:string;owner:string|null;bindingSecret:string;registrationVersion:number;consented:boolean};
let deviceQueue:Promise<unknown>=Promise.resolve();
function serializeDevice<T>(task:()=>Promise<T>):Promise<T> {
  const next=deviceQueue.then(task,task);
  deviceQueue=next.catch(()=>undefined);
  return next;
}
async function binding():Promise<DeviceBinding|null> {
  const raw=await SecureStore.getItemAsync(BINDING_KEY);
  if(!raw)return null;
  try {
    const value=JSON.parse(raw) as Partial<DeviceBinding>;
    if(typeof value.installationId==='string'&&typeof value.bindingSecret==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value.bindingSecret)&&
      Number.isSafeInteger(value.registrationVersion)&&Number(value.registrationVersion)>0)
      return value as DeviceBinding;
  }catch{ /* Malformed local metadata cannot grant consent. */ }
  return null;
}
async function persistBinding(value:DeviceBinding) {
  await SecureStore.setItemAsync(BINDING_KEY,JSON.stringify(value),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
}
function identity(session:MobileSession|null) {
  return session?.accountToken&&session.accountUser?.id?session.accountUser.id+':'+session.accountToken:'';
}
export async function assertReminderAccount(session:MobileSession) {
  if(!identity(session)||identity(await readSession())!==identity(session))throw Error('Account changed. Open reminder settings for the current account.');
}
export async function loadNativeReminders(session: MobileSession) {
  await assertReminderAccount(session);
  return requestJson<ReminderSnapshot>('/growth/v1/mobile/account/reminders',authentication(session));
}
export async function saveNativeReminders(session:MobileSession,channel:ReminderChannel,enabled:boolean,schedule:ReminderSchedule) {
  await assertReminderAccount(session);
  return requestJson<ReminderSnapshot>('/growth/v1/mobile/account/reminders',{
    ...authentication(session),method:'PATCH',body:{channel,enabled,...schedule,expectedAccountId:session.accountUser?.id},
  });
}
export async function reminderDeviceEnabled(session:MobileSession) {
  const current=await binding();
  return Boolean(current?.consented&&current.owner===session.accountUser?.id);
}
export function clearLocalReminderConsent() {
  return serializeDevice(async()=>{
    const current=await binding();
    if(current)await persistBinding({...current,consented:false,owner:null});
    await Notifications.dismissAllNotificationsAsync().catch(()=>{});
  });
}
async function unregisterNow(session:MobileSession) {
  if(!session.accountToken)return;
  const current=await binding();
  if(!current||current.owner!==session.accountUser?.id)return;
  // Mark off before awaiting the network so foreground notifications cannot
  // appear while an account switch is removing the old server registration.
  await persistBinding({...current,consented:false});
  const result=await requestJson<{ok:boolean;registrationVersion:number|null}>('/growth/v1/mobile/account/reminders/devices',{
    ...authentication(session),method:'DELETE',body:{installationId:current.installationId},
  });
  await persistBinding({...current,consented:false,registrationVersion:result.registrationVersion??current.registrationVersion});
  await Notifications.dismissAllNotificationsAsync().catch(()=>{});
}
export function unregisterReminderDevice(session:MobileSession) {return serializeDevice(()=>unregisterNow(session));}
function expoProjectId():string {
  const project=process.env.EXPO_PUBLIC_PACKONE_EXPO_PROJECT_ID||Constants.easConfig?.projectId||
    Constants.expoConfig?.extra?.notifications?.projectId||Constants.expoConfig?.extra?.eas?.projectId;
  if(typeof project!=='string'||!project.trim())throw Error('Push setup requires the Pack One Expo project ID in this signed app build.');
  return project;
}
async function prepareChannel() {
  if(Platform.OS!=='ios'&&Platform.OS!=='android')throw Error('Push notifications are available on iOS and Android only.');
  // Android 13+ needs a channel before the explicit runtime-permission prompt.
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('daily-reminders',{
    name:'Daily reminders',importance:Notifications.AndroidImportance.DEFAULT,
    description:'Optional reminder to play the three current Dailies',showBadge:false,
  });
}
function granted(permission:Notifications.NotificationPermissionsStatus) {
  return permission.granted||(Platform.OS==='ios'&&permission.ios?.status===Notifications.IosAuthorizationStatus.PROVISIONAL);
}
export class PushPermissionDenied extends Error {}
async function registerNow(session:MobileSession,explicitEnable:boolean) {
  await assertReminderAccount(session);
  const previous=await binding();
  const projectId=expoProjectId();
  const token=await Notifications.getExpoPushTokenAsync({projectId});
  await assertReminderAccount(session);
  if(!token?.data)throw Error('This device could not obtain a push token. Try again on a physical device with a signed build.');
  const id=previous?.installationId||await installationId();
  const result=await requestJson<{ok:boolean;bindingSecret?:string;registrationVersion:number}>('/growth/v1/mobile/account/reminders/devices',{
    ...authentication(session),method:'POST',body:{installationId:id,token:token.data,platform:Platform.OS,explicitEnable,
      ...(previous?{bindingSecret:previous.bindingSecret,registrationVersion:previous.registrationVersion}:{})},
  });
  const secret=result.bindingSecret||previous?.bindingSecret;
  if(!secret||!Number.isSafeInteger(result.registrationVersion))throw Error('Device registration could not be confirmed.');
  // Serialize publication and the logout/account-switch unregistration. A late
  // registration response cannot overwrite B's device after A has signed out.
  await persistBinding({installationId:id,owner:session.accountUser?.id||null,bindingSecret:secret,
    registrationVersion:result.registrationVersion,consented:true});
  if(identity(await readSession())!==identity(session)) {
    await unregisterNow(session);
    throw Error('Account changed before notifications were enabled.');
  }
}
export function enablePushOnDevice(session:MobileSession) {
  return serializeDevice(async()=>{
    await assertReminderAccount(session);
    expoProjectId();
    await prepareChannel();
    let permission=await Notifications.getPermissionsAsync();
    await assertReminderAccount(session);
    // This is the only path requesting a platform permission dialog.
    if(!granted(permission))permission=await Notifications.requestPermissionsAsync();
    await assertReminderAccount(session);
    if(!granted(permission))throw new PushPermissionDenied('Notifications are blocked. Open device Settings to allow Pack One notifications.');
    await registerNow(session,true);
  });
}
export function refreshGrantedPushRegistration(session:MobileSession) {
  return serializeDevice(async()=>{
    if(!session.accountToken)return;
    await assertReminderAccount(session);
    const current=await binding();
    // Global account consent is not consent to enroll a new installation.
    if(!current?.consented||current.owner!==session.accountUser?.id)return;
    const permission=await Notifications.getPermissionsAsync();
    await assertReminderAccount(session);
    if(!granted(permission)){await unregisterNow(session);return;}
    const settings=await loadNativeReminders(session);
    await assertReminderAccount(session);
    if(!settings.push.enabled){await unregisterNow(session);return;}
    await prepareChannel();
    try {await registerNow(session,false);} catch(error) {
      const failure=error as {status?:number;body?:{code?:string}};
      if(failure.status===409&&['DEVICE_VERSION_CHANGED','DEVICE_PROOF_REQUIRED','DEVICE_STILL_ATTACHED'].includes(failure.body?.code||'')) {
        await assertReminderAccount(session);
        await persistBinding({...current,consented:false});
        await Notifications.dismissAllNotificationsAsync().catch(()=>{});
      }
      throw error;
    }
  });
}
export async function acceptsReminderNotification(data:unknown,session:MobileSession|null) {
  if(!data||typeof data!=='object'||!session?.accountToken||!session.accountUser?.id)return false;
  const value=data as {screen?:unknown;owner?:unknown;registrationVersion?:unknown};
  const current=await binding();
  return Boolean(current?.consented&&current.owner===session.accountUser.id&&value.screen==='daily'&&
    value.owner===current.owner&&value.registrationVersion===current.registrationVersion&&identity(await readSession())===identity(session));
}
