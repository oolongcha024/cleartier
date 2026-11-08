import type { Peer } from './model.ts';

export const peerIconKinds = ['computer', 'laptop', 'server', 'router', 'phone'] as const;
export type PeerIconKind = (typeof peerIconKinds)[number];
export type PeerIconChoice = PeerIconKind | 'auto';
export type PeerIconPreferences = Record<string, PeerIconKind>;
export const peerIconNames = {
  computer: 'computer',
  laptop: 'laptop',
  server: 'dns',
  router: 'router',
  phone: 'smartphone',
} as const;

// An instance UUID identifies the remote configuration across changes to its
// session peer ID, hostname and address. Unknown/ambiguous identities stay auto.
export function peerIconKey(peer: Pick<Peer, 'instanceId'>): string | null {
  const id = peer.instanceId;
  return typeof id === 'string' &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) &&
    !/^0{8}(?:-0{4}){3}-0{12}$/.test(id)
    ? id.toLowerCase()
    : null;
}
export function peerIconChoice(peer: Peer, preferences: PeerIconPreferences = {}): PeerIconChoice {
  const key = peerIconKey(peer);
  const kind = key ? preferences[key] : undefined;
  return kind && peerIconKinds.includes(kind) ? kind : 'auto';
}
export function peerIcon(peer: Peer, preferences: PeerIconPreferences = {}): string {
  const choice = peerIconChoice(peer, preferences);
  return choice === 'auto' ? (peer.publicServer ? 'dns' : 'devices') : peerIconNames[choice];
}
