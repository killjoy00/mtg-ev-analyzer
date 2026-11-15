import { Platform } from 'react-native';
import { requestJson } from '@/src/api/client';
import { readSession } from '@/src/storage/session';

const visitId = `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const names = new Set(['membership_offer_viewed', 'membership_purchase_clicked', 'membership_checkout_started',
  'membership_restore_started', 'membership_verification_succeeded', 'membership_purchase_cancelled',
  'membership_purchase_failed', 'membership_connection_started']);
// UX telemetry only. Verified subscriptions and premium runs remain server-owned.
export async function trackMembershipEvent(name: string, source: 'apple' | 'patreon' | 'membership', outcome?: string) {
  if (!names.has(name)) return;
  try {
    const session = await readSession();
    if (!session?.playerToken) return;
    await requestJson('/growth/v1/events', { method: 'POST', credentials: 'omit',
      mobileSessionToken: session.playerToken, timeoutMs: 5000,
      body: { events: [{ name, props: { source, context: Platform.OS,
        session_id: visitId, ...(outcome ? { outcome } : {}) } }] } });
  } catch { /* Metrics cannot block membership or billing. */ }
}
