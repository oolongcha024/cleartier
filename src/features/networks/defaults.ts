import type { NetworkConfig } from './model';

export function defaultTunName(id: string, reservedNames: string[] = []): string {
  // Stable local instance identity, independent from aliases and connection order.
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  const base = `ct-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  const reserved = new Set(reservedNames.map((name) => name.toLowerCase()));
  let candidate = base;
  for (let suffix = 1; reserved.has(candidate.toLowerCase()); suffix++) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, 15 - tail.length)}${tail}`;
  }
  return candidate;
}

export function createNetworkConfig(id: string, identity: Pick<NetworkConfig, 'name' | 'secret' | 'servers'>): NetworkConfig {
  return { ...identity, hostname: null, ipv4Mode: 'auto', ipv4Address: '', ipv4Prefix: 24,
    tunName: defaultTunName(id), mtu: null, ipv6: true, p2pPolicy: 'auto', latencyFirst: false,
    tcpHolePunching: true, udpHolePunching: true, upnp: true,
    magicDns: false, dnsSuffix: 'et.net.', udpBroadcastRelay: false };
}
