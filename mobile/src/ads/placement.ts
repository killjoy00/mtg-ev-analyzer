/** One Daily-home promotion at most. Ads never appear in a Draft Run or result. */
export type DailyPromotion = 'none' | 'admob' | 'affiliate';

export function dailyHomePromotion(eligible: boolean | null, adMobEnabled: boolean): DailyPromotion {
  if (eligible !== true) return 'none';
  return adMobEnabled ? 'admob' : 'affiliate';
}
