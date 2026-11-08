import { invoke } from '@tauri-apps/api/core';
import type { ConfigurationDocument, ConfigurationStorage } from '../features/networks/persistence';

// The desktop's sole durable configuration source. Browser preview never calls
// these commands or falls back to demo data after a native storage error.
export const desktopConfigurationStorage: ConfigurationStorage = {
  load: () => invoke<ConfigurationDocument>('config_load'),
  save: (document, expectedRevision) => invoke<ConfigurationDocument>('config_save', { document, expectedRevision }),
  restore: () => invoke<ConfigurationDocument>('config_restore'),
};

// Reading status never launches or elevates a core process.
export function readNetworkSnapshot() {
  return invoke<{ id: string; running: boolean | null }[]>('core_snapshot');
}
