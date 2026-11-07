// Core lifecycle and connected peers are separate facts. A real adapter should
// map EasyTier snapshots/events here, rather than equate `running` with connected.
export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping';
export const networkIcons = ['work', 'sports_esports', 'home', 'hub', 'dns', 'public'] as const;
export type NetworkIcon = typeof networkIcons[number];
export const p2pPolicies = ['auto', 'lazy', 'disabled', 'only'] as const;
export type P2pPolicy = typeof p2pPolicies[number];
export interface Peer {
  id: string; name: string; ip: string;
  platform: 'desktop_windows' | 'laptop_mac' | 'dns';
  connection: 'direct' | 'relay'; latency: number;
}
export interface NetworkConfig {
  name: string; secret: string; servers: string[];
  hostname: string | null;
  ipv4Mode: 'auto' | 'manual'; ipv4Address: string; ipv4Prefix: number;
  tunName: string; mtu: number | null; ipv6: boolean;
  p2pPolicy: P2pPolicy; latencyFirst: boolean;
  tcpHolePunching: boolean; udpHolePunching: boolean; upnp: boolean;
  magicDns: boolean; dnsSuffix: string; udpBroadcastRelay: boolean;
}
export interface Network {
  id: string; alias: string; icon: NetworkIcon;
  savedConfig: NetworkConfig;
  // A saved edit must not masquerade as the configuration of a live session.
  runningConfig: NetworkConfig | null;
  coreState: CoreState; autoConnect: boolean; virtualIp: string; entryLatency: number;
  peers: Peer[]; download: number; upload: number;
  traffic: { download: number[]; upload: number[] };
  // Byte counters for this machine in this network; null means no session recorded.
  // Keep the last snapshot on disconnect. These are independent from rates (MB/s).
  trafficTotals: { downloadBytes: number; uploadBytes: number } | null;
}
export const isConnected = (network: Network) => network.coreState === 'running' && network.peers.length > 0;
export const isBusy = (network: Network) => network.coreState === 'starting' || network.coreState === 'stopping';
export const activePeers = (network: Network) => network.coreState === 'running' ? network.peers : [];
export const activeVirtualIp = (network: Network) => network.runningConfig?.ipv4Mode === 'manual'
  ? network.runningConfig.ipv4Address : network.virtualIp;
export function statusKey(network: Network) {
  if (network.coreState === 'stopped') return 'idle';
  if (network.coreState === 'starting') return 'startingShort';
  if (network.coreState === 'stopping') return 'stoppingShort';
  return network.peers.length > 0 ? 'connectedShort' : 'running';
}
