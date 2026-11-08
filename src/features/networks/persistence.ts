import { createNetworkConfig } from './defaults.ts';
import type { Network, NetworkConfig, NetworkIcon } from './model.ts';

export interface NetworkRecord {
  id: string;
  client: { alias: string; icon: NetworkIcon; autoConnect: boolean; [field: string]: unknown };
  config: NetworkConfig;
  [field: string]: unknown;
}
export interface ConfigurationDocument {
  version: 1; revision: string; selectedId: string; networks: NetworkRecord[];
  [field: string]: unknown;
}
export interface ConfigurationStorage {
  load: () => Promise<ConfigurationDocument>;
  save: (document: ConfigurationDocument, expectedRevision: string) => Promise<ConfigurationDocument>;
  restore: () => Promise<ConfigurationDocument>;
}
export interface StorageFailure { code: string; backupAvailable: boolean }
export function storageFailure(error: unknown): StorageFailure {
  const value = error as Partial<StorageFailure> | null;
  return { code: typeof value?.code === 'string' ? value.code : 'io', backupAvailable: value?.backupAvailable === true };
}
export function emptyDocument(): ConfigurationDocument {
  return { version: 1, revision: '', selectedId: '', networks: [] };
}
export function offlineNetwork(id: string, config = createNetworkConfig(id, { name: '', secret: '', servers: [] })): Network {
  return { id, alias: config.name, icon: 'hub', autoConnect: false, savedConfig: config,
    runningConfig: null, coreState: 'stopped', virtualIp: '', entryLatency: 0, peers: [],
    download: 0, upload: 0, traffic: { download: [], upload: [] }, trafficTotals: null };
}
export function networksFromDocument(document: ConfigurationDocument): Network[] {
  return document.networks.map(({ id, client, config }) => ({ ...offlineNetwork(id, structuredClone(config)),
    alias: client.alias, icon: client.icon, autoConnect: client.autoConnect, peerCount: 0, directPeerCount: 0 }));
}
export function documentFromNetworks(previous: ConfigurationDocument, networks: Network[], selectedId: string): ConfigurationDocument {
  return { ...previous, selectedId, networks: networks.map((network) => {
    const previousRecord = previous.networks.find((record) => record.id === network.id);
    return { ...previousRecord, id: network.id,
      client: { ...previousRecord?.client, alias: network.alias, icon: network.icon, autoConnect: network.autoConnect },
      config: structuredClone(network.savedConfig) };
  }) };
}
