import { rewriteIncomingPath } from '@/src/linking';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return rewriteIncomingPath(path);
}
