// Core lifecycle and connected peers are separate facts. A real adapter should
// map EasyTier snapshots/events here, rather than equate `running` with connected.
export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping';
export type NetworkIcon = 'work' | 'sports_esports' | 'home';
export interface Peer {
  id: string; name: string; ip: string;
  platform: 'desktop_windows' | 'laptop_mac' | 'dns';
  connection: 'direct' | 'relay'; latency: number;
}
export interface Network {
  id: string; alias: string; name: string; icon: NetworkIcon;
  coreState: CoreState; autoConnect: boolean; virtualIp: string; entryLatency: number;
  peers: Peer[]; download: number; upload: number;
  traffic: { download: number[]; upload: number[] };
}
export interface NetworkEvent {
  id: string; networkId: string; kind: 'connected' | 'disconnected' | 'direct';
  at: number; peerCount?: number; device?: string; latency?: number;
}
export const isConnected = (network: Network) => network.coreState === 'running' && network.peers.length > 0;
export const isBusy = (network: Network) => network.coreState === 'starting' || network.coreState === 'stopping';
export const activePeers = (network: Network) => network.coreState === 'running' ? network.peers : [];
export function statusKey(network: Network) {
  if (network.coreState === 'stopped') return 'idle';
  if (network.coreState === 'starting') return 'startingShort';
  if (network.coreState === 'stopping') return 'stoppingShort';
  return network.peers.length > 0 ? 'connectedShort' : 'running';
}
