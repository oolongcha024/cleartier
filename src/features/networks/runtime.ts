import type { CoreState, NetworkConfig } from './model.ts';

export type RuntimeOperation =
  | { action: 'start' | 'restart'; id: string; config: NetworkConfig }
  | { action: 'stop'; id: string };
export interface RuntimeFailure { code: string }
export interface RuntimeSnapshot {
  id: string; state: CoreState; runningConfig: NetworkConfig | null;
  deviceName: string; virtualIp: string | null; peerCount: number; directPeerCount: number;
  error: RuntimeFailure | null;
}
// Native commands acknowledge only verified instance readiness, followed by
// authoritative snapshots. Only the browser's demo Adapter synthesizes a state.
export type NetworkRuntime = ((operation: RuntimeOperation) => Promise<RuntimeSnapshot[] | void>) & {
  snapshot?: () => Promise<RuntimeSnapshot[]>;
};
export function runtimeFailure(error: unknown): RuntimeFailure {
  const code = (error as RuntimeFailure | null)?.code;
  return { code: typeof code === 'string' ? code : 'operation_failed' };
}
export function createDemoRuntime(): NetworkRuntime {
  return async () => { await new Promise((resolve) => setTimeout(resolve, 900)); };
}
