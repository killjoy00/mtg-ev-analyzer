// Activation requires the real campaign/tier IDs and the canary in docs/PATREON.md.
// A supporter tier never implies premium access, regardless of payment amount.
export const PATREON_POLICY = Object.freeze({
  enabled: false,
  campaignId: '16808916',
  premiumTierIds: ['29631843'], // Elite Member; Supporter 29631835 is excluded.
  supportUrl: 'https://www.patreon.com/c/PackOne',
});

export function validPatreonPolicy(policy = PATREON_POLICY) {
  return policy.enabled === true && /^\d+$/.test(policy.campaignId) &&
    policy.premiumTierIds.length > 0 && policy.premiumTierIds.every(id => /^\d+$/.test(id));
}

export function premiumPatreonMembership(member, policy = PATREON_POLICY) {
  if (!validPatreonPolicy(policy) || !member || member.campaignId !== policy.campaignId) return false;
  if (!member.tierIds?.some(id => policy.premiumTierIds.includes(id))) return false;
  if (member.status === 'declined_patron' || /declined|refunded|fraud|deleted/i.test(member.lastChargeStatus || '')) return false;
  // Current tier entitlement, including a still-entitled cancelled subscription,
  // is authoritative. Monetary totals and lifetime support cannot unlock tools.
  return member.status === 'active_patron' || member.status === 'former_patron' || member.isFreeTrial || member.isGifted;
}
