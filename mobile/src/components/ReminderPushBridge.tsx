import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { config } from '@/src/config';
import { refreshGrantedPushRegistration,unregisterReminderDevice } from '@/src/api/reminders';
import { readSession,subscribeSession,type MobileSession } from '@/src/storage/session';

function belongsToCurrentAccount(data:unknown,session:MobileSession|null) {
  if(!data||typeof data!=='object'||!session?.accountToken||!session.accountUser?.id)return false;
  const body=data as {screen?:unknown;owner?:unknown};
  return body.screen==='daily'&&body.owner===session.accountUser.id;
}
if(!config.screenshots.fixtures) {
  Notifications.setNotificationHandler({
    handleNotification:async notification=>{
      const session=await readSession().catch(()=>null);
      const show=belongsToCurrentAccount(notification.request.content.data,session);
      return {shouldShowBanner:show,shouldShowList:show,shouldPlaySound:false,shouldSetBadge:false};
    },
  });
}
export function ReminderPushBridge() {
  const root=useRootNavigationState();
  const ready=Boolean(root?.key);
  const previous=useRef<MobileSession|null>(null);
  useEffect(()=>{
    if(config.screenshots.fixtures)return;
    let mounted=true;
    const refresh=(session:MobileSession|null)=>{
      if(mounted&&session?.accountToken)
        void refreshGrantedPushRegistration(session).catch(()=>{/* Never prompt or log a token here. */});
    };
    const onSession=(next:MobileSession|null)=>{
      const old=previous.current;
      previous.current=next;
      if(old?.accountUser?.id&&old.accountUser.id!==next?.accountUser?.id) {
        // Device notifications remaining from the former account must not be
        // displayed after account change. Backend unregister is owner-scoped.
        void Notifications.dismissAllNotificationsAsync().catch(()=>{});
        void unregisterReminderDevice(old).catch(()=>{});
      }
      refresh(next);
    };
    void readSession().then(session=>{if(mounted)onSession(session);}).catch(()=>{});
    const unsubscribe=subscribeSession(onSession);
    const rotated=Notifications.addPushTokenListener(()=>{
      void readSession().then(refresh).catch(()=>{});
    });
    const resumed=AppState.addEventListener('change',state=>{
      if(state==='active')void readSession().then(refresh).catch(()=>{});
    });
    return ()=>{mounted=false;unsubscribe();rotated.remove();resumed.remove();};
  },[]);
  useEffect(()=>{
    if(config.screenshots.fixtures||!ready)return;
    let mounted=true;
    async function handle(response:Notifications.NotificationResponse|null|undefined) {
      if(!response||!mounted||!ready)return;
      const data=response.notification.request.content.data;
      const session=await readSession().catch(()=>null);
      if(!belongsToCurrentAccount(data,session)) {
        await Notifications.clearLastNotificationResponseAsync().catch(()=>{});
        return;
      }
      router.navigate('/');
      await Notifications.clearLastNotificationResponseAsync().catch(()=>{});
    }
    const listener=Notifications.addNotificationResponseReceivedListener(response=>{void handle(response);});
    void Notifications.getLastNotificationResponseAsync().then(handle).catch(()=>{});
    return ()=>{mounted=false;listener.remove();};
  },[ready]);
  return null;
}
