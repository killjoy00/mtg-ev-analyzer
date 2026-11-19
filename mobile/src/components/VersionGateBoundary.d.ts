import type { ReactNode } from 'react';
import type { AppStateStatus } from 'react-native';

import type { VersionGateDecision } from '@/src/versionPolicy';

type RequiredDecision = Extract<VersionGateDecision, { status: 'required' }>;

type VersionGateBoundaryProps = {
  children: ReactNode;
  checkVersion: () => Promise<VersionGateDecision>;
  initialAppState: AppStateStatus;
  subscribe: (listener: (nextState: AppStateStatus) => void) => () => void;
  checkingFallback: ReactNode;
  renderRequired: (decision: RequiredDecision) => ReactNode;
};

export function VersionGateBoundary(props: VersionGateBoundaryProps): ReactNode;
