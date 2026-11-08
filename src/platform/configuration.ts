import { invoke } from '@tauri-apps/api/core';
import type { ConfigurationDocument, ConfigurationStorage } from '../features/networks/persistence';
import type { NetworkRuntime, RuntimeFrame } from '../features/networks/runtime';

export const desktopConfigurationStorage: ConfigurationStorage = {
  load: () => invoke<ConfigurationDocument>('config_load'),
  save: (document, expectedRevision) => invoke<ConfigurationDocument>('config_save', { document, expectedRevision }),
  restore: () => invoke<ConfigurationDocument>('config_restore'),
};
const operation = (action: string, id: string, config?: Parameters<NetworkRuntime['start']>[1]) =>
  invoke<RuntimeFrame>('network_operation', { operation: { action, id, ...(config ? { config } : {}) } });
export const desktopNetworkRuntime: NetworkRuntime = {
  snapshot: () => invoke<RuntimeFrame>('network_snapshot'),
  start: (id, config) => operation('start', id, config),
  restart: (id, config) => operation('restart', id, config),
  stop: (id) => operation('stop', id),
  confirmQuiescent: (id) => operation('release', id),
};
