import { requestJson } from '@/src/api/client';

export type SetCatalogEntry = {
  set_id: string;
  set_name?: string | null;
  release_date?: string | null;
  regular_run: boolean;
  data_date?: string | null;
  training_drafts: number;
  win_rate_cutoff?: number | null;
  qualified_trophy_drafts: number;
  verified_decisions: number;
};

export type SetCatalog = {
  corpus_version: string;
  sets: SetCatalogEntry[];
};

export function loadSetCatalog() {
  return requestJson<SetCatalog>('/draft/v1/set-catalog', { timeoutMs: 15_000 });
}
