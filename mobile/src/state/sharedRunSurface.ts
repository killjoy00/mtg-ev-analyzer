import type { DraftRunState } from '@/src/api/draftRun';
import type { MobileSession } from '@/src/storage/session';

/** The normal DraftRun view consumes this without owning invitation/start authority. */
export type SharedRunSurface = {
  initialRun: DraftRunState;
  session: MobileSession;
  loadRun: () => Promise<DraftRunState>;
  submitPick: (run: DraftRunState, cardId: string) => Promise<DraftRunState>;
  createShare: () => Promise<{ id: string }>;
};
