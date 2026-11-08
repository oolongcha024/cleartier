import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';
import { configurationDraft, configsEqual, draftConfig, validateDraft } from '../src/features/networks/configuration.ts';
import { scriptedRuntime } from './helpers/networks.mjs';
import { emptyDocument } from '../src/features/networks/persistence.ts';

function fixture() {
  let document = emptyDocument();
  let fail = false;
  const native = scriptedRuntime();
  const calls = native.calls;
  const storage = {
    load: async () => structuredClone(document),
    save: async (next) => { if (fail) throw { code: 'io' }; document = structuredClone(next); return structuredClone(document); },
    restore: async () => structuredClone(document),
  };
  const store = createNetworkStore(native.runtime, { storage });
  const imported = newNetworkDraft([]);
  Object.assign(imported.savedConfig, { name: 'office', servers: [], hostname: 'old-node', ipv4Mode: 'none',
    officialToml: 'hostname = "old-node"\nlisteners = ["tcp://0.0.0.0:11010"]\nfuture_field = true\n' });
  return { store, imported, calls, storage, fail: (next) => { fail = next; }, saved: () => document };
}

test('TOML import creates a separate selected manual profile without changing existing networks or starting core', async () => {
  const f = fixture(); await f.store.getState().initialize();
  const existing = newNetworkDraft([]);
  await f.store.getState().importConfiguration(existing.id, { ...existing.savedConfig, name: 'office', servers: ['tcp://example.com:11010'] }, 'existing');
  const before = structuredClone(f.store.getState().networks[0]);
  const { id, savedConfig } = f.imported;
  assert.equal((await f.store.getState().importConfiguration(id, savedConfig, '迁移办公')).status, 'completed');
  const state = f.store.getState();
  assert.deepEqual(state.networks[0], before);
  assert.equal(state.selectedId, id);
  assert.equal(state.networks[1].autoConnect, false);
  assert.equal(state.networks[1].coreState, 'stopped');
  assert.equal(state.networks[1].alias, '迁移办公');
  assert.deepEqual(f.calls, []);
  const reopened = createNetworkStore(scriptedRuntime().runtime, { storage: f.storage });
  await reopened.getState().initialize();
  assert.equal(reopened.getState().networks[1].savedConfig.officialToml, savedConfig.officialToml);
});

test('failed import remains retryable and does not claim successful persistence', async () => {
  const f = fixture(); await f.store.getState().initialize();
  f.fail(true);
  assert.equal((await f.store.getState().importConfiguration(f.imported.id, f.imported.savedConfig, '')).status, 'storage-error');
  assert.equal(f.store.getState().networks.length, 0);
  assert.equal(f.saved().networks.length, 0);
  f.fail(false);
  assert.equal((await f.store.getState().importConfiguration(f.imported.id, f.imported.savedConfig, '')).status, 'completed');
});

test('queued imports recheck interface collisions and never overwrite a profile', async () => {
  const f = fixture(); await f.store.getState().initialize();
  const another = newNetworkDraft([]);
  const results = await Promise.all([
    f.store.getState().importConfiguration(f.imported.id, f.imported.savedConfig, ''),
    f.store.getState().importConfiguration(another.id, f.imported.savedConfig, ''),
  ]);
  assert.deepEqual(results.map((result) => result.status), ['completed', 'conflict']);
  assert.equal(f.saved().networks.length, 1);
});

test('editing imported metadata retains unsupported values, exact credentials and preservation base', async () => {
  const f = fixture(); await f.store.getState().initialize();
  Object.assign(f.imported.savedConfig, { name: ' office ', secret: ' key ', hostname: 'x'.repeat(40), mtu: 1500,
    p2pPolicy: 'only', latencyFirst: true });
  await f.store.getState().importConfiguration(f.imported.id, f.imported.savedConfig, 'original');
  const input = { ...configurationDraft(f.store.getState().networks[0]), alias: 'renamed' };
  assert.deepEqual(validateDraft(input, [], f.imported.savedConfig), {});
  assert.equal((await f.store.getState().save(f.imported.id, input)).status, 'saved');
  assert.deepEqual(f.saved().networks[0].config, f.imported.savedConfig);
  assert.equal(f.saved().networks[0].client.alias, 'renamed');
});

test('preservation-base changes are connection changes and no-IPv4 is represented explicitly', () => {
  const f = fixture();
  const config = f.imported.savedConfig;
  assert.equal(configsEqual(config, { ...config, officialToml: 'different = true' }), false);
  const draft = configurationDraft(f.imported);
  assert.deepEqual(validateDraft(draft, [], config), {});
  assert.equal(draftConfig(draft, config).ipv4Mode, 'none');
  assert.equal(draftConfig(draft, config).officialToml, config.officialToml);
});
