export const APPLE_IAP_PROVIDER='apple-app-store';
export const APPLE_ELITE_PRODUCT_ID='pro.packone.app.elite.monthly';
export const APPLE_BUNDLE_ID='pro.packone.app';
export const APPLE_APP_ID=6814318676;

export function appleSubscriptionAction(path,method) {
  if(method==='GET'&&path==='/v1/apple-subscriptions/mobile/status')return 'status';
  if(method==='POST'&&path==='/v1/apple-subscriptions/mobile/verify')return 'verify';
  if(method==='POST'&&path==='/v1/apple-subscriptions/notifications')return 'notification';
  return null;
}

export function nativeAppleSubscriptionAction(path,method) {
  const action=appleSubscriptionAction(path,method);
  return action==='status'||action==='verify'?action:null;
}
