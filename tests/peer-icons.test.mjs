import assert from 'node:assert/strict';
import test from 'node:test';
import { peerIcon, peerIconChoice, peerIconKey } from '../src/features/networks/peer-icons.ts';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';
import { documentFromNetworks, emptyDocument } from '../src/features/networks/persistence.ts';

const identity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const peer = { id: 'temporary-peer', instanceId: identity, name: 'MacBook / Windows NAS', ip: '10.42.0.3', connection: 'direct', latency: 12 };
function fixture() {
  const profiles = ['office', 'game'].map((name) => {
    const network = newNetworkDraft([]);
    network.alias = network.savedConfig.name = name;
    network.savedConfig.servers = ['tcp://example.com:11010'];
    return network;
  });
  let document = documentFromNetworks(emptyDocument(), profiles, profiles[0].id);
  document.networks[0].client.futurePreference = 'keep';
  let failure = false, writes = 0;
  const calls = [];
  const storage = { load: async () => structuredClone(document), restore: async () => structuredClone(document),
    save: async (next) => { if (failure) throw { code: 'io' }; writes++; document = structuredClone(next); document.revision = crypto.randomUUID(); return structuredClone(document); } };
  const create = () => createNetworkStore([], async (operation) => { calls.push(operation); }, { storage });
  return { create, profiles, calls, saved: () => structuredClone(document), fail: (value) => { failure = value; }, writes: () => writes };
}

test('automatic icons use explicit public role and never infer hardware or OS from a hostname', () => {
  assert.equal(peerIcon(peer), 'devices');
  assert.equal(peerIcon({ ...peer, publicServer: true }), 'dns');
  assert.equal(peerIcon({ ...peer, connection: 'relay', ip: null }), 'devices');
});
test('manual hardware icons override automatic choice and remain bound across address, hostname and peer ID changes', () => {
  const preferences = { [identity]: 'phone' };
  assert.equal(peerIcon({ ...peer, publicServer: true }, preferences), 'smartphone');
  assert.equal(peerIcon({ ...peer, id: 'new-peer-id', name: 'new-name', ip: '10.42.0.20' }, preferences), 'smartphone');
  assert.equal(peerIconChoice({ ...peer, instanceId: null }, preferences), 'auto');
  for (const id of ['', 'temporary-peer-id', '00000000-0000-0000-0000-000000000000']) assert.equal(peerIconKey({ instanceId: id }), null);
  assert.equal(peerIconKey({ instanceId: identity.toUpperCase() }), identity);
});
test('icon preferences persist only under client metadata and stay independent across networks', async () => {
  const f = fixture(); const store = f.create(); await store.getState().initialize();
  const [a, b] = f.profiles.map((network) => network.id);
  const configs = f.saved().networks.map((record) => record.config);
  assert.equal(await store.getState().setPeerIcon(a, identity, 'server'), true);
  assert.equal(await store.getState().setPeerIcon(b, identity, 'phone'), true);
  const reopened = f.create(); await reopened.getState().initialize();
  const [office, game] = reopened.getState().networks;
  assert.equal(peerIcon(peer, office.peerIcons), 'dns'); assert.equal(peerIcon(peer, game.peerIcons), 'smartphone');
  assert.deepEqual(f.saved().networks.map((record) => record.config), configs);
  assert.equal(f.saved().networks[0].client.futurePreference, 'keep');
  assert.deepEqual(f.calls, []);
});
test('restoring auto removes the saved override and keeps other network choices after reopening', async () => {
  const f = fixture(); const store = f.create(); await store.getState().initialize();
  const [a, b] = f.profiles.map((network) => network.id);
  await store.getState().setPeerIcon(a, identity, 'laptop');
  await store.getState().setPeerIcon(b, identity, 'router');
  assert.equal(await store.getState().setPeerIcon(a, identity, 'auto'), true);
  const reopened = f.create(); await reopened.getState().initialize();
  assert.equal(peerIcon({ ...peer, publicServer: true }, reopened.getState().networks[0].peerIcons), 'dns');
  assert.equal(peerIcon(peer, reopened.getState().networks[1].peerIcons), 'router');
  assert.equal(Object.hasOwn(f.saved().networks[0].client.peerIcons, identity), false);
});
test('failed writes retain the previous selection and invalid identifiers or choices do not write', async () => {
  const f = fixture(); const store = f.create(); await store.getState().initialize();
  const id = f.profiles[0].id;
  await store.getState().setPeerIcon(id, identity, 'computer');
  const before = f.saved(); f.fail(true);
  assert.equal(await store.getState().setPeerIcon(id, identity, 'phone'), false);
  assert.equal(peerIcon(peer, store.getState().networks[0].peerIcons), 'computer');
  assert.equal(store.getState().storageError.code, 'io'); assert.deepEqual(f.saved(), before);
  f.fail(false); const count = f.writes();
  assert.equal(await store.getState().setPeerIcon(id, 'temporary-peer-id', 'server'), false);
  assert.equal(await store.getState().setPeerIcon(id, identity, 'windows'), false);
  assert.equal(f.writes(), count);
});
test('queued icon, network preference and selection writes preserve each other', async () => {
  const f = fixture(); const store = f.create(); await store.getState().initialize();
  const [a, b] = f.profiles.map((network) => network.id);
  await Promise.all([store.getState().setPeerIcon(a, identity, 'laptop'), store.getState().setAutoConnect(a, true), store.getState().selectNetwork(b)]);
  assert.equal(f.saved().networks[0].client.peerIcons[identity], 'laptop');
  assert.equal(f.saved().networks[0].client.autoConnect, true); assert.equal(f.saved().selectedId, b);
  assert.deepEqual(f.calls, []);
});
