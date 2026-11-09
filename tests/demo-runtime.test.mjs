import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoEnvironment } from '../src/features/networks/demo.ts';
import { createNetworkStore } from '../src/features/networks/network-store.ts';
import { createNetworkConfig } from '../src/features/networks/defaults.ts';
import { configurationDraft } from '../src/features/networks/configuration.ts';
import { deferred } from './helpers/networks.mjs';

test('browser adapter supplies real-shaped snapshots and seeds telemetry through the shared module', async () => {
  const demo = createDemoEnvironment(async () => {});
  const store = createNetworkStore(demo.runtime, demo);
  await store.getState().initialize();
  assert.equal(store.getState().networks.length, 3);
  assert.equal(store.getState().networks.find((network) => network.id === 'office').peerCount, 3);
  const { traffic: telemetry, devices } = store.telemetry.store.getState().office;
  assert.ok(telemetry.points.length >= 30);
  assert.equal(telemetry.snapshot.hostname, 'ClearTier-PC');
  assert.ok(telemetry.download > 0);
  assert.equal(devices.peers.length, 3);
  const external = await demo.runtime.snapshot();
  external.networks[0].runningConfig.secret = 'changed';
  assert.notEqual((await demo.runtime.snapshot()).networks[0].runningConfig.secret, 'changed');
});
test('demo restart changes only the target session and reports manual/automatic addresses', async () => {
  const demo = createDemoEnvironment(async () => {});
  const store = createNetworkStore(demo.runtime, demo);
  await store.getState().initialize();
  const before = await demo.runtime.snapshot();
  const office = store.getState().networks.find((network) => network.id === 'office');
  const applied = await store
    .getState()
    .save(
      'office',
      { ...configurationDraft(office), ipv4Mode: 'manual', ipv4Address: '10.88.0.9' },
      'now',
    );
  assert.equal((await applied.completion).status, 'completed');
  const after = await demo.runtime.snapshot();
  assert.notEqual(after.networks[0].telemetry.session, before.networks[0].telemetry.session);
  assert.equal(after.networks[1].telemetry.session, before.networks[1].telemetry.session);
  assert.equal(after.networks[0].virtualIp, '10.88.0.9');
  assert.ok(
    Number(after.networks[0].telemetry.downloadBytes) <
      Number(before.networks[0].telemetry.downloadBytes),
  );
});
test('demo reserves credentials before yielding and a stop prevents delayed starts from reappearing', async () => {
  const gate = deferred();
  let delayed = true;
  const demo = createDemoEnvironment(() => (delayed ? gate.promise : Promise.resolve()));
  const config = createNetworkConfig('a', {
    name: 'new',
    secret: 'key',
    servers: ['tcp://example.com:11010'],
  });
  const start = demo.runtime.start('a', config);
  await assert.rejects(demo.runtime.start('b', { ...config, tunName: 'ct-b' }), {
    code: 'network_already_running',
  });
  await assert.rejects(demo.runtime.confirmQuiescent('a'), { code: 'instance_running' });
  delayed = false;
  await demo.runtime.stop('a');
  gate.resolve();
  await assert.rejects(start, { code: 'operation_cancelled' });
  assert.equal(
    (await demo.runtime.snapshot()).networks.find((network) => network.id === 'a').state,
    'stopped',
  );
});
