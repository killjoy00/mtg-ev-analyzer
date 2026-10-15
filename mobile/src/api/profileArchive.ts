import { requestJson } from '@/src/api/client';
import type { SetCatalog } from '@/src/api/catalog';
import { checkedArchive } from '@/src/state/profileActivity';

let pendingCoverage: Promise<SetCatalog> | null = null;

// The serving endpoint publishes only Live environments; the historical
// replay catalog must not be used for player progress or environment lists.
export async function loadProfileCoverage(): Promise<SetCatalog> {
  if (!pendingCoverage) {
    pendingCoverage = requestJson<SetCatalog>('/draft/v1/set-catalog', {
      credentials: 'omit', timeoutMs: 15_000,
    }).then(result => {
      if (!result || typeof result.corpus_version !== 'string' || !Array.isArray(result.sets) || result.sets.length > 500
        || result.sets.some(entry => !entry || typeof entry.set_id !== 'string'
          || [entry.set_name, entry.data_date].some(value => value != null && typeof value !== 'string')
          || ![entry.verified_decisions, entry.qualified_trophy_drafts, entry.training_drafts].every(Number.isFinite))) {
        throw new Error('Live coverage could not be verified.');
      }
      return result;
    }).finally(() => { pendingCoverage = null; });
  }
  return pendingCoverage;
}

export async function loadProfileArchive() {
  return checkedArchive(await loadProfileCoverage());
}
