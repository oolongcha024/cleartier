import { networkIcons, p2pPolicies, type Network, type NetworkConfig, type NetworkIcon } from './model.ts';

export interface NetworkDraft extends Omit<NetworkConfig, 'hostname' | 'servers' | 'ipv4Prefix' | 'mtu'> {
  alias: string; icon: NetworkIcon; hostname: string; servers: string; ipv4Prefix: string; mtu: string;
}
export type DraftError = 'nameRequired' | 'serversRequired' | 'serverInvalid' | 'iconInvalid'
  | 'hostnameInvalid' | 'ipv4Invalid' | 'prefixInvalid' | 'prefixNormalized' | 'tunInvalid' | 'tunDuplicate'
  | 'mtuInvalid' | 'dnsInvalid' | 'p2pInvalid';
export type DraftErrors = Partial<Record<keyof NetworkDraft, DraftError>>;
export type UpdateNetworkDraft = <Field extends keyof NetworkDraft>(field: Field, value: NetworkDraft[Field]) => void;

export function configurationDraft(network: Pick<Network, 'savedConfig' | 'alias' | 'icon'>): NetworkDraft {
  return { ...network.savedConfig, alias: network.alias, icon: network.icon,
    hostname: network.savedConfig.hostname ?? '', servers: network.savedConfig.servers.join('\n'),
    ipv4Prefix: String(network.savedConfig.ipv4Prefix), mtu: network.savedConfig.mtu === null ? '' : String(network.savedConfig.mtu) };
}
export function serverAddresses(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}
function validIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) > 0 && Number(parts[0]) < 224 && Number(parts[0]) !== 127;
}
export function validateDraft(draft: NetworkDraft, otherTunNames: string[] = [], original?: NetworkConfig): DraftErrors {
  const errors: DraftErrors = {};
  if (!networkIcons.includes(draft.icon)) errors.icon = 'iconInvalid';
  const imported = draft.officialToml !== undefined;
  if (!draft.name.trim() && !imported) errors.name = 'nameRequired';
  if (Array.from(draft.hostname.trim()).length > 32 || /[\u0000-\u001f\u007f]/.test(draft.hostname)) errors.hostname = 'hostnameInvalid';
  if (draft.ipv4Mode === 'manual') {
    if (!validIpv4(draft.ipv4Address.trim())) errors.ipv4Address = 'ipv4Invalid';
    if (!/^\d+$/.test(draft.ipv4Prefix) || Number(draft.ipv4Prefix) < 1 || Number(draft.ipv4Prefix) > 32) errors.ipv4Prefix = 'prefixInvalid';
    else if (Number(draft.ipv4Prefix) === 32) errors.ipv4Prefix = 'prefixNormalized';
  }
  if (!imported && !/^[a-z\d_-]{1,15}$/i.test(draft.tunName.trim())) errors.tunName = 'tunInvalid';
  else if (draft.tunName && otherTunNames.some((name) => name.toLowerCase() === draft.tunName.trim().toLowerCase())) errors.tunName = 'tunDuplicate';
  if (draft.mtu !== '' && (!/^\d+$/.test(draft.mtu) || Number(draft.mtu) < 400 || Number(draft.mtu) > 1380)) errors.mtu = 'mtuInvalid';
  if (!p2pPolicies.includes(draft.p2pPolicy)) errors.p2pPolicy = 'p2pInvalid';
  if (draft.magicDns) {
    const suffix = draft.dnsSuffix.trim().replace(/\.$/, '');
    if (!suffix || suffix.length > 253 || !suffix.split('.').every((part) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part))) errors.dnsSuffix = 'dnsInvalid';
  }
  const servers = serverAddresses(draft.servers);
  if (!servers.length && !imported) errors.servers = 'serversRequired';
  else if (servers.some((address) => {
    try {
      if (!/^[a-z][a-z\d+.-]*:\/\//i.test(address) || /\s/.test(address)) return true;
      const url = new URL(address);
      return !url.hostname || (url.port !== '' && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535));
    } catch { return true; }
  })) errors.servers = 'serverInvalid';
  // Unsupported imported values remain saveable for migration. Validate edits,
  // while the native compatibility report decides whether they may run.
  if (imported && original) {
    const baseline = configurationDraft({ savedConfig: original, alias: draft.alias, icon: draft.icon });
    for (const field of Object.keys(errors) as (keyof NetworkDraft)[]) {
      if (errors[field] !== 'tunDuplicate' && draft[field] === baseline[field]) delete errors[field];
    }
  }
  return errors;
}
export function draftConfig(draft: NetworkDraft, previous: NetworkConfig): NetworkConfig {
  // Local presentation fields never enter the core configuration. Preserve
  // unknown imported fields, and exact network identity/secret whitespace.
  return { ...previous, name: draft.name, secret: draft.secret, servers: serverAddresses(draft.servers),
    hostname: draft.hostname === (previous.hostname ?? '') ? previous.hostname : draft.hostname.trim() || null,
    ipv4Mode: draft.ipv4Mode, ipv4Address: draft.ipv4Address.trim(),
    ipv4Prefix: Number(draft.ipv4Prefix) || previous.ipv4Prefix, tunName: draft.tunName.trim(),
    mtu: draft.mtu === '' ? null : Number(draft.mtu), ipv6: draft.ipv6,
    p2pPolicy: draft.p2pPolicy, latencyFirst: draft.p2pPolicy === 'only' && !(previous.officialToml !== undefined && previous.p2pPolicy === 'only') ? false : draft.latencyFirst,
    tcpHolePunching: draft.tcpHolePunching, udpHolePunching: draft.udpHolePunching, upnp: draft.upnp,
    magicDns: draft.magicDns, dnsSuffix: draft.dnsSuffix === previous.dnsSuffix ? previous.dnsSuffix : draft.dnsSuffix.trim(), udpBroadcastRelay: draft.udpBroadcastRelay };
}
export function configsEqual(a: NetworkConfig, b: NetworkConfig): boolean {
  const fields = ['name', 'secret', 'hostname', 'ipv4Mode', 'ipv4Address', 'ipv4Prefix', 'tunName', 'mtu', 'ipv6',
    'p2pPolicy', 'latencyFirst', 'tcpHolePunching', 'udpHolePunching', 'upnp', 'magicDns', 'dnsSuffix', 'udpBroadcastRelay'] as const;
  return fields.every((field) => a[field] === b[field]) && a.officialToml === b.officialToml && a.servers.length === b.servers.length
    && a.servers.every((server, index) => server === b.servers[index]);
}
export function hasPendingConfig(network: Network): boolean {
  return network.runningConfig !== null && !configsEqual(network.savedConfig, network.runningConfig);
}
export function serverSummary(address: string): string {
  try {
    const url = new URL(address);
    // User info and query strings may contain credentials; keep them out of the list.
    return `${url.protocol}//${url.host}`;
  } catch { return '—'; }
}
