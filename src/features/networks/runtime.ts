import type { NetworkConfig } from './model.ts';

export type RuntimeOperation =
  | { action: 'start' | 'restart'; id: string; config: NetworkConfig }
  | { action: 'stop'; id: string };

// Completion acknowledges the requested transition. This is a preview seam,
// not a definition of EasyTier's future command/event protocol.
export type NetworkRuntime = (operation: RuntimeOperation) => Promise<void>;

export function createDemoRuntime(): NetworkRuntime {
  return async () => { await new Promise((resolve) => setTimeout(resolve, 900)); };
}
