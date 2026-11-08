import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationDraft } from '../src/features/networks/configuration.ts';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';
import { documentFromNetworks, emptyDocument, networksFromDocument } from '../src/features/networks/persistence.ts';

function fixture(initial = emptyDocument()) {
  let document = structuredClone(initial);
  let revision = 0;
  let failure = null;
  let writes = 0;
  const storage = {
    load: async () => { if (failure) throw failure; return structuredClone(document); },
    save: async (next, expected) => {
      writes++;
      if (failure) throw failure;
      if (document.revision !== expected) throw { code: 'conflict' };
      document = { ...structuredClone(next), revision: String(++revision) };
      return structuredClone(document);
    },
    restore: async () => { failure = null; return structuredClone(document); },
  };
  const calls = [];
  const makeStore = () => createNetworkStore([], async (call) => { calls.push(call); }, { storage, connectionEnabled: false });
  return { makeStore, calls, storage, fail: (error) => { failure = error; }, saved: () => structuredClone(document), writes: () => writes };
}
function draft(store, { name = 'office', secret = ' key ', servers = 'tcp://example.com:11010', ...changes } = {}) {
  const candidate = newNetworkDraft(store.getState().networks);
  return { id: candidate.id, draft: { ...configurationDraft(candidate), name, secret, servers, ...changes } };
}
async function add(store, changes) {
  const input = draft(store, changes);
  assert.equal((await store.getState().saveConfiguration(input.id, input.draft, 'confirm', true)).status, 'saved');
  return input.id;
}

test('desktop starts empty, saves preferences, and reloads selected network without a simulated session', async () => {
  const f = fixture();
  const store = f.makeStore();
  assert.equal(store.getState().phase, 'loading');
  await store.getState().initialize();
  assert.equal(store.getState().networks.length, 0);
  const office = await add(store, { name: ' exact office ', hostname: 'desktop-node', p2pPolicy: 'disabled', magicDns: true });
  const gaming = await add(store, { name: 'gaming' });
  await store.getState().setAutoConnect(office, true);
  await store.getState().selectNetwork(office);
  assert.equal(f.saved().selectedId, office);
  assert.equal(f.saved().networks[0].client.autoConnect, true);
  const reopened = f.makeStore();
  await reopened.getState().initialize();
  assert.equal(reopened.getState().selectedId, office);
  assert.equal(reopened.getState().networks.length, 2);
  const network = reopened.getState().networks.find(n => n.id === office);
  assert.equal(network.savedConfig.name, ' exact office ');
  assert.equal(network.savedConfig.secret, ' key ');
  assert.equal(network.savedConfig.p2pPolicy, 'disabled');
  assert.equal(network.savedConfig.hostname, 'desktop-node');
  assert.equal(network.coreState, 'stopped');
  assert.equal(network.runningConfig, null);
  assert.equal(network.trafficTotals, null);
  assert.equal(await reopened.getState().toggleConnection(gaming), false);
  assert.equal(await reopened.getState().reconnect(office), false);
  assert.deepEqual(f.calls, []);
});

test('failed saves never mutate saved data and the same input can be retried', async () => {
  const f = fixture(); const store = f.makeStore(); await store.getState().initialize();
  const id = await add(store);
  const original = structuredClone(store.getState().networks);
  const input = { ...configurationDraft(original[0]), alias: 'new name', secret: 'changed secret' };
  f.fail({ code: 'io' });
  assert.equal((await store.getState().saveConfiguration(id, input)).status, 'storage-error');
  assert.deepEqual(store.getState().networks, original);
  assert.equal(store.getState().storageError.code, 'io');
  f.fail(null);
  assert.equal((await store.getState().saveConfiguration(id, input)).status, 'saved');
  assert.equal(store.getState().networks[0].alias, 'new name');
  assert.equal(f.saved().networks[0].config.secret, 'changed secret');
});

test('failed load is not an empty first launch and cannot overwrite the original', async () => {
  const f = fixture(); f.fail({ code: 'invalid', backupAvailable: true });
  const store = f.makeStore(); await store.getState().initialize();
  assert.equal(store.getState().phase, 'error');
  assert.equal(store.getState().storageError.backupAvailable, true);
  const input = draft(store);
  assert.equal((await store.getState().saveConfiguration(input.id, input.draft, 'confirm', true)).status, 'storage-error');
  assert.equal(f.writes(), 0);
  await store.getState().initialize(true);
  assert.equal(store.getState().phase, 'ready');
});

test('deletion commits before changing selection and supports deleting the last network', async () => {
  const f = fixture(); const store = f.makeStore(); await store.getState().initialize();
  const one = await add(store); const two = await add(store, { name: 'second' });
  f.fail({ code: 'io' });
  assert.equal(await store.getState().removeNetwork(two), false);
  assert.equal(store.getState().selectedId, two);
  assert.equal(store.getState().networks.length, 2);
  f.fail(null);
  assert.equal(await store.getState().removeNetwork(two), true);
  assert.equal(store.getState().selectedId, one);
  assert.equal(await store.getState().removeNetwork(one), true);
  assert.equal(store.getState().selectedId, '');
  assert.deepEqual(f.saved().networks, []);
});

