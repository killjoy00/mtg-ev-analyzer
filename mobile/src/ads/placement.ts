/** iOS 1.2 has only AdMob on the Daily home. Android retains its existing
 * affiliate promotion until Android AdMob is separately authorized.
 * Neither platform shows promos during gameplay, card review, or results. */
export type DailyPromotion = 'none' | 'admob' | 'affiliate';

export function dailyHomePromotion(
  eligible: boolean | null,
  adMobEnabled: boolean,
  platform: 'ios' | 'android' = 'ios',
): DailyPromotion {
  if (eligible !== true) return 'none';
  if (adMobEnabled) return 'admob';
  return platform === 'android' ? 'affiliate' : 'none';
}
