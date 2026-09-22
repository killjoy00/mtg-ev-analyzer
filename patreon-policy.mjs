// Activation requires the real campaign/tier IDs and the canary in docs/PATREON.md.
// A supporter tier never implies premium access, regardless of payment amount.
export const PATREON_POLICY = Object.freeze({
  enabled: true,
  canaryAccountHashes: [],
  campaignId: '16808916',
  premiumTierIds: ['29631843'], // Elite Member; Supporter 29631835 is excluded.
  adFreeTierIds: ['29631835', '29631843'], // Both paid tiers suppress display ads.
  supportUrl: 'https://www.patreon.com/c/PackOne',
});

export function validPatreonPolicy(policy = PATREON_POLICY) {
  return (policy.enabled === true || (policy.canaryAccountHashes?.length > 0 && policy.canaryAccountHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)))) && /^\d+$/.test(policy.campaignId) &&
    policy.premiumTierIds.length > 0 && policy.premiumTierIds.every(id => /^\d+$/.test(id));
}

export function currentPatreonMembership(member, policy = PATREON_POLICY) {
  if (!validPatreonPolicy(policy) || !member || member.campaignId !== policy.campaignId) return false;
  if (member.status === 'declined_patron' || /declined|refunded|fraud|deleted/i.test(member.lastChargeStatus || '')) return false;
  return member.status === 'active_patron' || member.status === 'former_patron' || member.isFreeTrial || member.isGifted;
}

export function premiumPatreonMembership(member, policy = PATREON_POLICY) {
  return qualifyingMembership(member, policy.premiumTierIds, policy);
}

export function adFreePatreonMembership(member, policy = PATREON_POLICY) {
  return qualifyingMembership(member, policy.adFreeTierIds || [], policy);
}

function qualifyingMembership(member, tierIds, policy) {
  if (!currentPatreonMembership(member, policy)) return false;
  if (!member.tierIds?.some(id => tierIds.includes(id))) return false;
  // Current tier entitlement, including a still-entitled cancelled subscription,
  // is authoritative. Monetary totals and lifetime support cannot unlock tools.
  return true;
}
