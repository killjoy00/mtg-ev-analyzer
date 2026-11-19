/** Only one promotion on the Daily home: AdMob when explicitly enabled,
 * otherwise Android's existing affiliate placement. No ads on gameplay,
 * card review, results, or for users without fresh ad eligibility. */
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
