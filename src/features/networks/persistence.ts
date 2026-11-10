import type { PeerIconPreferences } from './peer-icons.ts';
import { createNetworkConfig } from './defaults.ts';
import type { Network, NetworkConfig, NetworkIcon } from './model.ts';

export interface NetworkRecord {
  id: string;
  client: {
    alias: string;
    icon: NetworkIcon;
    autoConnect: boolean;
    peerIcons?: PeerIconPreferences;
    [field: string]: unknown;
  };
  config: NetworkConfig;
  [field: string]: unknown;
}
export interface ConfigurationDocument {
  version: 1;
  revision: string;
  selectedId: string;
  networks: NetworkRecord[];
  [field: string]: unknown;
}
export interface ConfigurationStorage {
  load: () => Promise<ConfigurationDocument>;
  save: (
    document: ConfigurationDocument,
    expectedRevision: string,
  ) => Promise<ConfigurationDocument>;
  restore: () => Promise<ConfigurationDocument>;
}
export interface StorageFailure {
  code: string;
  backupAvailable: boolean;
}
export function storageFailure(error: unknown): StorageFailure {
  const value = error as Partial<StorageFailure> | null;
  return {
    code: typeof value?.code === 'string' ? value.code : 'io',
    backupAvailable: value?.backupAvailable === true,
  };
}
export function emptyDocument(): ConfigurationDocument {
  return { version: 1, revision: '', selectedId: '', networks: [] };
}
export function offlineNetwork(
  id: string,
  config = createNetworkConfig(id, { name: '', secret: '', servers: [] }),
): Network {
  return {
    id,
    alias: config.name,
    icon: 'hub',
    peerIcons: {},
    autoConnect: false,
    savedConfig: config,
    editRevision: 0,
    persisted: true,
    runningConfig: null,
    recoveryConfig: null,
    recovery: null,
    coreState: 'stopped',
    operation: null,
    connectionError: null,
    virtualIp: '',
    deviceName: '',
    peerCount: 0,
    directPeerCount: 0,
  };
}
export function networksFromDocument(document: ConfigurationDocument): Network[] {
  return document.networks.map(({ id, client, config }) => ({
    ...offlineNetwork(id, structuredClone(config)),
    alias: client.alias,
    icon: client.icon,
    peerIcons: structuredClone(client.peerIcons ?? {}),
    autoConnect: client.autoConnect,
    editRevision: 0,
  }));
}
export function documentFromNetworks(
  previous: ConfigurationDocument,
  networks: Network[],
  selectedId: string,
): ConfigurationDocument {
  return {
    ...previous,
    selectedId,
    networks: networks
      .filter((network) => network.persisted)
      .map((network) => {
        const previousRecord = previous.networks.find((record) => record.id === network.id);
        return {
          ...previousRecord,
          id: network.id,
          client: {
            ...previousRecord?.client,
            alias: network.alias,
            icon: network.icon,
            autoConnect: network.autoConnect,
            peerIcons: structuredClone(network.peerIcons ?? {}),
          },
          config: structuredClone(network.savedConfig),
        };
      }),
  };
}

// In-memory storage implements the same revision checks for development and tests.
export function createMemoryStorage(initial = emptyDocument()): ConfigurationStorage {
  let document = structuredClone(initial);
  let revision = 0;
  return {
    load: async () => structuredClone(document),
    restore: async () => structuredClone(document),
    save: async (next, expected) => {
      if (document.revision !== expected) throw { code: 'conflict' };
      document = { ...structuredClone(next), revision: `memory-${++revision}` };
      return structuredClone(document);
    },
  };
}
