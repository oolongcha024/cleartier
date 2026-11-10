import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockPlatform } from '../dev/mock-platform.ts';
import { scenarios } from '../dev/scenarios/index.ts';
import { createUpdateStore } from '../src/features/updates/update-store.ts';
import { createNetworkStore } from '../src/features/networks/network-store.ts';

for (const scene of scenarios) {
  test(`development scene ${scene.id} supplies valid contracts`, async () => {
    const environment = await createMockPlatform(scene.id);
    try {
      const { platform } = environment;
      const document = await platform.networks.storage.load();
      const update = await platform.updates.read();
      assert.ok(Number.isFinite(update.revision));
      assert.ok(['installed', 'portable', 'unsupported'].includes(update.distribution));
      assert.equal((await platform.client.readHostEnvironment()).platform, 'windows');
      if (scene.id === 'networks.empty') assert.equal(document.networks.length, 0);
      if (scene.id === 'networks.offline') {
        const store = createNetworkStore(platform.networks.runtime, platform.networks);
        await store.getState().initialize();
        assert.ok(store.getState().networks.every((network) => network.coreState === 'stopped'));
        assert.deepEqual(environment.controls.networks.operations, []);
      }
      if (scene.id === 'updates.indeterminate') assert.equal(update.total, null);
      if (scene.id === 'desktop.close')
        assert.equal((await platform.desktop.read()).pending.kind, 'close');
    } finally {
      environment.dispose();
    }
  });
}

test('mock environments isolate configuration, preferences, failures and subscriptions', async () => {
  const first = await createMockPlatform();
  const second = await createMockPlatform();
  try {
    const document = await first.platform.networks.storage.load();
    document.networks[0].client.alias = 'edited';
    await first.platform.networks.storage.save(document, document.revision);
    assert.notEqual(
      (await second.platform.networks.storage.load()).networks[0].client.alias,
      'edited',
    );
    first.controls.updates.failCheck = true;
    await assert.rejects(first.platform.updates.command({ action: 'check' }));
    assert.equal((await second.platform.updates.read()).error, null);
    let notices = 0;
    const stop = await first.platform.desktop.watch(() => notices++);
    first.controls.desktop.emit();
    stop();
    first.controls.desktop.emit();
    assert.equal(notices, 1);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('cancelling a held simulated download cannot reopen installation confirmation', async () => {
  const environment = await createMockPlatform('updates.available');
  const store = createUpdateStore(environment.platform.updates);
  const stop = store.getState().start();
  await new Promise(setImmediate);
  environment.controls.updates.hold = true;
  const downloading = store.getState().run({ action: 'update', confirmed: false });
  await new Promise(setImmediate);
  assert.equal(store.getState().snapshot.phase, 'downloading');
  await store.getState().run({ action: 'cancel' });
  assert.equal(await downloading, false);
  assert.equal(store.getState().snapshot.phase, 'available');
  assert.equal(store.getState().error, null);
  assert.equal(environment.controls.updates.installs, 0);
  stop();
  environment.dispose();
});

test('disposing the simulator cancels pending work and removes all update listeners', async () => {
  const environment = await createMockPlatform('updates.available');
  let received = 0;
  await environment.platform.updates.watch(() => received++);
  environment.controls.updates.hold = true;
  const download = environment.platform.updates.command({ action: 'update', confirmed: false });
  assert.equal(received, 1);
  environment.dispose();
  await assert.rejects(download, (error) => error === 'cancelled');
  environment.controls.updates.emit();
  assert.equal(received, 1);
});
