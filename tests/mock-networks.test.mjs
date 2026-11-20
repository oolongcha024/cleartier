import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockNetworks } from '../dev/mock-networks.ts';
import { createNetworkStore } from '../src/features/networks/network-store.ts';
import { createNetworkConfig } from '../src/features/networks/defaults.ts';
import { configurationDraft } from '../src/features/networks/configuration.ts';
import { deferred } from './helpers/networks.mjs';

test('development adapter supplies real-shaped snapshots and seeds telemetry through the shared module', async () => {
  const mock = createMockNetworks(async () => {});
  const store = createNetworkStore(mock.runtime, mock);
  await store.getState().initialize();
  const snapshot = await mock.runtime.snapshot();
  const networks = store.getState().networks;
  assert.deepEqual(
    new Set(networks.map(({ id }) => id)),
    new Set(snapshot.networks.map(({ id }) => id)),
  );
  const active = snapshot.networks.find((network) => network.telemetry?.peers.length);
  assert.ok(active, 'Expected a simulated network with live peers');
  const { traffic, devices } = store.telemetry.store.getState()[active.id];
  assert.equal(networks.find(({ id }) => id === active.id).peerCount, active.peerCount);
  assert.equal(devices.peers.length, active.telemetry.peers.length);
  assert.equal(traffic.snapshot.hostname, active.telemetry.hostname);
  assert.ok(traffic.points.length > 1);
  assert.ok(traffic.download > 0);

  const originalSecret = active.runningConfig.secret;
  active.runningConfig.secret += '-changed';
  const fresh = await mock.runtime.snapshot();
  assert.equal(
    fresh.networks.find(({ id }) => id === active.id).runningConfig.secret,
    originalSecret,
  );
});
test('mock restart changes only the target session and reports manual/automatic addresses', async () => {
  const mock = createMockNetworks(async () => {});
  const store = createNetworkStore(mock.runtime, mock);
  await store.getState().initialize();
  const before = await mock.runtime.snapshot();
  const office = store.getState().networks.find((network) => network.id === 'office');
  const applied = await store
    .getState()
    .save(
      'office',
      { ...configurationDraft(office), ipv4Mode: 'manual', ipv4Address: '10.88.0.9' },
      'now',
    );
  assert.equal((await applied.completion).status, 'completed');
  const after = await mock.runtime.snapshot();
  assert.notEqual(after.networks[0].telemetry.session, before.networks[0].telemetry.session);
  assert.equal(after.networks[1].telemetry.session, before.networks[1].telemetry.session);
  assert.equal(after.networks[0].virtualIp, '10.88.0.9');
  assert.ok(
    Number(after.networks[0].telemetry.downloadBytes) <
      Number(before.networks[0].telemetry.downloadBytes),
  );
});
test('mock reserves credentials before yielding and a stop prevents delayed starts from reappearing', async () => {
  const gate = deferred();
  let delayed = true;
  const mock = createMockNetworks(() => (delayed ? gate.promise : Promise.resolve()));
  const config = createNetworkConfig('a', {
    name: 'new',
    secret: 'key',
    servers: ['tcp://example.com:11010'],
  });
  const start = mock.runtime.start('a', config);
  await assert.rejects(mock.runtime.start('b', { ...config, tunName: 'ct-b' }), {
    code: 'network_already_running',
  });
  await assert.rejects(mock.runtime.confirmQuiescent('a'), { code: 'instance_running' });
  delayed = false;
  await mock.runtime.stop('a');
  gate.resolve();
  await assert.rejects(start, { code: 'operation_cancelled' });
  assert.equal(
    (await mock.runtime.snapshot()).networks.find((network) => network.id === 'a').state,
    'stopped',
  );
});

test('disposing the mock runtime prevents a delayed connection from committing', async () => {
  const gate = deferred();
  const mock = createMockNetworks(() => gate.promise);
  const pending = mock.runtime.start(
    'new',
    createNetworkConfig('new', {
      name: 'new',
      secret: 'key',
      servers: ['tcp://example.com:11010'],
    }),
  );
  mock.dispose();
  gate.resolve();
  await assert.rejects(pending, { code: 'operation_cancelled' });
});
