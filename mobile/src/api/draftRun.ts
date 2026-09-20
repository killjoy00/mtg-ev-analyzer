import { requestJson } from '@/src/api/client';

export type DraftRunHealth = {
  ok: boolean;
  service?: string;
  release?: string;
  run_length?: number;
  scoring_version?: string;
  corpus_version?: string;
};

export function loadDraftRunHealth() {
  return requestJson<DraftRunHealth>('/draft/health?quick=1', { timeoutMs: 10_000 });
}
