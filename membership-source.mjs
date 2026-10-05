// Where Elite on a Pack One account comes from, read from the membership status
// response. `capabilities` there is Patreon provenance only; `account_capabilities`
// covers every source (Patreon, the Apple App Store subscription, manual grants).
// Pages use the source to avoid sending an Apple subscriber to Patreon.
const ELITE_CAPABILITIES = ['custom_corpus', 'unlimited_cube_practice'];

const hasElite = (list) => Array.isArray(list) && ELITE_CAPABILITIES.every((capability) => list.includes(capability));

export function eliteSource(status) {
  if (hasElite(status?.capabilities)) return 'patreon';
  if (!hasElite(status?.account_capabilities)) return null;
  return status?.apple_subscription_active === true ? 'apple' : 'other';
}