test('same network credentials can be saved under distinct UUIDs and stable TUN names', async () => {
  const f = fixture(); const store = f.makeStore(); await store.getState().initialize();
  const one = await add(store); const two = await add(store);
  assert.notEqual(one, two);
  assert.match(one, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.notEqual(store.getState().networks[0].savedConfig.tunName, store.getState().networks[1].savedConfig.tunName);
  assert.equal(f.saved().networks[0].config.secret, f.saved().networks[1].config.secret);
});

test('queued mutations preserve concurrent additions, preferences and selection', async () => {
  const f = fixture(); const store = f.makeStore(); await store.getState().initialize();
  const a = draft(store); const b = draft(store, { name: 'second' });
  const results = await Promise.all([store.getState().saveConfiguration(a.id, a.draft, 'confirm', true),
    store.getState().saveConfiguration(b.id, b.draft, 'confirm', true)]);
  assert.deepEqual(results.map(r => r.status), ['saved', 'saved']);
  await Promise.all([store.getState().selectNetwork(a.id), store.getState().setAutoConnect(b.id, true)]);
  assert.equal(f.saved().selectedId, a.id);
  assert.equal(f.saved().networks[1].client.autoConnect, true);
});

test('stale windows report conflicts and reload newer data without discarding the durable copy', async () => {
  const f = fixture(); const a = f.makeStore(); const b = f.makeStore();
  await Promise.all([a.getState().initialize(), b.getState().initialize()]);
  await add(a);
  const input = draft(b);
  assert.equal((await b.getState().saveConfiguration(input.id, input.draft, 'confirm', true)).status, 'storage-error');
  assert.equal(b.getState().storageError.code, 'conflict');
  assert.equal(b.getState().networks.length, 0);
  assert.equal(f.saved().networks.length, 1);
  await b.getState().initialize();
  assert.equal(b.getState().networks.length, 1);
});

test('unknown fields survive edits while runtime snapshots never become durable configuration', async () => {
  const candidate = newNetworkDraft([]);
  candidate.savedConfig = { ...candidate.savedConfig, name: 'office', servers: ['tcp://example.com:11010'], futureCore: { untouched: true } };
  const initial = documentFromNetworks(emptyDocument(), [candidate], candidate.id);
  initial.futureRoot = { keep: true };
  initial.networks[0].futureRecord = 42;
  initial.networks[0].client.futureClient = 'keep';
  initial.networks[0].client.coreState = 'running';
  const f = fixture(initial); const store = f.makeStore(); await store.getState().initialize();
  assert.equal(store.getState().networks[0].coreState, 'stopped');
  const input = { ...configurationDraft(store.getState().networks[0]), alias: 'renamed' };
  assert.equal((await store.getState().saveConfiguration(candidate.id, input)).status, 'saved');
  const saved = f.saved();
  assert.deepEqual(saved.futureRoot, { keep: true });
  assert.equal(saved.networks[0].futureRecord, 42);
  assert.equal(saved.networks[0].client.futureClient, 'keep');
  assert.deepEqual(saved.networks[0].config.futureCore, { untouched: true });
  assert.equal(saved.networks[0].runningConfig, undefined);
  assert.equal(saved.networks[0].trafficTotals, undefined);
  assert.equal(saved.networks[0].config.alias, undefined);
  assert.equal(saved.networks[0].config.icon, undefined);
});

test('missing remembered selection falls back to the first saved network', async () => {
  const candidate = newNetworkDraft([]);
  const initial = documentFromNetworks(emptyDocument(), [candidate], 'deleted-id');
  const f = fixture(initial); const store = f.makeStore(); await store.getState().initialize();
  assert.equal(store.getState().selectedId, candidate.id);
  assert.equal(networksFromDocument(initial)[0].coreState, 'stopped');
});

test('startup queries current core snapshots and marks query failure as unknown', async () => {
  const candidate = newNetworkDraft([]);
  const initial = documentFromNetworks(emptyDocument(), [candidate], candidate.id);
  const f = fixture(initial);
  let queries = 0;
  const runtime = Object.assign(async () => { throw new Error('must not connect'); }, {
    snapshot: async () => { queries++; return [{ id: candidate.id, state: 'running', runningConfig: null,
      peerCount: 0, directPeerCount: 0, virtualIp: null, deviceName: '', error: null }]; },
  });
  const store = createNetworkStore([], runtime, { storage: f.storage, connectionEnabled: false });
  await store.getState().initialize();
  assert.equal(queries, 1);
  assert.equal(store.getState().networks[0].coreState, 'running');
  assert.equal(store.getState().networks[0].runningConfig, null);
  runtime.snapshot = async () => { throw new Error('unavailable'); };
  const unavailable = createNetworkStore([], runtime, { storage: f.storage, connectionEnabled: false });
  await unavailable.getState().initialize();
  assert.equal(unavailable.getState().phase, 'ready');
  assert.equal(unavailable.getState().networks[0].coreState, 'unknown');
});
