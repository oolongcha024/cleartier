import type { PeerIconPreferences } from './peer-icons.ts';
import type { RuntimeSnapshot } from './runtime.ts';

// Core lifecycle and connected peers are separate facts. A real adapter should
// map EasyTier snapshots/events here, rather than equate `running` with connected.
export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping' | 'unknown' | 'failed';
export const networkIcons = ['work', 'sports_esports', 'home', 'hub', 'dns', 'public'] as const;
export type NetworkIcon = typeof networkIcons[number];
export const p2pPolicies = ['auto', 'lazy', 'disabled', 'only'] as const;
export type P2pPolicy = typeof p2pPolicies[number];
export interface Peer {
  id: string; name: string; ip: string | null;
  instanceId?: string | null; publicServer?: boolean;
  connection: 'direct' | 'relay'; latency: number | null;
  lossRate?: number | null; protocols?: string[]; nextHop?: string | null; version?: string | null;
}
export interface NetworkConfig {
  officialToml?: string;
  name: string; secret: string; servers: string[];
  hostname: string | null;
  ipv4Mode: 'auto' | 'manual' | 'none'; ipv4Address: string; ipv4Prefix: number;
  tunName: string; mtu: number | null; ipv6: boolean;
  p2pPolicy: P2pPolicy; latencyFirst: boolean;
  tcpHolePunching: boolean; udpHolePunching: boolean; upnp: boolean;
  magicDns: boolean; dnsSuffix: string; udpBroadcastRelay: boolean;
}
export interface Network {
  id: string; alias: string; icon: NetworkIcon; peerIcons: PeerIconPreferences;
  savedConfig: NetworkConfig; editRevision: number; persisted: boolean;
  runningConfig: NetworkConfig | null; recoveryConfig: NetworkConfig | null;
  recovery: RuntimeSnapshot['recovery']; connectionError: { code: string } | null;
  coreState: CoreState; operation: 'saving' | 'removing' | 'connecting' | 'disconnecting' | 'reconnecting' | null;
  autoConnect: boolean; virtualIp: string; deviceName: string; peerCount: number; directPeerCount: number;
}
export const isConnected = (network: Network) => network.coreState === 'running' && network.peerCount > 0;
export const isBusy = (network: Network) => network.operation !== null || network.coreState === 'starting' || network.coreState === 'stopping';
export const activeVirtualIp = (network: Network) => network.virtualIp;
export const sessionConfig = (network: Network) => network.runningConfig ?? network.recoveryConfig;
export const canRemove = (network: Network) => !isBusy(network) && ['stopped', 'failed'].includes(network.coreState)
  && network.runningConfig === null && network.recoveryConfig === null;
export function statusKey(network: Network) {
  if (network.coreState === 'failed') return 'failed';
  if (network.coreState === 'unknown') return 'unavailable';
  if (network.coreState === 'stopped') return 'idle';
  if (network.coreState === 'starting') return 'startingShort';
  if (network.coreState === 'stopping') return 'stoppingShort';
  return network.peerCount > 0 ? 'connectedShort' : 'running';
}

export function summaryKey(networks: Network[]) {
  if (networks.some(isConnected)) return 'networksOnline';
  if (networks.some((network) => network.coreState === 'unknown')) return 'networksUnknown';
  if (networks.some(isBusy)) return 'networksBusy';
  if (networks.some((network) => network.coreState === 'running')) return 'networksWaiting';
  if (networks.some((network) => network.coreState === 'failed')) return 'networksFailed';
  return 'allOffline';
}
