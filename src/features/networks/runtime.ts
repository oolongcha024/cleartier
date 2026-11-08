import type { TelemetrySnapshot } from './telemetry.ts';
import type { CoreState, NetworkConfig } from './model.ts';

export interface RuntimeFailure { code: string }
export interface RecoverySnapshot {
  phase: 'waiting' | 'starting' | 'exhausted' | 'authorization' | 'stopped';
  attempt: number; maxAttempts: number; retryInSeconds: number;
}
export interface RuntimeSnapshot {
  id: string; revision: number; state: CoreState;
  runningConfig: NetworkConfig | null; recoveryConfig: NetworkConfig | null;
  recovery: RecoverySnapshot | null; telemetry: TelemetrySnapshot | null;
  deviceName: string; virtualIp: string | null; peerCount: number; directPeerCount: number;
  error: RuntimeFailure | null;
}
export interface RuntimeFrame {
  epoch: string;
  health: 'initializing' | 'ready' | 'stale';
  error: RuntimeFailure | null;
  networks: RuntimeSnapshot[];
}
// Every adapter reports observations, including the in-memory browser runtime.
// Successful commands acknowledge readiness/cleanup, never mere acceptance.
export interface NetworkRuntime {
  snapshot(): Promise<RuntimeFrame>;
  start(id: string, config: NetworkConfig): Promise<RuntimeFrame>;
  stop(id: string): Promise<RuntimeFrame>;
  restart(id: string, config: NetworkConfig): Promise<RuntimeFrame>;
  confirmQuiescent(id: string): Promise<RuntimeFrame>;
}
export function runtimeFailure(error: unknown): RuntimeFailure {
  const code = (error as RuntimeFailure | null)?.code;
  return { code: typeof code === 'string' ? code : 'operation_failed' };
}
