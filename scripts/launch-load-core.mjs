import assert from 'node:assert/strict';

// Requalify the supported level on ordinary PRs. Higher load is an explicit
// experiment; identities, quota state and every route budget remain intact.
export function selectNatPolicy(envelope,target='25') {
  assert.ok(target==='25'||target==='50','capacity_target_must_be_25_or_50');
  assert.equal(envelope.version,2);assert.equal(envelope.supported_launch_target,25);
  assert.deepEqual(envelope.nat_stages,[25,50]);
  return {...structuredClone(envelope),nat_stages:envelope.nat_stages.filter(players=>players<=Number(target))};
}
