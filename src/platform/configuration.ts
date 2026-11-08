import { invoke } from '@tauri-apps/api/core';
import type { ConfigurationDocument, ConfigurationStorage } from '../features/networks/persistence';
import type { NetworkRuntime, RuntimeSnapshot } from '../features/networks/runtime';

// The desktop's sole durable configuration source. Browser preview never calls
// these commands or falls back to demo data after a native storage error.
export const desktopConfigurationStorage: ConfigurationStorage = {
  load: () => invoke<ConfigurationDocument>('config_load'),
  save: (document, expectedRevision) => invoke<ConfigurationDocument>('config_save', { document, expectedRevision }),
  restore: () => invoke<ConfigurationDocument>('config_restore'),
};

export const desktopNetworkRuntime: NetworkRuntime = Object.assign(
  (operation: Parameters<NetworkRuntime>[0]) => invoke<RuntimeSnapshot[]>('network_operation', { operation }),
  { snapshot: () => invoke<RuntimeSnapshot[]>('network_snapshot') },
);
