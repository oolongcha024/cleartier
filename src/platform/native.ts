import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Platform, UpdateSnapshot } from './contracts.ts';
import { watchNativeWindowVisibility } from './native-window.ts';
import type { ConfigurationDocument, ConfigurationStorage } from '../features/networks/persistence';
import type { NetworkRuntime, RuntimeFrame } from '../features/networks/runtime';

const desktopConfigurationStorage: ConfigurationStorage = {
  load: () => invoke<ConfigurationDocument>('config_load'),
  save: (document, expectedRevision) =>
    invoke<ConfigurationDocument>('config_save', { document, expectedRevision }),
  restore: () => invoke<ConfigurationDocument>('config_restore'),
};
const operation = (action: string, id: string, config?: Parameters<NetworkRuntime['start']>[1]) =>
  invoke<RuntimeFrame>('network_operation', {
    operation: { action, id, ...(config ? { config } : {}) },
  });
const desktopNetworkRuntime: NetworkRuntime = {
  snapshot: () => invoke<RuntimeFrame>('network_snapshot'),
  start: (id, config) => operation('start', id, config),
  restart: (id, config) => operation('restart', id, config),
  stop: (id) => operation('stop', id),
  confirmQuiescent: (id) => operation('release', id),
};

export const nativePlatform: Platform = {
  networks: { runtime: desktopNetworkRuntime, storage: desktopConfigurationStorage },
  client: {
    readHostEnvironment: async () => {
      try {
        const [hostname, platform] = await invoke<[string, string]>('host_environment');
        return {
          hostname,
          platform:
            platform === 'windows' || platform === 'linux' || platform === 'macos'
              ? platform
              : 'unknown',
        };
      } catch {
        return { hostname: '', platform: 'unknown', unavailable: true };
      }
    },
    readClientVersion: getVersion,
    readCoreVersion: () => invoke<string>('core_version'),
  },
  updates: {
    read: () => invoke('updates_status'),
    command: (command) => invoke('updates_command', { command }),
    watch: (receive) =>
      listen<UpdateSnapshot>('updates-changed', (event) => receive(event.payload)),
  },
  desktop: {
    read: () => invoke('desktop_status'),
    update: (update) => invoke('desktop_update', { update }),
    watch: (refresh) => listen('desktop-changed', refresh),
    respond: (requestId, choice) => invoke('desktop_respond', { requestId, choice }),
    exit: () => invoke('desktop_exit'),
    readDiagnostics: () => invoke('diagnostics_read'),
    exportDiagnostics: () => invoke('diagnostics_export'),
    openLogs: () => invoke('logs_open'),
  },
  officialConfiguration: {
    pick: () => invoke('toml_import'),
    inspect: (id, config) => invoke('toml_inspect', { id, config }),
    export: (id, config) => invoke('toml_export', { id, config }),
  },
  readJoinParameters: (id, config) => invoke('invitation_parameters', { id, config }),
  writeClipboard: writeText,
  watchWindowVisibility: watchNativeWindowVisibility,
};
