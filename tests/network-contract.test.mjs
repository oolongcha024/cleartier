import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createNetworkStore } from '../src/features/networks/network-store.ts';
import { createMemoryStorage } from '../src/features/networks/persistence.ts';
import { configurationDraft } from '../src/features/networks/configuration.ts';
const contract = JSON.parse(await readFile(new URL('./fixtures/network-contract.json', import.meta.url), 'utf8'));
test('the shared Rust serialization contract is consumed through the workflow Interface', async () => {
  const storage = createMemoryStorage(contract.document);
  const unexpected = async () => { throw new Error('No runtime operation expected'); };
  const runtime = { snapshot: async () => structuredClone(contract.runtimeFrame), start: unexpected, stop: unexpected,
    restart: unexpected, confirmQuiescent: unexpected };
  const store = createNetworkStore(runtime, { storage });
  await store.getState().initialize();
  const network = store.getState().networks[0];
  assert.equal(network.coreState, 'running'); assert.equal(network.peerCount, 0); assert.equal(network.recoveryConfig, null);
  assert.deepEqual(network.runningConfig, contract.runtimeFrame.networks[0].runningConfig);
  assert.equal((await store.getState().save(network.id, { ...configurationDraft(network), alias: '修改本地名称' })).status, 'saved');
  const saved = await storage.load();
  assert.deepEqual(saved.networks[0].config, contract.document.networks[0].config);
  assert.deepEqual(saved.futureDocument, contract.document.futureDocument);
  assert.deepEqual(saved.networks[0].client.futurePreference, { preserved: true });
});
