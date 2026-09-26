import { requestJson } from '@/src/api/client';
import type { SetCatalog } from '@/src/api/catalog';
import { checkedArchive } from '@/src/state/profileActivity';

// This is the same published catalog used by web profile-core.environmentProgress,
// not the live-only serving catalog. Never follow manifest paths from this file.
export async function loadProfileArchive() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://packone.pro/data/catalog.json', {
      credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new Error('The published archive catalog could not be loaded.');
    const text = await response.text();
    if (text.length > 256_000) throw new Error('The published archive catalog is too large.');
    return checkedArchive(JSON.parse(text));
  } finally { clearTimeout(timer); }
}

export async function loadProfileCoverage() {
  const result = await requestJson<SetCatalog>('/draft/v1/set-catalog', { credentials: 'omit', timeoutMs: 15_000 });
  if (!result || typeof result.corpus_version !== 'string' || !Array.isArray(result.sets) || result.sets.length > 500
    || result.sets.some((entry) => !entry || typeof entry.set_id !== 'string'
      || [entry.set_name, entry.data_date].some((value) => value != null && typeof value !== 'string')
      || ![entry.verified_decisions, entry.qualified_trophy_drafts, entry.training_drafts].every(Number.isFinite))) {
    throw new Error('Live coverage could not be verified.');
  }
  return result;
}
