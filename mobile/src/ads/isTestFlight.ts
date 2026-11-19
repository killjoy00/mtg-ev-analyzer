import { Platform } from 'react-native';

/**
 * Runtime-only test distribution check. Expo SDK 57's release-type helper
 * treats TestFlight and App Store as the same type, so require StoreKit's
 * signed AppTransaction.environment as well.
 *
 * Return false if StoreKit is unavailable/offline/unverified. Public App Store
 * builds use the production environment and must never display ad diagnostics.
 * Sandbox includes App Review, so this must only affect a support UI and
 * never entitlements, pricing, advertising consent or purchase logic.
 */
export async function isTestFlightEnvironment(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const [Application, IAP] = await Promise.all([
      import('expo-application'),
      import('expo-iap'),
    ]);
    const releaseType = await Application.getIosApplicationReleaseTypeAsync();
    if (releaseType !== Application.ApplicationReleaseType.APP_STORE) return false;
    const appTransaction = await IAP.getAppTransactionIOS();
    return appTransaction?.environment?.toLowerCase() === 'sandbox';
  } catch {
    // Diagnostics are strictly optional; missing verification hides the UI.
    return false;
  }
}
